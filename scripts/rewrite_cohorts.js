// Kaynak hizalı (EN + komşu bağlam) edebî yeniden yazım ve koruyucu doğrulama hattı.
// Çevrimdışı çalışır; kabul edilen adayları scripts/patch.js ile doğrulanan sürümlü yama haritalarına
// (data/patches_v1.json ve data45/patches_v1.json) kaydeder.
// Kullanım:
//   node scripts/rewrite_cohorts.js --export /tmp/cohorts.json [--volume 4|4.5] [--include-score2-all]
//   node scripts/rewrite_cohorts.js --apply /tmp/candidates.json [--dry-run]
//   node scripts/rewrite_cohorts.js --llm [--volume 4|4.5]   # LLM_API_KEY / OPENAI_API_KEY tanımlıysa çevrimdışı API kipi

const fs = require('fs');
const path = require('path');
const { paragraphs: splitSourceParagraphs } = require('./translate3');
const { score, evaluateData } = require('./qc/quality');
const { hasUnbalancedDelim, hasInvertedCurlyQuotes, countLowercaseStarts, loadGlossaryTypos } = require('./qc/verify');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc/qc6_typography');
const { validatePatches } = require('./patch');

const ROOT = path.join(__dirname, '..');

// scripts/qc/audit_meaning.js ile uyumlu olumsuzluk ve sayı denetimi kalıpları
const NEG_EN = /\b(not|n't|n’t|no|never|none|nothing|nobody|nowhere|neither|nor|cannot|can't|can’t|won't|won’t|don't|don’t|doesn't|doesn’t|didn't|didn’t|isn't|isn’t|aren't|aren’t|wasn't|wasn’t|weren't|weren’t|couldn't|couldn’t|wouldn't|wouldn’t|shouldn't|shouldn’t|hardly|barely|scarcely|without)\b/i;
const NEG_TR =
  /(?<!\p{L})(değil|değildi|değildir|yok|yoktu|yoktur|asla|hiç|hiçbir|hiçbiri|kimse|ne\s+[\p{L}\s]{1,30}\s+ne\s+de|olmaz|olmuyor|olmadan|olmadığı|olmayacak|edemez|yapamaz|bilemez)(?!\p{L})|(?:ma|me|mı|mi|mu|mü)(?:dı|di|du|dü|mış|miş|muş|müş|yacak|yecek|yor|yordu|mak|mek|dan|den|madan|meden)(?!\p{L})|(?:amaz|emez|maz|mez|madı|medi|madım|medim|madın|medin|madık|medik|madınız|mediniz|sız|siz|suz|süz|sızca|sizce)(?!\p{L})/iu;

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;

const TR_NUMBER_WORDS = {
  '0': ['sıfır'],
  '1': ['bir', 'birinci', 'ilk', 'tek'],
  '2': ['iki', 'ikinci', 'çift', 'ikiz'],
  '3': ['üç', 'üçüncü', 'üçlü'],
  '4': ['dört', 'dördüncü'],
  '5': ['beş', 'beşinci'],
  '6': ['altı', 'altıncı'],
  '7': ['yedi', 'yedinci'],
  '8': ['sekiz', 'sekizinci'],
  '9': ['dokuz', 'dokuzuncu'],
  '10': ['on', 'onuncu'],
  '11': ['on bir', 'on birinci'],
  '12': ['on iki', 'on ikinci'],
  '20': ['yirmi'],
  '30': ['otuz'],
  '50': ['elli'],
  '70': ['yetmiş'],
  '100': ['yüz'],
};

const CANONICAL_CHARACTERS = [
  'Masachika',
  'Kuze',
  'Alisa',
  'Alya',
  'Maria',
  'Masha',
  'Yuki',
  'Ayano',
  'Sayaka',
  'Chisaki',
  'Touya',
  'Nonoa',
  'Sarashina',
  'Suou',
  'Kujou',
  'Kimishima',
];

const KNOWN_SPLIT_QUOTES = {
  '4': new Set(['31.1', '36.0', '54.13', '55.14', '115.14', '172.9', '175.14', '190.13', '254.14']),
  '4.5': new Set(['197.4']),
};

const AUDITED_TARGETS = {
  '4': new Set(['13.10', '71.8', '83.7', '93.5', '137.1', '171.3', '173.4', '209.5', '211.10', '212.1', '241.0', '267.6', '280.0']),
  '4.5': new Set(['10.2', '17.5', '133.0', '170.0', '192.3', '205.3', '268.3', '284.2', '286.2', '287.2', '287.3', '345.3']),
};

const VOL_CONFIG = {
  '4': {
    trFile: path.join(ROOT, 'data', 'paragraphs_final.json'),
    srcFile: path.join(ROOT, 'data', 'source.json'),
    patchOut: path.join(ROOT, 'data', 'patches_v1.json'),
    curatedPatchFile: path.join(ROOT, 'scripts', 'patches.json'),
  },
  '4.5': {
    trFile: path.join(ROOT, 'data45', 'paragraphs_final.json'),
    srcFile: path.join(ROOT, 'data45', 'source.json'),
    patchOut: path.join(ROOT, 'data45', 'patches_v1.json'),
    curatedPatchFile: null,
  },
};

function isPreservedHandPageV4(pgNum, key, curatedPatches) {
  if ((pgNum >= 14 && pgNum <= 55) || (pgNum >= 132 && pgNum <= 135)) return true;
  if (curatedPatches && Object.prototype.hasOwnProperty.call(curatedPatches, key)) return true;
  return false;
}

function cleanSourcePageText(raw) {
  return String(raw || '')
    .replace(/Page\s+\d+\s*Goldenagato[^\n]*/gi, '')
    .replace(/Goldenagato[^\n]*/gi, '')
    .replace(/Page\s+\d+/gi, '')
    .trim();
}

function extractNumbers(text) {
  const clean = String(text || '')
    .replace(/https?:\s*\/\/[^\s)]+/gi, '')
    .replace(/Page\s+\d+/gi, '')
    .replace(/\b[23]D\b/gi, '');
  return [...new Set(clean.match(/\d+/g) || [])];
}

