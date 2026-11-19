// Birleşik kalite kapısı: şema doğrulama + imla/noktalama + kalite puanı + eşik kontrolü + yama regresyon kapısı.
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
const {
  runVerify,
  hasUnbalancedDelim,
  hasInvertedCurlyQuotes,
  countLowercaseStarts,
  isCrossPageContinuation,
  loadGlossaryTypos,
} = require('./verify');
const { evaluateData, score } = require('./quality');
const { validatePatches, getPatchFilesForVolume } = require('../patch');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc6_typography');
const { ROOT, VOLUME_KEYS, VOLUMES: REGISTRY } = require('../lib/volumes');

const BASELINE_FILE = path.join(ROOT, 'data', 'qc_baseline.json');

const VOLUMES = Object.fromEntries(
  VOLUME_KEYS.map((k) => [
    k,
    {
      tr: REGISTRY[k].finalRel,
      chapters: path.relative(ROOT, REGISTRY[k].titlesFile),
      label: REGISTRY[k].label,
      maxAvgStrict: REGISTRY[k].maxAvgStrict,
      ...(REGISTRY[k].maxFlaggedShareStrict !== undefined
        ? { maxFlaggedShareStrict: REGISTRY[k].maxFlaggedShareStrict }
        : {}),
    },
  ])
);

// Sayfa bölünmesinden kaynaklanan gerçek tek sayıda tırnak içeren paragraflar
const KNOWN_PAGE_SPLIT_QUOTES = {
  '4': new Set([
    '31.1', '36.0', '54.13', '55.14', '115.14', '172.9',
    '175.14', '190.13', '254.14',
  ]),
  '4.5': new Set([
    '197.4',
  ]),
};

