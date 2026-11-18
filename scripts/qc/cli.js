// Birleşik kalite kapısı: doğrulama + kalite puanı + eşik kontrolü.
// Kullanım:
//   node scripts/qc/cli.js                 # cilt 4 ve 4.5
//   node scripts/qc/cli.js --vol 4         # tek cilt
//   node scripts/qc/cli.js --json          # makine okunur çıktı
//   node scripts/qc/cli.js --update-baseline
// Çıkış kodu: 0 = eşikler içinde, 1 = ihlal var.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'data', 'qc_baseline.json');

const VOLUMES = {
  4: { tr: 'data/paragraphs_final.json', label: 'Cilt 4' },
  '4.5': { tr: 'data45/paragraphs_final.json', label: 'Cilt 4.5' },
};

const args = process.argv.slice(2);
const json = args.includes('--json');
const update = args.includes('--update-baseline');
const vArg = args.indexOf('--vol');
const selected = vArg > -1 ? [String(args[vArg + 1])] : Object.keys(VOLUMES);

// eşikler: 0 toleranslı olanlar ihlal sayılır, diğerleri taban çizgisine göre ölçülür
const ZERO_TOLERANCE = ['çift nokta', 'noktalama öncesi boşluk', '"?." kalıbı', 'bitişik/imla hatası', 'düz tırnak', 'boş paragraf'];

function run(script, file) {
  const out = execFileSync(process.execPath, [path.join(__dirname, script), path.resolve(ROOT, file)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ALYA_TR_FILE: path.resolve(ROOT, file) },
  });
  return out;
}

function parseVerify(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\S.*)$/);
    if (!m) continue;
    const value = Number(m[1]);
    const rest = m[2].trim();
    rows.push({ value, label: rest });
  }
  return rows;
}

function parseQuality(text) {
  const avg = text.match(/ortalama puan:\s*([\d.]+)/);
  const flagged = text.match(/3\+ puanlı:\s*(\d+)/);
  const paras = text.match(/paragraf:\s*(\d+)/);
  return {
    avg: avg ? Number(avg[1]) : null,
    flagged: flagged ? Number(flagged[1]) : null,
    paragraphs: paras ? Number(paras[1]) : null,
  };
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const result = {};
const violations = [];

for (const vol of selected) {
  const cfg = VOLUMES[vol];
  if (!cfg) {
    violations.push({ vol, label: 'bilinmeyen cilt' });
    continue;
  }
  const file = path.resolve(ROOT, cfg.tr);
  if (!fs.existsSync(file)) {
    violations.push({ vol, label: 'dosya yok: ' + cfg.tr });
    continue;
  }
  const verifyRows = parseVerify(run('verify.js', cfg.tr));
  const q = parseQuality(run('quality.js', cfg.tr));
  const base = baseline[vol] || {};

  const hardFails = [];
  for (const row of verifyRows) {
    if (ZERO_TOLERANCE.some((z) => row.label.includes(z)) && row.value > 0) {
      hardFails.push({ label: row.label, value: row.value });
    }
  }
  if (q.avg !== null && base.avg !== undefined && q.avg > base.avg + 0.03) {
    hardFails.push({ label: 'ortalama puan', value: q.avg, baseline: base.avg });
  }
  if (q.flagged !== null && base.flagged !== undefined && q.flagged > base.flagged + 5) {
    hardFails.push({ label: '3+ puanlı paragraf', value: q.flagged, baseline: base.flagged });
  }

  result[vol] = { label: cfg.label, file: cfg.tr, verify: verifyRows, quality: q, fails: hardFails };
  if (hardFails.length) violations.push({ vol, fails: hardFails });

  if (update) baseline[vol] = { avg: q.avg, flagged: q.flagged, paragraphs: q.paragraphs };
}

if (update) {
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 1));
}

if (json) {
  console.log(JSON.stringify({ ok: violations.length === 0, result, violations, baseline }, null, 1));
} else {
  for (const vol of Object.keys(result)) {
    const r = result[vol];
    console.log('\n== ' + r.label + ' (' + r.file + ')');
    console.log('   paragraf:', r.quality.paragraphs, '| ortalama puan:', r.quality.avg, '| 3+ puanlı:', r.quality.flagged);
    const key = ['çift nokta', '"?." kalıbı', 'bitişik/imla hatası', 'düz tırnak'];
    for (const k of key) {
      const row = r.verify.find((x) => x.label.includes(k));
      if (row) console.log('   ' + k.padEnd(22), row.value);
    }
    if (r.fails.length) r.fails.forEach((f) => console.log('   ✗', f.label, f.value, f.baseline !== undefined ? '(taban ' + f.baseline + ')' : ''));
    else console.log('   ✓ eşikler içinde');
  }
}

process.exit(violations.length === 0 ? 0 : 1);