function hasNumberInTurkish(candidateTr, numStr) {
  if (new RegExp('(?<!\\d)' + numStr + '(?!\\d)').test(candidateTr)) return true;
  const lower = candidateTr.toLocaleLowerCase('tr');
  const words = TR_NUMBER_WORDS[numStr] || [];
  return words.some((w) => new RegExp('(?<!\\p{L})' + w + '(?!\\p{L})', 'u').test(lower));
}

function checkNegationAlignment(enText, origTr, candidateTr) {
  if (!enText || enText.length < 30) return { ok: true };
  const enNeg = NEG_EN.test(enText);
  NEG_TR.lastIndex = 0;
  const origNeg = NEG_TR.test(origTr);
  NEG_TR.lastIndex = 0;
  const candNeg = NEG_TR.test(candidateTr);
  NEG_TR.lastIndex = 0;

  // Eğer kaynak ve mevcut taslak olumsuzluk yönünden uzlaşıyorsa ve aday bunu tersine çeviriyorsa reddet
  if (enNeg === origNeg && candNeg !== enNeg) {
    return {
      ok: false,
      reason: `Olumsuzluk uyumsuzluğu: EN=${enNeg}, taslak=${origNeg}, aday=${candNeg}`,
    };
  }
  return { ok: true };
}

function checkNumberAlignment(enText, origTr, candidateTr) {
  const enNums = extractNumbers(enText);
  const origNums = extractNumbers(origTr);
  // Hem kaynakta hem taslakta ortak olan sayıları aday metin korumalıdır
  const shared = enNums.length > 0 ? enNums.filter((n) => origNums.includes(n) || hasNumberInTurkish(origTr, n)) : origNums;
  for (const n of shared) {
    if (!hasNumberInTurkish(candidateTr, n)) {
      return { ok: false, reason: `Sayı kaybı: kaynak/taslaktaki "${n}" aday metinde bulunamadı.` };
    }
  }
  return { ok: true };
}

