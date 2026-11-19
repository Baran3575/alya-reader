// Birleşik kalite kapısı: şema doğrulama + imla/noktalama + kalite puanı + eşik kontrolü + yama regresyon kapısı.
// Kullanım:
//   node scripts/qc/cli.js                         # Tüm etkin ciltler (data/volumes.json)
//   node scripts/qc/cli.js --volume <cilt>         # Belirli cilt
//   node scripts/qc/cli.js --strict                # Sıkı eşik kapısı (hata payı sıfır)
//   node scripts/qc/cli.js --check-regression      # Taban çizgisi ve yama regresyon kontrolü
//   node scripts/qc/cli.js --json                  # Makine okunur JSON çıktısı
//   node scripts/qc/cli.js --update-baseline       # Taban çizgisini mevcut değerlerle güncelle
// Çıkış kodu: 0 = tüm kontroller başarılı, 1 = ihlal veya regresyon var.

const fs = require('fs');
const path = require('path');
const { runVerify } = require('./verify');
const { evaluateData, score } = require('./quality');
const { validatePatches } = require('../patch');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE_FILE = path.join(ROOT, 'data', 'qc_baseline.json');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'volumes.json'), 'utf8'));
const VOLUMES = {};
for (const entry of MANIFEST) {
  const id = String(entry.id);
  VOLUMES[id] = {
    tr: `${entry.dataDir}/paragraphs_final.json`,
    label: entry.label,
    maxAvgStrict: entry.maxAvgStrict,
    patchesFile: entry.patchesFile || '',
    enabled: Boolean(entry.enabled),
  };
}

// Sayfa bölünmesinden kaynaklanan bilinen tek sayıda tırnak içeren paragraflar
const KNOWN_PAGE_SPLIT_QUOTES = {
  '4': new Set([
    '31.1', '36.0', '54.13', '55.14', '115.14', '137.1', '156.5', '172.9',
    '173.4', '175.14', '190.13', '196.13', '197.7', '217.8', '233.6', '234.6',
    '235.1', '254.14',
  ]),
  '4.5': new Set([
    '12.2', '25.7', '32.5', '33.2', '47.3', '50.3', '67.4', '122.0',
    '127.2', '133.0', '159.4', '173.1', '175.4', '197.4', '237.4', '237.5',
    '239.5', '283.2', '317.3', '317.4', '323.0', '323.1', '337.4', '337.5',
  ]),
};

const ZERO_TOLERANCE = [
  'çift nokta',
  'noktalama öncesi boşluk',
  '"?." kalıbı',
  'bitişik/imla hatası',
  'düz tırnak',
  'boş paragraf',
  'İngilizce kalıntı',
  'çevirmen notu',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const update = args.includes('--update-baseline');
  const strict = args.includes('--strict');
  const checkRegression = args.includes('--check-regression');

  let selected = MANIFEST.filter((v) => v.enabled).map((v) => String(v.id));
  const volIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  if (volIdx > -1 && args[volIdx + 1]) {
    const val = String(args[volIdx + 1]);
    selected = [val];
  }

  return { args, json, update, strict, checkRegression, selected };
}

function validateSchema(filePath) {
  const errors = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    errors.push(`JSON ayrıştırma hatası: ${e.message}`);
    return { ok: false, errors, data: null };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    errors.push('Kök öğe JSON nesnesi olmalıdır.');
    return { ok: false, errors, data: null };
  }

  for (const [key, val] of Object.entries(data)) {
    if (!/^\d+$/.test(key)) {
      errors.push(`Geçersiz sayfa anahtarı: "${key}" (beklenen format: ^\\d+$)`);
    }
    if (!Array.isArray(val)) {
      errors.push(`Sayfa ${key} değeri dizi (Array) olmalıdır.`);
      continue;
    }
    for (let i = 0; i < val.length; i++) {
      if (typeof val[i] !== 'string') {
        errors.push(`Sayfa ${key}, indeks ${i} dize (string) türünde olmalıdır.`);
      }
    }
  }

  return { ok: errors.length === 0, errors, data };
}

function findUnclosedQuotes(data, vol) {
  const known = KNOWN_PAGE_SPLIT_QUOTES[vol] || new Set();
  const unclosed = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((text, i) => {
      const key = `${pg}.${i}`;
      const curlyQuotes = (text.match(/[“”]/g) || []).length;
      if (curlyQuotes % 2 !== 0 && !known.has(key)) {
        unclosed.push({ key, text: text.slice(0, 100), count: curlyQuotes });
      }
    });
  }
  return unclosed;
}

