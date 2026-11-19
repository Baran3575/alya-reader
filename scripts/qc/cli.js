// Birleşik kalite kapısı: şema doğrulama + imla/noktalama + kalite puanı + eşik kontrolü + yama regresyon kapısı.
// Kullanım:
//   node scripts/qc/cli.js                         # Kayıtlı tüm ciltler (4 – 12)
//   node scripts/qc/cli.js --volume <4..12>        # Belirli cilt
//   node scripts/qc/cli.js --phase <1..5>          # Belirli faz ve önkoşul kontrolü
//   node scripts/qc/cli.js --strict                # Sıkı eşik kapısı (Faz 1: <0.12 ve <%0.5; Faz 2-5: <=0.20)
//   node scripts/qc/cli.js --check-regression      # Taban çizgisi ve yama regresyon kontrolü
//   node scripts/qc/cli.js --json                  # Makine okunur JSON çıktısı
//   node scripts/qc/cli.js --update-baseline       # Taban çizgisini mevcut değerlerle güncelle
// Çıkış kodu: 0 = tüm kontroller başarılı, 1 = ihlal veya regresyon var.

const fs = require('fs');
const path = require('path');
const { runVerify, hasUnbalancedDelim } = require('./verify');
const { evaluateData, score } = require('./quality');
const { validatePatches } = require('../patch');
const { ROOT, VOLUME_KEYS, VOLUMES: REGISTRY, PHASES, getActiveVolumes } = require('../lib/volumes');

const BASELINE_FILE = path.join(ROOT, 'data', 'qc_baseline.json');
const MAX_FLAGGED_SHARE_STRICT = 0.005; // < 0.5% 3+ puanlı paragraf sınırı (Faz 1)

const VOLUMES = Object.fromEntries(
  VOLUME_KEYS.map((k) => [
    k,
    {
      tr: REGISTRY[k].finalRel,
      label: REGISTRY[k].label,
      phase: REGISTRY[k].phase,
      maxAvgStrict: REGISTRY[k].maxAvgStrict,
      maxFlaggedShareStrict: REGISTRY[k].maxFlaggedShareStrict,
    },
  ])
);

// Bölüm bazlı birleştirme sonrası sayfa sınırı tırnak istisnaları sıfırlandı
const KNOWN_PAGE_SPLIT_QUOTES = {
  '4': new Set(),
  '4.5': new Set(),
};

const ZERO_TOLERANCE = [
  'çift nokta',
  'noktalama öncesi boşluk',
  '"?." kalıbı',
  'bitişik/imla hatası',
  'düz tırnak',
  'dengesiz süslü parantez',
  'dengesiz köşeli parantez',
  'Japonca köşe tırnağı',
  'Kiril kalıntısı',
  'boş paragraf',
  'İngilizce kalıntı',
  'çevirmen notu',
];

function parseArgs(argv = process.argv.slice(2)) {
  const args = argv;
  const json = args.includes('--json');
  const update = args.includes('--update-baseline');
  const strict = args.includes('--strict');
  const checkRegression = args.includes('--check-regression');

  let selected = getActiveVolumes(ROOT).map((v) => v.key);
  if (selected.length === 0) selected = [...VOLUME_KEYS];

  let phase = null;
  const phaseIdx = args.indexOf('--phase');
  if (phaseIdx > -1 && args[phaseIdx + 1]) {
    phase = Number(args[phaseIdx + 1]);
    if (PHASES[phase]) {
      selected = [...PHASES[phase].volumes];
    } else {
      selected = [`invalid_phase_${args[phaseIdx + 1]}`];
    }
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--volume' || a === '--vol' || a === '-v') && args[i + 1]) {
      selected = [String(args[i + 1]).trim()];
      break;
    }
    if (a.startsWith('--volume=')) {
      selected = [a.slice('--volume='.length).trim()];
      break;
    }
    if (a.startsWith('--vol=')) {
      selected = [a.slice('--vol='.length).trim()];
      break;
    }
  }

  return { args, json, update, strict, checkRegression, selected, phase };
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
      if (known.has(key)) return;
      const openCount = (text.match(/“/g) || []).length;
      const closeCount = (text.match(/”/g) || []).length;
      let balance = 0;
      let inverted = false;
      for (const ch of text) {
        if (ch === '“') balance++;
        else if (ch === '”') {
          balance--;
          if (balance < 0) inverted = true;
        }
      }
      if (openCount !== closeCount || inverted) {
        unclosed.push({ key, text: text.slice(0, 100), count: openCount + closeCount });
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

function findUnbalancedDelimDetails(data, open, close) {
  const matches = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((text, i) => {
      if (hasUnbalancedDelim(text, open, close)) {
        matches.push({ key: `${pg}.${i}`, text: text.slice(0, 100) });
      }
    });
  }
  return matches;
}

