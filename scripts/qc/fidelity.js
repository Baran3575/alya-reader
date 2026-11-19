// EN kaynağı ile TR çevirisi arasında deterministik sayfa ve pencere bazlı sadakat ölçümü
const fs = require('fs');
const path = require('path');

const NAMES = [
  'Masachika', 'Kuze', 'Alisa', 'Alya', 'Maria', 'Masha', 'Yuki', 'Ayano',
  'Sayaka', 'Touya', 'Chisaki', 'Nonoa', 'Kinjou', 'Mimiko', 'Sarashina', 'Kenzaki', 'Suou',
];

const SKIP_CREDIT_RE =
  /(discord\.gg|glucosetl|novelupdates|lightnovelreader|TLed and Edited\s*by|fan translators? and editors?|Volume\s+\d+(?:\.\d+)?,?\s+Fan\s+Translation|Do not reupload our chapters behind ad-link shorteners|Join our Discord|Download all your Favorite Light Novels|Stay up to date On Light Novels)/i;

const TERMINAL_SENT_RE = /[.!?:”"'\u2019…~)\]»*}◇⋆♪]$/;
const EN_SOURCE_COMPLETE_RE = /[.!?\u2026~♪◇][”"'\u2019)\]]*$/;

function resolveVolumeDir(vol = '4') {
  const v = String(vol || '4').trim();
  return v === '4' ? 'data' : 'data' + v.replace(/\./g, '');
}

const words = (t) => (String(t || '').match(/[\p{L}\p{N}]+/gu) || []).length;
const sents = (t) => (String(t || '').match(/[.!?…]/g) || []).length;
const nums = (t) => (String(t || '').match(/\d+/g) || []).sort().join(',');
const quotes = (t) => (String(t || '').match(/[“”"]/g) || []).length / 2;

function isPendingPage(p) {
  return Boolean(p && p.pending);
}

function isSkippedCreditPage(p) {
  return SKIP_CREDIT_RE.test(String((p && p.text) || ''));
}

function isUsablePage(p) {
  if (isPendingPage(p)) return false;
  const raw = String((p && p.text) || '');
  const ws = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const alpha = ws.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
  return ws.length >= 6 && alpha / ws.length >= 0.4;
}

function isTocPage(p) {
  return /^Table of contents\b/i.test(String((p && p.text) || '').trim());
}

function isOcrNoiseLine(line) {
  const t = String(line || '').trim();
  if (t.length < 20) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (t.length > 30 && letters / t.length < 0.45) return true;
  const ws = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const tiny = ws.filter((w) => w.replace(/[^\p{L}]/gu, '').length <= 2).length;
  return ws.length >= 12 && tiny / ws.length > 0.65;
}

function cleanSourceProse(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !isOcrNoiseLine(line))
    .join('\n')
    .replace(/Page\s+\d+/gi, '')
    .replace(
      /(Goldenagato|mp4directs|jnovels|zerobooks|glucosetl|discord\.gg|novelupdates|lightnovelreader|Download all your Favorite|Stay up to date On Light Novels|Join our Discord).*$/gim,
      ''
    )
    .replace(/\(\s*TN\s*:\s*["“]([^"”]+)["”]\s*\)/gi, '“$1”')
    .replace(/\(\s*TN\s*:[\s\S]*?\)/gi, '')
    .trim();
}

function analyzeFidelity(src, tr) {
  const rows = [];
  for (const p of src) {
    if (isPendingPage(p) || isSkippedCreditPage(p)) continue;
    const en = cleanSourceProse(p.text || '');
    const trParas = Array.isArray(tr[String(p.page)]) ? tr[String(p.page)].filter(Boolean) : [];
    const t = trParas.join(' ');
    if (!en.trim()) continue;
    const wEn = words(en);
    const wTr = words(t);
    const ratio = wEn ? wTr / wEn : 0;
    const missing = NAMES.filter(
      (n) =>
        (en.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length >
        (t.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length
    );
    const extra = NAMES.filter(
      (n) =>
        (t.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length >
        (en.match(new RegExp('(?<!\\p{L})' + n + '(?!\\p{L})', 'gu')) || []).length
    );
    const numOk = nums(en) === nums(t);
    rows.push({
      page: p.page,
      usable: isUsablePage(p),
      toc: isTocPage(p),
      pTr: trParas.length,
      wEn,
      wTr,
      ratio,
      sEn: sents(en),
      sTr: sents(t),
      missing,
      extra,
      numOk,
      dq: Math.round(quotes(en)),
      dtq: Math.round(quotes(t)),
    });
  }
  return rows;
}

function checkCoverageGates({ src, tr, bil = null, bounds = {} }) {
  const minPageRatio = bounds.minPageRatio ?? 0.46;
  const maxPageRatio = bounds.maxPageRatio ?? 1.45;
  const minWindowRatio = bounds.minWindowRatio ?? 0.55;
  const maxWindowRatio = bounds.maxWindowRatio ?? 1.32;
  const checkBoundaries = bounds.checkBoundaries !== undefined ? Boolean(bounds.checkBoundaries) : true;
  const checkSourceCompleteBoundaries = Boolean(bounds.checkSourceCompleteBoundaries);

  const emptyBilingual = [];
  const skippedPages = new Set();

  for (const p of src) {
    if (isPendingPage(p) || isSkippedCreditPage(p)) skippedPages.add(String(p.page));
  }

  if (bil && typeof bil === 'object') {
    for (const [pg, arr] of Object.entries(bil)) {
      if (skippedPages.has(String(pg)) || !Array.isArray(arr)) continue;
      arr.forEach((slot, idx) => {
        const g = String((slot && slot.g) || '').trim();
        const d = String((slot && slot.d) || '').trim();
        if (!g && !d) {
          emptyBilingual.push(`${pg}.${idx}`);
        }
      });
    }
  }

  const emptyUsablePages = [];
  const pageRatioViolations = [];
  const pageParaViolations = [];
  const windowViolations = [];
  const splitBoundaryViolations = [];

  const usableProsePages = [];

  for (const p of src) {
    const key = String(p.page);
    if (skippedPages.has(key)) continue;
    const usable = isUsablePage(p);
    if (!usable) continue;

    const trParas = Array.isArray(tr[key]) ? tr[key].map((s) => String(s || '').trim()).filter(Boolean) : [];
    if (trParas.length === 0) {
      emptyUsablePages.push(`s.${p.page}`);
      continue;
    }

    if (isTocPage(p)) continue;

    const enClean = cleanSourceProse(p.text || '');
    const wEn = words(enClean);
    const wTr = words(trParas.join(' '));
    const ratio = wEn > 0 ? wTr / wEn : 1;
    const enLines = enClean.split('\n').map((s) => s.trim()).filter(Boolean).length;

    if (wEn >= 45 && (ratio < minPageRatio || ratio > maxPageRatio)) {
      pageRatioViolations.push(
        `s.${p.page}: oran ${(ratio * 100).toFixed(1)}% (EN ${wEn}, TR ${wTr}, sınır ${(minPageRatio * 100).toFixed(0)}%–${(maxPageRatio * 100).toFixed(0)}%)`
      );
    }

    if (wEn >= 120 && enLines >= 8 && trParas.length < 2 && ratio < 0.65) {
      pageParaViolations.push(`s.${p.page}: paragraf sayısı çok düşük (${trParas.length}, EN satır ${enLines})`);
    }

    usableProsePages.push({
      page: p.page,
      key,
      wEn,
      wTr,
      enLines,
      enClean,
      trParas,
      rawText: String(p.text || ''),
    });

    if (checkBoundaries || checkSourceCompleteBoundaries) {
      trParas.forEach((para, idx) => {
        if (idx > 0 && /^[“‘"(\[—–\-\s]*[a-zçğıöşü]/u.test(para)) {
          splitBoundaryViolations.push(`s.${p.page}.${idx}: paragraf küçük harfle başlıyor ("${para.slice(0, 50)}…")`);
        }
      });
    }
  }

  for (let i = 0; i < usableProsePages.length - 1; i++) {
    const a = usableProsePages[i];
    const b = usableProsePages[i + 1];
    const winEn = a.wEn + b.wEn;
    const winTr = a.wTr + b.wTr;
    const winRatio = winEn > 0 ? winTr / winEn : 1;
    const winParas = a.trParas.length + b.trParas.length;

    if (winEn >= 90 && (winRatio < minWindowRatio || winRatio > maxWindowRatio)) {
      windowViolations.push(
        `s.${a.page}–${b.page}: pencere oranı ${(winRatio * 100).toFixed(1)}% (EN ${winEn}, TR ${winTr}, sınır ${(minWindowRatio * 100).toFixed(0)}%–${(maxWindowRatio * 100).toFixed(0)}%)`
      );
    }
    if (winEn >= 180 && (winParas < 2 || (winParas < 3 && winRatio < 0.65))) {
      windowViolations.push(`s.${a.page}–${b.page}: pencere paragraf sayısı çok düşük (${winParas})`);
    }

    const enCompleteBoundary = checkSourceCompleteBoundaries && EN_SOURCE_COMPLETE_RE.test(a.enClean);
    if (checkBoundaries || enCompleteBoundary) {
      const lastA = a.trParas[a.trParas.length - 1];
      const firstB = b.trParas[0];
      if (!TERMINAL_SENT_RE.test(lastA)) {
        splitBoundaryViolations.push(`s.${a.page}->${b.page}: sayfa sonu cümle kapanmıyor ("…${lastA.slice(-50)}")`);
      }
      if (/^[“"(\[—–\s]*[a-zçğıöşü]/u.test(firstB)) {
        splitBoundaryViolations.push(`s.${a.page}->${b.page}: sonraki sayfa küçük harfle başlıyor ("${firstB.slice(0, 50)}…")`);
      }
    }
  }

  return {
    emptyBilingual,
    emptyUsablePages,
    pageRatioViolations,
    pageParaViolations,
    windowViolations,
    splitBoundaryViolations,
  };
}

if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  const vol = process.argv[2] || '4';
  const dir = vol === '4' ? 'data' : 'data' + String(vol).replace(/\./g, '');
  const src = JSON.parse(fs.readFileSync(path.join(root, dir, 'source.json'), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(path.join(root, dir, 'paragraphs_final.json'), 'utf8'));

  const rows = analyzeFidelity(src, tr);
  const avg = rows.length ? rows.reduce((a, r) => a + r.ratio, 0) / rows.length : 0;
  const low = rows.filter((r) => r.wEn >= 45 && r.ratio < 0.72).sort((a, b) => a.ratio - b.ratio);
  const high = rows.filter((r) => r.wEn >= 45 && r.ratio > 1.18).sort((a, b) => b.ratio - a.ratio);
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
  nameBad.slice(0, 15).forEach((r) => out.push(`  s${r.page}  eksik: ${r.missing.join(',') || '-'}  fazla: ${r.extra.join(',') || '-'}`));
  out.push(`\n[5] Tırnak (diyalog) dengesi: EN ${rows.reduce((a, r) => a + r.dq, 0)} / TR ${rows.reduce((a, r) => a + r.dtq, 0)}`);

  fs.writeFileSync(path.join(root, dir, 'fidelity_report.txt'), out.join('\n'));
  console.log(out.slice(0, 14).join('\n'));
}

module.exports = {
  NAMES,
  words,
  sents,
  nums,
  quotes,
  resolveVolumeDir,
  isPendingPage,
  isSkippedCreditPage,
  isUsablePage,
  isTocPage,
  cleanSourceProse,
  analyzeFidelity,
  checkCoverageGates,
};