function findEnglishResidueDetails(data) {
  const re = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
  const matches = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((text, i) => {
      const clean = text.replace(/https?:\s*\/\/[^\n]+/gi, '');
      const m = clean.match(re);
      if (m && m.length > 0) {
        matches.push({ key: `${pg}.${i}`, words: m, text: text.slice(0, 100) });
      }
    });
  }
  return matches;
}

function findTranslatorNotesDetails(data) {
  const re = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;
  const matches = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((text, i) => {
      if (re.test(text)) {
        matches.push({ key: `${pg}.${i}`, text: text.slice(0, 100) });
      }
    });
  }
  return matches;
}

function generateMarkdownSummary(result, violations, options) {
  const lines = [];
  lines.push('### Çeviri Kalite Kapısı Raporu (QC Matrix)');
  lines.push('');
  lines.push(`**Mod**: ${options.strict ? 'Strict (Sıkı)' : 'Standart'}${options.checkRegression ? ' + Regresyon Kapısı' : ''}`);
  lines.push('');
  lines.push('| Cilt | Paragraf | Ort. Puan | Taban Çizgisi | 3+ Puanlı | Durum |');
  lines.push('|---|---|---|---|---|---|');

  for (const vol of Object.keys(result)) {
    const r = result[vol];
    const status = r.fails.length === 0 ? '✓ Başarılı' : `✗ Başarısız (${r.fails.length} ihlal)`;
    const baseAvg = r.baseline && r.baseline.avg !== undefined ? r.baseline.avg.toFixed(2) : '-';
    lines.push(`| ${r.label} | ${r.quality.total} | ${r.quality.avg.toFixed(2)} | ${baseAvg} | ${r.quality.flagged} | ${status} |`);
  }

  lines.push('');

  if (violations.length > 0) {
    lines.push('#### Tespit Edilen İhlaller');
    for (const v of violations) {
      lines.push(`- **Cilt ${v.vol}**:`);
      for (const f of v.fails) {
        const detailStr = f.details && f.details.length ? ` — ${JSON.stringify(f.details.slice(0, 3))}` : '';
        lines.push(`  - ✗ ${f.label}: ${f.value}${f.baseline !== undefined ? ` (taban: ${f.baseline})` : ''}${detailStr}`);
      }
    }
  } else {
    lines.push('✓ Tüm kalite kontrolleri ve şema kuralları eşikler içinde geçti.');
  }

  return lines.join('\n');
}