function findPatternDetails(data, re) {
  const matches = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((text, i) => {
      const m = text.match(re);
      if (m && m.length > 0) {
        matches.push({ key: `${pg}.${i}`, matches: m, text: text.slice(0, 100) });
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

function checkPhasePrerequisites(targetPhase, rootDir = ROOT) {
  const errors = [];
  if (!targetPhase || targetPhase <= 1 || !PHASES[targetPhase]) return errors;

  // Faz 2..5 başlamadan / geçmeden önce Faz 1 (Cilt 4 & 4.5) hedefleri (< 0.12 ort., < %0.5 3+ puanlı) sağlanmalıdır.
  for (const prereqVol of PHASES[1].volumes) {
    const cfg = VOLUMES[prereqVol];
    const abs = path.resolve(rootDir, cfg.tr);
    if (!fs.existsSync(abs)) {
      errors.push(`Faz 1 önkoşul dosyası eksik: ${cfg.tr}`);
      continue;
    }
    const schema = validateSchema(abs);
    if (!schema.ok) {
      errors.push(`Faz 1 (${cfg.label}) şema hatası`);
      continue;
    }
    const q = evaluateData(schema.data);
    const share = q.total > 0 ? q.flagged / q.total : 0;
    if (q.avg >= 0.12 || share >= MAX_FLAGGED_SHARE_STRICT) {
      errors.push(
        `Faz 1 (${cfg.label}) eşiği sağlanmadı: avg=${q.avg} (<0.12), 3+ oran=${(share * 100).toFixed(2)}% (<0.5%)`
      );
    }
  }
  return errors;
}

function main() {
  const { json, update, strict, checkRegression, selected, phase } = parseArgs();
  const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {};
  const result = {};
  const violations = [];

  if (phase && phase >= 2) {
    const prereqErrors = checkPhasePrerequisites(phase, ROOT);
    if (prereqErrors.length > 0) {
      violations.push({
        vol: `Faz ${phase}`,
        fails: prereqErrors.map((msg) => ({ label: 'önceki faz kapısı', value: msg })),
      });
    }
  }

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
        } else if (row[2].includes('dengesiz süslü parantez')) {
          details = findUnbalancedDelimDetails(data, '{', '}');
        } else if (row[2].includes('dengesiz köşeli parantez')) {
          details = findUnbalancedDelimDetails(data, '[', ']');
        } else if (row[2].includes('Japonca köşe tırnağı')) {
          details = findPatternDetails(data, /[『』「」]/g);
        } else if (row[2].includes('Kiril kalıntısı')) {
          details = findPatternDetails(data, /\p{Script=Cyrillic}+/gu);
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

    // 4. Yama Doğrulama ve Regresyon (Cilt 4 için)
    if (vol === '4') {
      const patchesFile = path.join(ROOT, 'scripts', 'patches.json');
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
      const avgExceeded =
        cfg.maxAvgStrict !== undefined &&
        (cfg.phase === 1 ? q.avg >= cfg.maxAvgStrict : q.avg > cfg.maxAvgStrict);
      if (avgExceeded) {
        hardFails.push({
          label: 'ortalama puan (strict limit aşıldı)',
          value: q.avg,
          baseline: cfg.phase === 1 ? `< ${cfg.maxAvgStrict}` : `<= ${cfg.maxAvgStrict}`,
        });
      }
      const flaggedShare = q.total > 0 ? q.flagged / q.total : 0;
      if (cfg.maxFlaggedShareStrict !== undefined && flaggedShare >= cfg.maxFlaggedShareStrict) {
        hardFails.push({
          label: '3+ puanlı paragraf oranı (strict %0.5 sınırı aşıldı)',
          value: `${(flaggedShare * 100).toFixed(2)}% (${q.flagged}/${q.total})`,
          baseline: '< 0.50%',
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
        'dengesiz süslü parantez',
        'dengesiz köşeli parantez',
        'Japonca köşe tırnağı',
        'Kiril kalıntısı',
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
  VOLUMES,
  KNOWN_PAGE_SPLIT_QUOTES,
  MAX_FLAGGED_SHARE_STRICT,
  parseArgs,
  checkPhasePrerequisites,
  validateSchema,
  findUnclosedQuotes,
  findEnglishResidueDetails,
  findTranslatorNotesDetails,
  findUnbalancedDelimDetails,
  findPatternDetails,
  generateMarkdownSummary,
};