function validateCandidate({ key, vol = '4', enText = '', origTr, candidateTr }) {
  const errors = [];

  if (typeof candidateTr !== 'string' || !candidateTr.trim()) {
    return { ok: false, errors: ['Aday metin boş olamaz.'] };
  }

  // 1. Düz tırnak ve ters kıvrık tırnak kontrolü
  if (/["']/.test(candidateTr)) {
    errors.push('Düz tırnak/kesme işareti içeriyor.');
  }
  if (hasInvertedCurlyQuotes(candidateTr)) {
    errors.push('Ters yönlü veya bitişik yığılmış kıvrık tırnak içeriyor.');
  }

  // 2. Kıvrık tırnak tek/çift dengesi
  const knownSplit = (KNOWN_SPLIT_QUOTES[vol] || new Set()).has(key);
  const curlyCount = (candidateTr.match(/[“”]/g) || []).length;
  if (!knownSplit && curlyCount % 2 !== 0) {
    errors.push(`Kapanmamış kıvrık tırnak (toplam ${curlyCount}).`);
  }

  // 3. Parantez, süslü parantez (Rusça fısıltı) ve köşeli parantez dengesi + köşe tırnağı / Kiril yasağı
  const openP = (candidateTr.match(/\(/g) || []).length;
  const closeP = (candidateTr.match(/\)/g) || []).length;
  if (openP !== closeP) {
    errors.push(`Dengesiz parantez (${openP} açılış, ${closeP} kapanış).`);
  }
  if (hasUnbalancedDelim(candidateTr, '{', '}')) {
    errors.push('Dengesiz süslü parantez ({…}) içeriyor.');
  }
  if (hasUnbalancedDelim(candidateTr, '[', ']')) {
    errors.push('Dengesiz köşeli parantez ([…]) içeriyor.');
  }
  if (/[『』「」]/.test(candidateTr)) {
    errors.push('Japonca köşe tırnağı (『』「」) içeriyor.');
  }
  if (/\p{Script=Cyrillic}/u.test(candidateTr)) {
    errors.push('Kiril karakteri içeriyor.');
  }

  // 4. Sıfır tolerans kontrolleri (ayrık ek, -yyor, küçük harf başlangıç, İngilizce kalıntı, ÇN)
  DETACHED_QUOTE_SUFFIX_RE.lastIndex = 0;
  if (DETACHED_QUOTE_SUFFIX_RE.test(candidateTr)) {
    errors.push('Ayrık tırnak eki içeriyor.');
  }
  DETACHED_QUOTE_SUFFIX_RE.lastIndex = 0;

  if (/\p{L}yyor/iu.test(candidateTr)) {
    errors.push('Bozuk -yyor fiil eki içeriyor.');
  }
  if (/\.{2,}/.test(candidateTr) || /\s+[,.;:!?]/.test(candidateTr) || /[!?]\./.test(candidateTr)) {
    errors.push('Noktalama hatası (çift nokta / boşluk / ?.) içeriyor.');
  }
  if (countLowercaseStarts(candidateTr) > 0) {
    errors.push('Küçük harfle başlayan cümle içeriyor.');
  }
  TN_RE.lastIndex = 0;
  if (TN_RE.test(candidateTr)) {
    errors.push('Çevirmen notu (ÇN/TN) içeriyor.');
  }
  TN_RE.lastIndex = 0;

  const cleanEn = candidateTr.replace(/https?:\s*\/\/[^\n]+/gi, '');
  const enRes = cleanEn.match(EN_RESIDUE_RE);
  if (enRes && enRes.length > 0) {
    errors.push(`İngilizce kalıntı içeriyor: ${enRes.join(', ')}`);
  }

  // 5. Sözlük yazım hataları ve özel ad korunumu
  const glossaryTypos = loadGlossaryTypos();
  for (const g of glossaryTypos) {
    g.re.lastIndex = 0;
    if (g.re.test(candidateTr)) {
      errors.push(`Sözlük yazım hatası: "${g.from}" -> "${g.to}" kullanılmalı.`);
    }
    g.re.lastIndex = 0;
  }

  for (const name of CANONICAL_CHARACTERS) {
    const nameRe = new RegExp('(?<!\\p{L})' + name + '(?!\\p{L})', 'u');
    if (enText && nameRe.test(enText) && nameRe.test(origTr) && !nameRe.test(candidateTr)) {
      errors.push(`Özel ad kaybı: kaynakta ve taslakta geçen "${name}" korunmadı.`);
    }
  }

  // 6. Olumsuzluk ve sayı hizalaması (audit_meaning)
  const negRes = checkNegationAlignment(enText, origTr, candidateTr);
  if (!negRes.ok) errors.push(negRes.reason);

  const numRes = checkNumberAlignment(enText, origTr, candidateTr);
  if (!numRes.ok) errors.push(numRes.reason);

  // 7. Kalite puanı regresyon denetimi (quality.js)
  const [pg, idxStr] = key.split('.');
  const sBefore = score(pg, Number(idxStr), origTr);
  const sAfter = score(pg, Number(idxStr), candidateTr);
  if (sAfter.score > sBefore.score) {
    errors.push(`Kalite cezası arttı: ${sBefore.score} -> ${sAfter.score} (${sAfter.notes.join(', ')})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    scoreBefore: sBefore.score,
    scoreAfter: sAfter.score,
    notesAfter: sAfter.notes,
  };
}

function buildAlignedRecords(vol, options = {}) {
  const cfg = VOL_CONFIG[vol];
  const trData = JSON.parse(fs.readFileSync(cfg.trFile, 'utf8'));
  const srcArr = JSON.parse(fs.readFileSync(cfg.srcFile, 'utf8'));
  const curatedPatches = cfg.curatedPatchFile && fs.existsSync(cfg.curatedPatchFile)
    ? JSON.parse(fs.readFileSync(cfg.curatedPatchFile, 'utf8'))
    : {};

  const srcByPage = new Map();
  for (const p of srcArr) srcByPage.set(String(p.page), p);

  const pages = Object.keys(trData)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b);

  // Komşu bağlam için düz liste
  const flat = [];
  for (const pgNum of pages) {
    const pg = String(pgNum);
    const arr = trData[pg] || [];
    const sp = srcByPage.get(pg);
    const rawPageEn = sp ? cleanSourcePageText(sp.text) : '';
    const splitEn = sp ? splitSourceParagraphs(sp.text || '') : [];
    const exactAligned = splitEn.length === arr.length;

    arr.forEach((trText, idx) => {
      const key = `${pg}.${idx}`;
      const q = score(pg, idx, trText);
      flat.push({
        vol,
        key,
        page: pgNum,
        idx,
        tr: trText,
        enAligned: exactAligned ? splitEn[idx] : '',
        enPage: rawPageEn,
        score: q.score,
        notes: q.notes,
        preserved: vol === '4' && isPreservedHandPageV4(pgNum, key, curatedPatches),
      });
    });
  }

  const calqueRe = /bir şekilde|(?<!\p{L})Bunun(?!\p{L})|(?<!\p{L})Ancak(?!\p{L})|tarafından/gu;
  const cohorts = [];

  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    if (item.preserved) continue;

    const reasons = [];
    if (vol === '4.5' && item.page >= 306 && item.page <= 347) reasons.push('google_only_306_347');
    if (item.score >= 3) reasons.push('score_ge_3');
    calqueRe.lastIndex = 0;
    if (item.score === 2 && (options.includeScore2All || calqueRe.test(item.tr))) reasons.push('score_2_calque');
    if ((AUDITED_TARGETS[vol] || new Set()).has(item.key)) reasons.push('audited_defect');

    if (reasons.length === 0) continue;

    cohorts.push({
      vol: item.vol,
      key: item.key,
      page: item.page,
      idx: item.idx,
      reasons,
      scoreBefore: item.score,
      notesBefore: item.notes,
      prevTr: i > 0 ? flat[i - 1].tr : '',
      tr: item.tr,
      nextTr: i + 1 < flat.length ? flat[i + 1].tr : '',
      enAligned: item.enAligned,
      enPage: item.enAligned ? undefined : item.enPage,
    });
  }

  return cohorts;
}

function applyCandidateMap(candidatesByVol, options = {}) {
  const summary = {};
  for (const [vol, candMap] of Object.entries(candidatesByVol)) {
    const cfg = VOL_CONFIG[vol];
    if (!cfg || !candMap || Object.keys(candMap).length === 0) continue;

    const trData = JSON.parse(fs.readFileSync(cfg.trFile, 'utf8'));
    const srcArr = JSON.parse(fs.readFileSync(cfg.srcFile, 'utf8'));
    const srcByPage = new Map(srcArr.map((p) => [String(p.page), p]));

    let existingPatchMap = { version: 1, volume: vol, patches: {} };
    if (fs.existsSync(cfg.patchOut)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cfg.patchOut, 'utf8'));
        if (parsed && parsed.patches) existingPatchMap = parsed;
      } catch {}
    }

    const accepted = {};
    const rejected = [];

    for (const [key, candidateTr] of Object.entries(candMap)) {
      const [pg, idxStr] = key.split('.');
      const idx = Number(idxStr);
      if (!trData[pg] || trData[pg][idx] === undefined) {
        rejected.push({ key, errors: ['Hedef paragraf mevcut değil.'] });
        continue;
      }
      const origTr = trData[pg][idx];
      const sp = srcByPage.get(pg);
      const splitEn = sp ? splitSourceParagraphs(sp.text || '') : [];
      const enAligned = splitEn.length === trData[pg].length ? splitEn[idx] : '';

      const res = validateCandidate({
        key,
        vol,
        enText: enAligned,
        origTr,
        candidateTr,
      });

      if (!res.ok) {
        rejected.push({ key, errors: res.errors, candidateTr });
      } else {
        accepted[key] = candidateTr;
      }
    }

    const mergedPatches = {
      version: existingPatchMap.version || 1,
      volume: vol,
      description: `Cilt ${vol} kaynak-hizalı edebî yeniden yazım ve onarım yamaları`,
      patches: { ...existingPatchMap.patches, ...accepted },
    };

    // scripts/patch.js ile şema ve regresyon doğrulaması
    const patchCheck = validatePatches(mergedPatches, trData, { dryRun: true });
    if (!patchCheck.ok) {
      throw new Error(`patch.js doğrulama hatası (Cilt ${vol}):\n` + patchCheck.errors.join('\n'));
    }

    const previewTrData = options.dryRun ? JSON.parse(JSON.stringify(trData)) : trData;
    for (const [key, text] of Object.entries(accepted)) {
      const [pg, idxStr] = key.split('.');
      previewTrData[pg][Number(idxStr)] = text;
    }

    if (!options.dryRun) {
      fs.writeFileSync(cfg.patchOut, JSON.stringify(mergedPatches, null, 2) + '\n');
      fs.writeFileSync(cfg.trFile, JSON.stringify(previewTrData) + '\n');
    }

    const afterEval = evaluateData(previewTrData);
    summary[vol] = {
      acceptedCount: Object.keys(accepted).length,
      rejectedCount: rejected.length,
      rejected,
      totalPatchesSaved: Object.keys(mergedPatches.patches).length,
      avgAfter: afterEval.avg,
      flaggedAfter: afterEval.flagged,
    };
  }
  return summary;
}

async function runOfflineLlmBatch(cohorts) {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  const apiUrl = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    throw new Error('Çevrimdışı LLM API kipi için LLM_API_KEY veya OPENAI_API_KEY ortam değişkeni gereklidir.');
  }

  const out = { '4': {}, '4.5': {} };
  for (const item of cohorts) {
    const prompt = [
      'Aşağıdaki light novel paragrafını İngilizce kaynağa ve komşu bağlama sadık, akıcı edebî Türkçeye yeniden yaz.',
      'Kurallar: kıvrık tırnak (“ ” ’) kullan, parantez ve tırnak dengesini koru, özel adları (Masachika, Alisa, Alya, Maria, Masha, Yuki, Ayano, Sayaka, Chisaki, Touya, Nonoa, Kuze-kun, Onii-sama) değiştirme, çevirmen notu ekleme, yalnızca tek paragraf metni döndür.',
      `Önceki TR: ${item.prevTr}`,
      `Kaynak EN: ${item.enAligned || item.enPage}`,
      `Mevcut TR: ${item.tr}`,
      `Sonraki TR: ${item.nextTr}`,
    ].join('\n');

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const body = await res.json();
    const text = (body.choices?.[0]?.message?.content || '').trim();
    if (text) out[item.vol][item.key] = text;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const includeScore2All = args.includes('--include-score2-all');
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vols = vIdx > -1 && args[vIdx + 1] ? [String(args[vIdx + 1])] : ['4', '4.5'];

  const exportIdx = args.indexOf('--export');
  if (exportIdx > -1 && args[exportIdx + 1]) {
    const outPath = path.resolve(args[exportIdx + 1]);
    const all = [];
    for (const v of vols) all.push(...buildAlignedRecords(v, { includeScore2All }));
    fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n');
    console.log(`✓ ${all.length} hedef paragraf dışa aktarıldı: ${outPath}`);
    return;
  }

  const applyIdx = args.indexOf('--apply');
  if (applyIdx > -1 && args[applyIdx + 1]) {
    const inPath = path.resolve(args[applyIdx + 1]);
    const input = JSON.parse(fs.readFileSync(inPath, 'utf8'));
    const summary = applyCandidateMap(input, { dryRun });
    console.log(JSON.stringify(summary, null, 2));
    const totalRejected = Object.values(summary).reduce((a, s) => a + s.rejectedCount, 0);
    if (totalRejected > 0) process.exit(1);
    return;
  }

  if (args.includes('--llm')) {
    const all = [];
    for (const v of vols) all.push(...buildAlignedRecords(v, { includeScore2All }));
    const candidates = await runOfflineLlmBatch(all);
    const summary = applyCandidateMap(candidates, { dryRun });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const v of vols) {
    const items = buildAlignedRecords(v, { includeScore2All });
    console.log(`Cilt ${v}: ${items.length} hedef paragraf seçildi.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  validateCandidate,
  checkNegationAlignment,
  checkNumberAlignment,
  buildAlignedRecords,
  applyCandidateMap,
};
