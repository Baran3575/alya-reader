// Birleşik kalite kapısı: şema doğrulama + kaynak sadakati + imla/noktalama + kalite puanı + eşik kontrolü + yama regresyon kapısı.
// Kullanım:
//   node scripts/qc/cli.js                         # Kayıtlı tüm ciltler (4 – 12)
//   node scripts/qc/cli.js --volume <4..12>        # Belirli cilt
//   node scripts/qc/cli.js --strict                # Sıkı eşik kapısı (ort. puan <= 0.20, hata payı sıfır)
//   node scripts/qc/cli.js --check-regression      # Taban çizgisi ve yama regresyon kontrolü
//   node scripts/qc/cli.js --json                  # Makine okunur JSON çıktısı
//   node scripts/qc/cli.js --update-baseline       # Taban çizgisini mevcut değerlerle güncelle
// Çıkış kodu: 0 = tüm kontroller başarılı, 1 = ihlal veya regresyon var.

const fs = require('fs');
const path = require('path');
const { runVerify, URL_TOKEN_RE, FAN_TL_SPAM_RE } = require('./verify');
const { evaluateData } = require('./quality');
const { checkCoverageGates } = require('./fidelity');
const { validatePatches } = require('../patch');
const { ROOT, VOLUME_KEYS, VOLUMES: REGISTRY } = require('../lib/volumes');

const BASELINE_FILE = path.join(ROOT, 'data', 'qc_baseline.json');

const VOLUMES = Object.fromEntries(
  VOLUME_KEYS.map((k) => [
    k,
    {
      tr: REGISTRY[k].finalRel,
      src: REGISTRY[k].sourceRel,
      bil: REGISTRY[k].bilingualRel,
      label: REGISTRY[k].label,
      maxAvgStrict: REGISTRY[k].maxAvgStrict ?? 0.20,
      stitchedBoundaries: Boolean(REGISTRY[k].stitchedBoundaries),
    },
  ])
);

function resolveVolumeConfig(vol) {
  const v = String(vol).trim();
  if (VOLUMES[v]) return VOLUMES[v];
  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const dir = v === '4' ? 'data' : 'data' + v.replace(/\./g, '');
    if (fs.existsSync(path.join(ROOT, dir))) {
      return {
        tr: `${dir}/paragraphs_final.json`,
        src: `${dir}/source.json`,
        bil: `${dir}/bilingual.json`,
        label: `Cilt ${v}`,
        maxAvgStrict: 0.20,
        stitchedBoundaries: false,
      };
    }
  }
  return null;
}