function main() {
  const { json, update, strict, checkRegression, selected } = parseArgs();
  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
  const result = {};
  const violations = [];

  for (const vol of selected) {
    const cfg = VOLUMES[vol];
    if (!cfg) {
      violations.push({ vol, fails: [{ label: 'bilinmeyen cilt', value: vol }] });
      continue;
    }

    const relFile = cfg.tr;
    const absFile = path.resolve(ROOT, relFile);
    if (!fs.existsSync(absFile)) {
      violations.push({ vol, fails: [{ label: 'dosya yok', value: relFile }] });
      continue;
    }

    // 1. JSON Şema Doğrulama
    const schemaRes = validateSchema(absFile);
    if (!schemaRes.ok) {
      const fails = schemaRes.errors.map((err) => ({ label: 'şema hatası', value: err }));
      result[vol] = {
        label: cfg.label,
        file: relFile,
        verify: [],
        quality: { avg: 0, flagged: 0, total: 0 },
        fails,
        baseline: {},
      };
      violations.push({ vol, fails });
      continue;
    }

    const data = schemaRes.data;
    const verifyData = runVerify(absFile);
    const q = evaluateData(data);
    const base = baseline[vol] || {};

    const hardFails = [];

    // 2. Sıfır Tolerans Doğrulama Kontrolleri
    for (const row of verifyData.rows) {
      if (ZERO_TOLERANCE.some((z) => row[2].includes(z)) && row[1] > 0) {
        let details = [];
        if (row[2].includes('İngilizce kalıntı')) {
          details = findEnglishResidueDetails(data);
        } else if (row[2].includes('çevirmen notu')) {
          details = findTranslatorNotesDetails(data);
        }
        hardFails.push({ label: row[2], value: row[1], details });
      }
    }

    // 3. Kapanmamış tırnak denetimi (bilinen sayfa sınırları harici)
    const unclosedQuotes = findUnclosedQuotes(data, vol);
    if (unclosedQuotes.length > 0) {
      hardFails.push({
        label: 'kapanmamış tırnak',
        value: unclosedQuotes.length,
        details: unclosedQuotes.map((u) => `s${u.key}: ${u.text}`),
      });
    }

    // 4. Yama Doğrulama ve Regresyon (tanımlı patchesFile varsa)
    if (cfg.patchesFile) {
      const patchesFile = path.resolve(ROOT, cfg.patchesFile);
      if (fs.existsSync(patchesFile)) {
        try {
          const patches = JSON.parse(fs.readFileSync(patchesFile, 'utf8'));
          const patchRes = validatePatches(patches, data, { dryRun: true });
          if (!patchRes.ok) {
            hardFails.push({
              label: 'geçersiz yama formatı / regresyonu',
              value: patchRes.errors.length,
              details: patchRes.errors,
            });
          }
        } catch (e) {
          hardFails.push({ label: 'yama dosyası hatası', value: e.message });
        }
      }
    }

    // 5. Kalite Puanı Eşik ve Regresyon Kapısı
    if (strict) {
      // Strict Mod Gating (Requirement 3: average score below 0.20 for Vol 4)
      if (cfg.maxAvgStrict !== undefined && q.avg > cfg.maxAvgStrict) {
        hardFails.push({
          label: 'ortalama puan (strict limit aşıldı)',
          value: q.avg,
          baseline: cfg.maxAvgStrict,
        });
      }
      if (base.avg !== undefined && q.avg > base.avg + 0.01) {
        hardFails.push({
          label: 'ortalama puan regresyonu (strict)',
          value: q.avg,
          baseline: base.avg,
        });
      }
      if (base.flagged !== undefined && q.flagged > base.flagged) {
        hardFails.push({
          label: '3+ puanlı paragraf regresyonu (strict)',
          value: q.flagged,
          baseline: base.flagged,
        });
      }
    } else if (checkRegression) {
      if (base.avg !== undefined && q.avg > base.avg) {
        hardFails.push({
          label: 'ortalama puan regresyonu',
          value: q.avg,
          baseline: base.avg,
        });
      }
      if (base.flagged !== undefined && q.flagged > base.flagged) {
        hardFails.push({
          label: '3+ puanlı paragraf regresyonu',
          value: q.flagged,
          baseline: base.flagged,
        });
      }
    } else {
      if (base.avg !== undefined && q.avg > base.avg + 0.03) {
        hardFails.push({ label: 'ortalama puan', value: q.avg, baseline: base.avg });
      }
      if (base.flagged !== undefined && q.flagged > base.flagged + 5) {
        hardFails.push({ label: '3+ puanlı paragraf', value: q.flagged, baseline: base.flagged });
      }
    }

    result[vol] = {
      label: cfg.label,
      file: relFile,
      verify: verifyData.rows.map(([label, value, note]) => ({ label: note || label, value })),
      quality: { avg: q.avg, flagged: q.flagged, total: q.total },
      fails: hardFails,
      baseline: base,
    };

    if (hardFails.length > 0) {
      violations.push({ vol, fails: hardFails });
    }

    if (update) {
      baseline[vol] = { avg: q.avg, flagged: q.flagged, paragraphs: q.total };
    }
  }

  if (update) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 1) + '\n');
    console.log('✓ Taban çizgisi güncellendi: data/qc_baseline.json');
  }

  const markdownSummary = generateMarkdownSummary(result, violations, { strict, checkRegression });

  // GitHub Actions Step Summary desteği
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary + '\n\n');
    } catch (err) {
      console.error('Uyarı: GITHUB_STEP_SUMMARY yazılamadı:', err.message);
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: violations.length === 0,
          strict,
          checkRegression,
          result,
          violations,
          baseline,
        },
        null,
        2
      )
    );
  } else {
    for (const vol of Object.keys(result)) {
      const r = result[vol];
      console.log('\n== ' + r.label + ' (' + r.file + ')');
      console.log(
        '   paragraf:',
        r.quality.total,
        '| ortalama puan:',
        r.quality.avg,
        '| 3+ puanlı:',
        r.quality.flagged
      );

      const displayKeys = [
        'çift nokta',
        '"?." kalıbı',
        'bitişik/imla hatası',
        'düz tırnak',
        'İngilizce kalıntı',
        'çevirmen notu',
      ];
      for (const k of displayKeys) {
        const row = r.verify.find((x) => x.label.includes(k));
        if (row) console.log('   ' + k.padEnd(24), row.value);
      }

      if (r.fails.length > 0) {
        console.log('\n   ✗ Kusurlar ve Regresyon İhlalleri:');
        r.fails.forEach((f) => {
          console.log(
            '     - ' + f.label + ':',
            f.value,
            f.baseline !== undefined ? '(taban/sınır: ' + f.baseline + ')' : ''
          );
          if (f.details && f.details.length) {
            f.details.slice(0, 5).forEach((d) => console.log('       ' + (typeof d === 'string' ? d : JSON.stringify(d))));
          }
        });
      } else {
        console.log('   ✓ Tüm eşikler içinde');
      }
    }
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateSchema,
  findUnclosedQuotes,
  findEnglishResidueDetails,
  findTranslatorNotesDetails,
  generateMarkdownSummary,
};