const ZERO_TOLERANCE = [
  'çift nokta',
  'noktalama öncesi boşluk',
  '"?." kalıbı',
  'bitişik/imla hatası',
  'sözlük/özel ad hatası',
  'düz tırnak',
  'ters kıvrık tırnak',
  'ayrık tırnak eki',
  'dengesiz parantez',
  'dengesiz süslü parantez',
  'dengesiz köşeli parantez',
  'Japonca köşe tırnağı',
  'Kiril kalıntısı',
  '-yyor fiil hatası',
  'küçük harfle başlayan cümle',
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

  let selected = [...VOLUME_KEYS];
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
        } else if (row[2].includes('dengesiz süslü parantez')) {
          details = findUnbalancedDelimDetails(data, '{', '}');
        } else if (row[2].includes('dengesiz köşeli parantez')) {
          details = findUnbalancedDelimDetails(data, '[', ']');
        } else if (row[2].includes('dengesiz parantez')) {
          for (const [pg, arr] of Object.entries(data)) {
            arr.forEach((t, i) => {
              const op = (t.match(/\(/g) || []).length;
              const cp = (t.match(/\)/g) || []).length;
              if (op !== cp) details.push(`s${pg}.${i} (${op}/${cp}): ${t.slice(0, 90)}`);
            });
          }
        } else if (row[2].includes('Japonca köşe tırnağı')) {
          details = findPatternDetails(data, /[『』「」]/g);
        } else if (row[2].includes('Kiril kalıntısı')) {
          details = findPatternDetails(data, /\p{Script=Cyrillic}+/gu);
        } else if (row[2].includes('ayrık tırnak eki')) {
          for (const [pg, arr] of Object.entries(data)) {
            arr.forEach((t, i) => {
              const m = t.match(DETACHED_QUOTE_SUFFIX_RE);
              if (m) details.push(`s${pg}.${i}: ${m.join(', ')}`);
            });
          }
        } else if (row[2].includes('-yyor')) {
          for (const [pg, arr] of Object.entries(data)) {
            arr.forEach((t, i) => {
              const m = t.match(/\S*yyor\S*/giu);
              if (m) details.push(`s${pg}.${i}: ${m.join(', ')}`);
            });
          }
        } else if (row[2].includes('küçük harfle başlayan cümle')) {
          const sortedPages = Object.keys(data).sort((a, b) => Number(a) - Number(b));
          sortedPages.forEach((pg, pi) => {
            data[pg].forEach((t, i) => {
              const allowInitialLower = isCrossPageContinuation(data, sortedPages, pi, i);
              if (countLowercaseStarts(t, { allowInitialLower }) > 0) {
                details.push(`s${pg}.${i}: ${t.slice(0, 90)}`);
              }
            });
          });
        } else if (row[2].includes('ters kıvrık tırnak')) {
          for (const [pg, arr] of Object.entries(data)) {
            arr.forEach((t, i) => {
              if (hasInvertedCurlyQuotes(t)) details.push(`s${pg}.${i}: ${t.slice(0, 90)}`);
            });
          }
        } else if (row[2].includes('sözlük/özel ad hatası')) {
          const gTypos = loadGlossaryTypos();
          for (const [pg, arr] of Object.entries(data)) {
            arr.forEach((t, i) => {
              for (const g of gTypos) {
                const m = t.match(g.re);
                if (m) details.push(`s${pg}.${i}: ${g.from} -> ${g.to}`);
              }
            });
          }
        }
        hardFails.push({ label: row[2], value: row[1], details });
      }
    }

    // 2b. Bölüm başlıkları (TOC) çeviri kalıbı denetimi
    if (cfg.chapters) {
      const chPath = path.resolve(ROOT, cfg.chapters);
      if (fs.existsSync(chPath)) {
        try {
          const chObj = JSON.parse(fs.readFileSync(chPath, 'utf8'));
          const tocEntries = [];
          if (Array.isArray(chObj.chapters)) {
            for (const c of chObj.chapters) {
              if (c && typeof c.title === 'string') tocEntries.push([c.label || 'Bölüm', c.title]);
            }
          } else if (chObj.titles && typeof chObj.titles === 'object') {
            for (const [ck, cv] of Object.entries(chObj.titles)) {
              if (typeof cv === 'string') tocEntries.push([ck, cv]);
            }
          } else {
            for (const [ck, cv] of Object.entries(chObj)) {
              if (typeof cv === 'string') tocEntries.push([ck, cv]);
            }
          }
          const tocCalques = [];
          for (const [ck, cv] of tocEntries) {
            const sc = score(0, 0, `${ck}: ${cv}`);
            if (sc.score >= 3 || /(?<!\p{L})(?:ben|sen|o|biz|siz|onlar|benim|senin|onun|bizim|sizin|onların)\s+tarafından(?!\p{L})/giu.test(cv)) {
              tocCalques.push(`${ck}: ${cv}`);
            }
          }
          if (tocCalques.length > 0) {
            hardFails.push({
              label: 'bölüm başlığı çeviri kalıbı (TOC)',
              value: tocCalques.length,
              details: tocCalques,
            });
          }
        } catch (e) {
          hardFails.push({ label: 'chapters.json hatası', value: e.message });
        }
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

    // 4. Yama Doğrulama ve Regresyon (düz ve sürümlü yama haritaları)
    const patchFiles = getPatchFilesForVolume(vol);
    for (const patchesFile of patchFiles) {
      if (fs.existsSync(patchesFile)) {
        try {
          const patches = JSON.parse(fs.readFileSync(patchesFile, 'utf8'));
          const patchRes = validatePatches(patches, data, { dryRun: true });
          if (!patchRes.ok) {
            hardFails.push({
              label: `geçersiz yama formatı / regresyonu (${path.relative(ROOT, patchesFile)})`,
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
    const flaggedShare = q.total > 0 ? q.flagged / q.total : 0;
    if (strict) {
      if (cfg.maxAvgStrict !== undefined && q.avg > cfg.maxAvgStrict) {
        hardFails.push({
          label: 'ortalama puan (strict limit aşıldı)',
          value: q.avg,
          baseline: cfg.maxAvgStrict,
        });
      }
      if (cfg.maxFlaggedShareStrict !== undefined && flaggedShare > cfg.maxFlaggedShareStrict) {
        hardFails.push({
          label: 'yüksek kusur oranı 3+ puan (strict limit aşıldı)',
          value: `${(flaggedShare * 100).toFixed(2)}% (${q.flagged}/${q.total})`,
          baseline: `<=${(cfg.maxFlaggedShareStrict * 100).toFixed(2)}%`,
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

      const displayRows = [
        ['çift nokta', 'çift nokta'],
        ['"?." kalıbı', '"?." kalıbı'],
        ['bitişik/imla hatası', 'bitişik/imla hatası'],
        ['sözlük/özel ad hatası', 'sözlük/özel ad hatası'],
        ['düz tırnak', 'düz tırnak'],
        ['ters kıvrık tırnak', 'ters kıvrık tırnak'],
        ['ayrık tırnak eki', 'ayrık tırnak eki'],
        ['dengesiz parantez', 'dengesiz parantez'],
        ['dengesiz süslü parantez', 'dengesiz süslü parantez'],
        ['dengesiz köşeli parantez', 'dengesiz köşeli parantez'],
        ['Japonca köşe tırnağı', 'Japonca köşe tırnağı'],
        ['Kiril kalıntısı', 'Kiril kalıntısı'],
        ['-yyor fiil hatası', '-yyor fiil hatası'],
        ['küçük harf başlangıç', 'küçük harfle başlayan cümle'],
        ['İngilizce kalıntı', 'İngilizce kalıntı'],
        ['çevirmen notu', 'çevirmen notu'],
      ];
      for (const [disp, matchKey] of displayRows) {
        const row = r.verify.find((x) => x.label.includes(matchKey));
        if (row) console.log('   ' + disp.padEnd(24), row.value);
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
  validateSchema,
  findUnclosedQuotes,
  findEnglishResidueDetails,
  findTranslatorNotesDetails,
  findUnbalancedDelimDetails,
  findPatternDetails,
  generateMarkdownSummary,
};
