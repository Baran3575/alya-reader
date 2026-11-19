// İngilizce (kaynak) metin kalitesi: OCR kaynaklı bozulmaları ölçer.
// Kullanım: node scripts/qc/en_quality.js [--vol 4] [--json] [--fix]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { VOLUME_KEYS, VOLUMES } = require('../lib/volumes');

const args = process.argv.slice(2);
const volArg = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const asJson = args.includes('--json');
const doFix = args.includes('--fix');

const DECOR = /^[\s{}[\]|<>~_*+=.,;:'"`-]+$/;
const BOX = /[\u2500-\u257F\u2580-\u259F]/;
const CJK = /[\u3040-\u9FFF\uFF01-\uFF60]/;
const CYR = /\p{Script=Cyrillic}/u;
const BAD_TOKENS = /\b(l'm|lt's|1'm|1t's|s0|th1s|vv|liy|tbe|witb|aud|frorn)\b/i;

function letterRatio(t) {
  const letters = (t.match(/\p{L}/gu) || []).length;
  return t.length ? letters / t.length : 0;
}

function analyse(text) {
  const issues = [];
  if (!text) return issues;
  if (letterRatio(text) < 0.55 && text.length > 25) issues.push('simge yığını');
  if (text.split(/\n/).some((l) => l.trim().length > 2 && DECOR.test(l))) issues.push('dekoratif ayraç satırı');
  if (BOX.test(text)) issues.push('kutu/geometri karakteri');
  if (CJK.test(text)) issues.push('CJK karakteri');
  if (CYR.test(text)) issues.push('Kiril karakteri');
  if (BAD_TOKENS.test(text)) issues.push('OCR token bozulması');
  if (/[a-z]\.[A-Z]/.test(text)) issues.push('nokta sonrası boşluk yok');
  if (/\.{4,}/.test(text)) issues.push('dört+ nokta');
  if (/\s{2,}\S/.test(text) && !/\n/.test(text)) issues.push('çift boşluk');
  return issues;
}

// OCR çöp paragrafı mı? (tamamen simge/rastgele harf yığını)
function isJunk(text) {
  const t = text.trim();
  if (t.length < 18) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters / t.length < 0.4) return true;
  const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const tiny = words.filter((w) => w.replace(/[^\p{L}]/gu, '').length <= 2).length;
  return words.length >= 10 && tiny / words.length > 0.6;
}

const rows = [];
const fixes = [];

for (const k of VOLUME_KEYS) {
  if (volArg && k !== volArg) continue;
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile)) continue;
  const pages = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
  let flagged = 0;
  let junk = 0;
  const samples = [];

  for (const page of pages) {
    const text = typeof page === 'string' ? page : page.text || '';
    const issues = analyse(text);
    if (issues.length) {
      flagged++;
      if (samples.length < 3) samples.push({ page: page.page, issues, preview: text.slice(0, 110) });
    }
    if (isJunk(text)) {
      junk++;
      fixes.push({ vol: k, page: page.page, kind: 'OCR çöpü', preview: text.slice(0, 70) });
    }
  }

  rows.push({ vol: k, pages: pages.length, flagged, junk, samples });
}

if (asJson) {
  console.log(JSON.stringify({ rows, fixes }, null, 2));
} else {
  console.log('Cilt  sayfa  sorunlu  çöp');
  for (const r of rows) {
    console.log(
      String(r.vol).padEnd(6),
      String(r.pages).padStart(5),
      String(r.flagged).padStart(8),
      String(r.junk).padStart(4),
    );
    for (const s of r.samples) console.log(`    s.${s.page} [${s.issues.join(', ')}] ${s.preview}`);
  }
  const totalJunk = rows.reduce((a, r) => a + r.junk, 0);
  const totalFlagged = rows.reduce((a, r) => a + r.flagged, 0);
  console.log(`\ntoplam: ${totalFlagged} sorunlu sayfa, ${totalJunk} OCR çöp sayfası`);
}

if (doFix) {
  // Yalnızca tamamen çöp sayfaların metnini boşalt (görsel sayfası gibi davranır)
  let applied = 0;
  for (const k of new Set(fixes.map((f) => f.vol))) {
    const cfg = VOLUMES[k];
    const pages = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
    for (const page of pages) {
      if (isJunk(page.text || '')) {
        page.text = '';
        applied++;
      }
    }
    fs.writeFileSync(cfg.sourceFile, JSON.stringify(pages, null, 1) + '\n');
  }
  console.log(`\n${applied} OCR çöp sayfası boşaltıldı (görsel sayfası olarak işaretlendi)`);
}