// Sayfa bölünmesinden kaynaklanan bilinen tek sayıda tırnak içeren paragraflar
// Yalnızca sayfa başı (idx === 0) veya sayfa sonu (idx === page.length - 1) izinli; sayfa ortası (0 < idx < page.length - 1) yasaktır.
const KNOWN_PAGE_SPLIT_QUOTES = {
  '4': new Set([]),
  '4.5': new Set([]),
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
  'fan-TL spam',
  'glucosetl',
  'discord.gg',
  'novelupdates',
  'lightnovelreader',
  'Goldenagato',
  'mp4directs',
  'zerobooks',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const update = args.includes('--update-baseline');
  const strict = args.includes('--strict');
  const checkRegression = args.includes('--check-regression');

  let selected = [...VOLUME_KEYS];
  const volIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  if (volIdx > -1 && args[volIdx + 1]) {
    const val = String(args[volIdx + 1]).trim();
    selected = [val];
  } else {
    const eqArg = args.find((a) => a.startsWith('--volume=') || a.startsWith('--vol='));
    if (eqArg) selected = [eqArg.split('=')[1].trim()];
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

function getKnownSplitQuotesSet(vol) {
  if (process.env.ALYA_KNOWN_SPLIT_QUOTES) {
    try {
      const parsed = JSON.parse(process.env.ALYA_KNOWN_SPLIT_QUOTES);
      if (parsed && Array.isArray(parsed[vol])) return new Set(parsed[vol].map(String));
    } catch {}
  }
  return KNOWN_PAGE_SPLIT_QUOTES[vol] || new Set();
}

function auditKnownPageSplitQuotes(data, vol, customKnownSet = null) {
  const known = customKnownSet || getKnownSplitQuotesSet(vol);
  const violations = [];
  for (const key of known) {
    if (!/^\d+\.\d+$/.test(String(key))) {
      violations.push(`geçersiz anahtar biçimi: "${key}"`);
      continue;
    }
    const [pg, idxStr] = String(key).split('.');
    const idx = Number(idxStr);
    const page = data[pg];
    if (!Array.isArray(page) || idx < 0 || idx >= page.length) {
      violations.push(`mevcut olmayan paragraf istisnası: "${key}"`);
      continue;
    }
    if (idx > 0 && idx < page.length - 1) {
      violations.push(`sayfa ortası tırnak istisnası yasak: "${key}" (indeks ${idx}, sayfa uzunluğu ${page.length})`);
    }
  }
  return violations;
}

function findUnclosedQuotes(data, vol, customKnownSet = null) {
  const known = customKnownSet || getKnownSplitQuotesSet(vol);
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
      const clean = text.replace(URL_TOKEN_RE, '');
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

function findFanTlSpamDetails(data) {
  const matches = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((text, i) => {
      const m = text.match(FAN_TL_SPAM_RE);
      if (m && m.length > 0) {
        matches.push({ key: `${pg}.${i}`, domains: m, text: text.slice(0, 100) });
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
    const cfg = resolveVolumeConfig(vol);
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

    const srcAbs = cfg.src ? path.resolve(ROOT, cfg.src) : null;
    const bilAbs = cfg.bil ? path.resolve(ROOT, cfg.bil) : null;
    const srcData = srcAbs && fs.existsSync(srcAbs) ? JSON.parse(fs.readFileSync(srcAbs, 'utf8')) : null;
    const bilData = bilAbs && fs.existsSync(bilAbs) ? JSON.parse(fs.readFileSync(bilAbs, 'utf8')) : null;

    const hardFails = [];

    // 2. Sıfır Tolerans Doğrulama Kontrolleri
    for (const row of verifyData.rows) {
      if (ZERO_TOLERANCE.some((z) => row[2].includes(z)) && row[1] > 0) {
        let details = [];
        if (row[2].includes('İngilizce kalıntı')) {
          details = findEnglishResidueDetails(data);
        } else if (row[2].includes('çevirmen notu')) {
          details = findTranslatorNotesDetails(data);
        } else if (row[2].includes('fan-TL spam')) {
          details = findFanTlSpamDetails(data);
        }
        hardFails.push({ label: row[2], value: row[1], details });
      }
    }

    // 3. KNOWN_PAGE_SPLIT_QUOTES denetimi (sayfa ortası tırnak istisnası yasak) ve kapanmamış tırnaklar
    const quoteWhitelistViolations = auditKnownPageSplitQuotes(data, vol);
    if (quoteWhitelistViolations.length > 0) {
      hardFails.push({
        label: 'sayfa ortası tırnak istisnası (KNOWN_PAGE_SPLIT_QUOTES)',
        value: quoteWhitelistViolations.length,
        details: quoteWhitelistViolations,
      });
    }

    const unclosedQuotes = findUnclosedQuotes(data, vol);
    if (unclosedQuotes.length > 0) {
      hardFails.push({
        label: 'kapanmamış tırnak',
        value: unclosedQuotes.length,
        details: unclosedQuotes.map((u) => `s${u.key}: ${u.text}`),
      });
    }

    // 4. Deterministik Kaynak Sadakati ve Sayfa Sınırı Kapıları (source.json + bilingual.json)
    if (srcData) {
      const cov = checkCoverageGates({
        src: srcData,
        tr: data,
        bil: bilData,
        bounds: { checkBoundaries: Boolean(cfg.stitchedBoundaries) },
      });
      if (cov.emptyBilingual.length > 0) {
        hardFails.push({
          label: 'boş bilingual çeviri yuvası ({g:"", d:""})',
          value: cov.emptyBilingual.length,
          details: cov.emptyBilingual,
        });
      }
      if (cov.emptyUsablePages.length > 0) {
        hardFails.push({
          label: 'eksik sayfa çevirisi (0 paragraf)',
          value: cov.emptyUsablePages.length,
          details: cov.emptyUsablePages,
        });
      }
      if (cov.pageRatioViolations.length > 0) {
        hardFails.push({
          label: 'sayfa EN-TR kelime oranı sınırı ihlali',
          value: cov.pageRatioViolations.length,
          details: cov.pageRatioViolations,
        });
      }
      if (cov.pageParaViolations.length > 0) {
        hardFails.push({
          label: 'sayfa paragraf sayısı sınırı ihlali',
          value: cov.pageParaViolations.length,
          details: cov.pageParaViolations,
        });
      }
      if (cov.windowViolations.length > 0) {
        hardFails.push({
          label: 'iki sayfa penceresi EN-TR kapsam ihlali',
          value: cov.windowViolations.length,
          details: cov.windowViolations,
        });
      }
      if (cov.splitBoundaryViolations.length > 0) {
        hardFails.push({
          label: 'sayfa sınırı yarım cümle / küçük harf başlangıcı',
          value: cov.splitBoundaryViolations.length,
          details: cov.splitBoundaryViolations,
        });
      }
    }

    // 5. Yama Doğrulama ve Regresyon (Cilt 4 için)
    if (vol === '4') {
      const patchesFile = path.join(ROOT, 'scripts', 'patches.json');
      if (fs.existsSync(patchesFile)) {
        try {
          const patches = JSON.parse(fs.readFileSync(patchesFile, 'utf8'));
          const patchRes = validatePatches(patches, data, { dryRun: true, source: srcData });
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

    // 6. Kalite Puanı Eşik ve Regresyon Kapısı
    if (strict) {
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
        'fan-TL spam',
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
  ZERO_TOLERANCE,
  resolveVolumeConfig,
  validateSchema,
  auditKnownPageSplitQuotes,
  findUnclosedQuotes,
  findEnglishResidueDetails,
  findTranslatorNotesDetails,
  findFanTlSpamDetails,
  generateMarkdownSummary,
};
