// EN kaynağı ile TR çevirisi arasında sayfa bazlı sadakat ölçümü
const fs = require('fs');
const path = require('path');
const { sourceParagraphs, NOISE_LINE_RE, TN_BLOCK_RE } = require('../../mt/paragraphs');

const ROOT = path.join(__dirname, '..', '..');

const NAMES = [
  'Masachika', 'Kuze', 'Alisa', 'Alya', 'Maria', 'Masha', 'Yuki', 'Ayano',
  'Sayaka', 'Touya', 'Chisaki', 'Nonoa', 'Kinjou', 'Mimiko', 'Sarashina',
  'Kenzaki', 'Suou', 'Kujou',
];

function resolveVolumeDir(vol = '4') {
  const v = String(vol);
  if (v === '4') return 'data';
  return 'data' + v.replace('.', '');
}

function cleanSourceForFidelity(raw) {
  return String(raw || '')
    .replace(TN_BLOCK_RE, ' ')
    .split('\n')
    .filter((ln) => !NOISE_LINE_RE.test(ln))
    .join('\n')
    .replace(/Goldenagato\s*\|\s*mp4directs\.com/gi, ' ')
    .replace(/Page\s+\d+/gi, ' ')
    .replace(/^\s*(?:Prologue|Epilogue|Chapter\s+\d+)\s*[:–—-][^\n"“]*/im, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableSourcePage(pageObj) {
  const raw = String((pageObj && pageObj.text) || '');
  const rawWords = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const alpha = rawWords.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
  if (rawWords.length < 6 || alpha / rawWords.length < 0.4) return false;
  if (pageObj.page <= 3) {
    const serverCleanLen = raw
      .replace(/Page\s+\d+/gi, '')
      .replace(/Goldenagato.*$/gim, '')
      .replace(/\s+/g, ' ')
      .trim().length;
    if (serverCleanLen < 220) return false;
  }
  const paras = sourceParagraphs(raw);
  if (!paras.length) return false;
  const cleanWords = (cleanSourceForFidelity(raw).match(/[\p{L}\p{N}]+/gu) || []).length;
  return cleanWords >= 6;
}

const words = (t) => (String(t || '').match(/[\p{L}\p{N}]+/gu) || []).length;
const sents = (t) => (String(t || '').match(/[.!?…]/g) || []).length;
const nums = (t) => (String(t || '').match(/\d+/g) || []).sort().join(',');
const quotes = (t) => (String(t || '').match(/[“”"]/g) || []).length / 2;

function evaluateFidelity(src, tr, options = {}) {
  const minRatio = options.minRatio !== undefined ? options.minRatio : 0.55;
  const maxRatio = options.maxRatio !== undefined ? options.maxRatio : 1.35;
  const minWordsForRatio = options.minWordsForRatio !== undefined ? options.minWordsForRatio : 25;

  const opens = (t) => (String(t || '').match(/\(/g) || []).length;
  const closes = (t) => (String(t || '').match(/\)/g) || []).length;

  const rows = [];
  const lowRatioPages = [];
  const highRatioPages = [];
  const droppedParaPages = [];
  const emptyUsablePages = [];

  for (let idx = 0; idx < src.length; idx++) {
    const p = src[idx];
    if (!isUsableSourcePage(p)) continue;

    const pgKey = String(p.page);
    const trArr = Array.isArray(tr[pgKey]) ? tr[pgKey].filter((x) => String(x || '').trim().length > 0) : [];
    const enClean = cleanSourceForFidelity(p.text);
    let enParas = sourceParagraphs(p.text);

    // Strip standalone chapter heading paragraph removed by fix_headings.js
    if (enParas.length > 0 && /^(?:Prologue|Epilogue|Chapter\s+\d+)\s*[:–—-]/i.test(enParas[0])) {
      const rest = enParas[0].replace(/^(?:Prologue|Epilogue|Chapter\s+\d+)\s*[:–—-]\s*/i, '');
      if (!/["“]/.test(rest) && rest.split(/\s+/).length <= 10) {
        enParas = enParas.slice(1);
      }
    }

    // Account for intra-page parenthetical merges (fix_boundaries.js)
    const mergedEnParas = [...enParas];
    for (let i = 0; i < mergedEnParas.length - 1; i++) {
      if (
        opens(mergedEnParas[i]) > closes(mergedEnParas[i]) &&
        closes(mergedEnParas[i + 1]) > opens(mergedEnParas[i + 1])
      ) {
        mergedEnParas[i] = mergedEnParas[i] + ' ' + mergedEnParas[i + 1];
        mergedEnParas.splice(i + 1, 1);
        i--;
      }
    }

    // Account for cross-page continuation merged into previous page's final paragraph
    let allowPrevContinuation = false;
    if (idx > 0 && mergedEnParas.length > 0 && isUsableSourcePage(src[idx - 1])) {
      const prevParas = sourceParagraphs(src[idx - 1].text);
      const prevLast = prevParas[prevParas.length - 1] || '';
      const prevTrArr = Array.isArray(tr[String(src[idx - 1].page)])
        ? tr[String(src[idx - 1].page)].filter((x) => String(x || '').trim().length > 0)
        : [];
      if (
        prevLast &&
        (!/[.!?"”’)\]]$/.test(prevLast) || opens(prevLast) > closes(prevLast)) &&
        prevTrArr.length + trArr.length >= prevParas.length + mergedEnParas.length - 1
      ) {
        allowPrevContinuation = true;
      }
    }

    const minExpectedParas = Math.max(1, mergedEnParas.length - (allowPrevContinuation ? 1 : 0));

    const t = trArr.join(' ');
    const wEn = words(enClean);
    const wTr = words(t);
    const ratio = wEn ? wTr / wEn : 1;

    const missing = NAMES.filter(
      (n) =>
        (enClean.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length >
        (t.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length
    );
    const extra = NAMES.filter(
      (n) =>
        (t.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length >
        (enClean.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length
    );
    const numOk = nums(enClean) === nums(t);

    const row = {
      page: p.page,
      wEn,
      wTr,
      ratio: Number(ratio.toFixed(3)),
      enParas: mergedEnParas.length,
      minExpectedParas,
      trParas: trArr.length,
      sEn: sents(enClean),
      sTr: sents(t),
      missing,
      extra,
      numOk,
      dq: Math.round(quotes(enClean)),
      dtq: Math.round(quotes(t)),
    };
    rows.push(row);

    if (trArr.length === 0) {
      emptyUsablePages.push(row);
    } else {
      if (wEn >= minWordsForRatio && ratio < minRatio) {
        lowRatioPages.push(row);
      }
      if (wEn >= minWordsForRatio && ratio > maxRatio) {
        highRatioPages.push(row);
      }
      if (trArr.length < minExpectedParas) {
        droppedParaPages.push(row);
      }
    }
  }

  const avg = rows.length ? rows.reduce((a, r) => a + r.ratio, 0) / rows.length : 0;
  return {
    rows,
    avg: Number(avg.toFixed(3)),
    usablePages: rows.length,
    emptyUsablePages,
    lowRatioPages: lowRatioPages.sort((a, b) => a.ratio - b.ratio),
    highRatioPages: highRatioPages.sort((a, b) => b.ratio - a.ratio),
    droppedParaPages,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const volIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vol = volIdx > -1 && args[volIdx + 1] ? args[volIdx + 1] : args.find((a) => !a.startsWith('--')) || '4';
  const dir = resolveVolumeDir(vol);
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'source.json'), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'paragraphs_final.json'), 'utf8'));

  const res = evaluateFidelity(src, tr);
  const { rows, avg } = res;
  const low = rows.filter((r) => r.ratio < 0.72).sort((a, b) => a.ratio - b.ratio);
  const high = rows.filter((r) => r.ratio > 1.18).sort((a, b) => b.ratio - a.ratio);
  const numBad = rows.filter((r) => !r.numOk);
  const nameBad = rows.filter((r) => r.missing.length || r.extra.length);

  const out = [];
  out.push(`SADAKAT RAPORU — Cilt ${vol}`);
  out.push(
    `sayfa: ${rows.length} | kelime EN ${rows.reduce((a, r) => a + r.wEn, 0)} / TR ${rows.reduce((a, r) => a + r.wTr, 0)} | ortalama TR/EN kelime oranı: ${(avg * 100).toFixed(1)}%`
  );
  out.push(`cümle EN ${rows.reduce((a, r) => a + r.sEn, 0)} / TR ${rows.reduce((a, r) => a + r.sTr, 0)}`);
  out.push(`\n[1] Kısa kalan sayfalar (<%72): ${low.length}`);
  low.slice(0, 12).forEach((r) => out.push(`  s${String(r.page).padStart(3)}  ${(r.ratio * 100).toFixed(0)}%  EN ${r.wEn} → TR ${r.wTr}`));
  out.push(`\n[2] Şişkin sayfalar (>%118): ${high.length}`);
  high.slice(0, 8).forEach((r) => out.push(`  s${String(r.page).padStart(3)}  ${(r.ratio * 100).toFixed(0)}%  EN ${r.wEn} → TR ${r.wTr}`));
  out.push(`\n[3] Sayı uyuşmayan sayfalar: ${numBad.length}`);
  numBad.slice(0, 12).forEach((r) => out.push(`  s${r.page}`));
  out.push(`\n[4] İsim sayısı uyuşmayan sayfalar: ${nameBad.length}`);
  nameBad
    .slice(0, 15)
    .forEach((r) => out.push(`  s${r.page}  eksik: ${r.missing.join(',') || '-'}  fazla: ${r.extra.join(',') || '-'}`));
  out.push(`\n[5] Tırnak (diyalog) dengesi: EN ${rows.reduce((a, r) => a + r.dq, 0)} / TR ${rows.reduce((a, r) => a + r.dtq, 0)}`);

  fs.writeFileSync(path.join(ROOT, dir, 'fidelity_report.txt'), out.join('\n'));
  console.log(out.slice(0, 14).join('\n'));
}

module.exports = {
  NAMES,
  resolveVolumeDir,
  cleanSourceForFidelity,
  isUsableSourcePage,
  evaluateFidelity,
};
