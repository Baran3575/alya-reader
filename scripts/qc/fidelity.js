// Metne sadakat ölçümü: EN kaynak <-> TR çeviri, sayfa sayfa.
// Ölçütler: diyalog satırı sayısı, Rusça {…} blokları, özel adlar, sayılar,
// uzunluk oranı ve paragraf oranı (yapısal sadakat göstergeleri).
// node scripts/qc/fidelity.js [--vol 4] [--top 8] [--md]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PAIRS = {
  '4': ['data/source.json', 'data/paragraphs_final.json'],
  '4.5': ['data45/source.json', 'data45/paragraphs_final.json'],
  '5': ['data5/source.json', 'data5/paragraphs_final.json'],
  '6': ['data6/source.json', 'data6/paragraphs_final.json'],
  '7': ['data7/source.json', 'data7/paragraphs_final.json'],
  '8': ['data8/source.json', 'data8/paragraphs_final.json'],
  '9': ['data9/source.json', 'data9/paragraphs_final.json'],
  '9.5': ['data95/source.json', 'data95/paragraphs_final.json'],
  '10': ['data10/source.json', 'data10/paragraphs_final.json'],
  '11': ['data11/source.json', 'data11/paragraphs_final.json'],
  '12': ['data12/source.json', 'data12/paragraphs_final.json'],
};

const NAMES = [
  'Alya', 'Alisa', 'Masachika', 'Yuki', 'Ayano', 'Maria', 'Sayaka', 'Nonoa',
  'Chisaki', 'Touya', 'Masha', 'Takeshi', 'Kenzaki', 'Suou', 'Kuze', 'Yumi',
  'Kinjou', 'Sarashina', 'Miyamae', 'Kimishima', 'Elena', 'Hikaru', 'Rir',
  'Kyotarou', 'Roshidere',
];
// TR metinde geçebilecek karşılıklar
const VARIANTS = {
  Chisaki: ['Chisaki', 'Çisaki'],
  Masha: ['Masha', 'Maşa'],
  Touya: ['Touya', 'Toya'],
  Kyotarou: ['Kyotarou', 'Kyotaro'],
  Roshidere: ['Roshidere'],
};

const args = process.argv.slice(2);
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 6;
const md = args.includes('--md');

function unwrapEN(t) {
  return String(t || '')
    .replace(/Page\s+\d+\s*Goldenagato[^\n]*/giu, ' ')
    .replace(/Goldenagato\s*\|\s*mp4directs\.\s*com/giu, ' ')
    .replace(/-\n/g, '')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// OCR çöp satırlarını (sembol yığını, yarım kelimeler) ayıklar.
function cleanLines(t) {
  return String(t)
    .split(/\n+/)
    .filter((line) => {
      const toks = line.split(/\s+/).filter(Boolean);
      if (toks.length < 4) return false;
      const letters = (line.match(/[\p{L}]/gu) || []).length;
      const symbols = (line.match(/[^\p{L}\p{N}\s.,!?;:'"’”‘“(){}\[\]\/~—-]/gu) || []).length;
      if (letters / line.length < 0.55) return false;
      if (symbols / line.length > 0.15) return false;
      const short = toks.filter((w) => w.length <= 2).length / toks.length;
      return short < 0.4;
    })
    .join('\n');
}

function trText(page) {
  const e = page;
  const arr = Array.isArray(e) ? e : (e && (e.p || e.paragraphs)) || [];
  return arr.filter((t) => !String(t).startsWith('ÇN:')).map(String).join('\n');
}

function words(t) {
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// En dış (depth 1) tırnak yayılımlarını sayar; iç içe alıntılar tek sayılır.
function spanCount(text, open = '“', close = '”') {
  let depth = 0;
  let count = 0;
  for (const ch of String(text)) {
    if (ch === open) {
      if (open === close) {
        // aynı karakter: çift/tek olarak ilerle
        depth = depth ? 0 : 1;
        if (depth === 1) count++;
        continue;
      }
      if (depth === 0) count++;
      depth++;
    } else if (ch === close && depth > 0) {
      depth--;
    }
  }
  return count;
}

function scorePage(enRaw, trRaw) {
  // Çevirmen notları (kapansın ya da kapanmasın) sadakat hesabına girmez.
  const en = unwrapEN(enRaw)
    .replace(/\(TN:[\s\S]*?\)/giu, ' ')
    .replace(/\(TN:[\s\S]*$/giu, ' ');
  const tr = trRaw.replace(/\{[^}]*\}/gu, (m) => m);
  const notes = [];

  // Diyalog sayısı: açılan tırnak sayısı. OCR bozuk kapanışlar ve iç içe
  // geçen başlıklar yüzünden ±2 tolerans uygulanır.
  // OCR'da tekrarlanan tırnak dizileri (“““““) tek tırnak sayılır.
  const enQ = en.replace(/[\u201c\u201d"\u2018\u2019]{2,}/gu, (m) => m[0]);
  const trQ = tr.replace(/[\u201c\u201d]{2,}/gu, (m) => m[0]);
  const singles = (t) => (t.match(/\u2018/gu) || []).length;
  const enDlg = Math.max(
    (enQ.match(/\u201c/gu) || []).length + singles(enQ),
    Math.round((enQ.match(/"/gu) || []).length / 2) + singles(enQ),
    (enQ.match(/『/gu) || []).length,
    (enQ.match(/「/gu) || []).length
  );
  // TR'de iç içe alıntılar tek tırnakla verildiği için onlar da sayılır.
  const trDlg =
    (trQ.match(/\u201c/gu) || []).length + (trQ.match(/\u2018/gu) || []).length;
  const dlgDelta = Math.max(0, Math.abs(enDlg - trDlg) - 2);

  const enRu = Math.max(
    (en.match(/\{[^}]{1,200}\}/gu) || []).length,
    (en.match(/【[^】]{1,200}】/gu) || []).length,
    (en.match(/\{/gu) || []).length,
    // Kaynakta süslü parantez yoksa Kiril alfabesindeki uzun bloklar sayılır.
    (en.match(/[\u0400-\u04FF][\u0400-\u04FF\s,.!?\u2026-]{7,}/gu) || []).length
  );
  const trRu = (tr.match(/\{[^}]{1,200}\}/gu) || []).length;
  // Fazla Rusça blok kusur değil (ev stili); yalnızca eksik olan cezalanır.
  const ruDelta = Math.max(0, enRu - trRu);

  const enNames = NAMES.filter((n) => new RegExp(`\\b${n}`, 'u').test(en));
  const missingNames = enNames.filter((n) => {
    const forms = VARIANTS[n] || [n];
    return !forms.some((f) => new RegExp(f, 'u').test(tr));
  });

  const enClean = cleanLines(en) || en;
  // "Chapter 8" / "Page 74" gibi başlık sayıları metin içeriği sayılmaz.
  const enBody = en.replace(/\b(?:Chapter|Page|Volume|Bölüm|Sayfa)\s+\d{1,4}/giu, ' ');
  const enNums = [...new Set((enBody.match(/\b\d{1,4}\b/g) || []))].filter((n) =>
    enClean.includes(n)
  );
  const missingNums = enNums.filter((n) => !tr.includes(n));

  const ew = words(enClean);
  const tw = words(tr);
  // OCR çöpü: kaynak sayfa taranmış görsel artıkları içeriyorsa uzunluk oranı güvenilmez.
  const tokens = enClean.split(/\s+/).filter(Boolean);
  const junk = tokens.filter((t) => t.length <= 2 && !/[\p{L}\p{N}]{2}/u.test(t)).length;
  const junkPage = tokens.length > 20 && junk / tokens.length > 0.2;
  let ratio = ew ? tw / ew : 1;

  const enParas = unwrapEN(enRaw).split(/\n{2,}/).filter(Boolean).length;
  const trParas = tr.split('\n').filter((s) => s.trim()).length;
  const paraRatio = enParas ? trParas / enParas : 1;

  let s = 100;
  s -= Math.min(40, dlgDelta * 8);
  s -= Math.min(30, ruDelta * 10);
  s -= Math.min(30, missingNames.length * 6);
  s -= Math.min(12, missingNums.length * 4);
  if (!junkPage) {
    if (ratio < 0.4 || ratio > 1.9) s -= 30;
    else if (ratio < 0.55 || ratio > 1.5) s -= 15;
    else if (ratio < 0.65 || ratio > 1.35) s -= 6;
  }
  if (paraRatio < 0.25 || paraRatio > 4) s -= 10;

  if (junkPage) {
    notes.push('ocr-boş');
    ratio = null;
  }
  if (dlgDelta) notes.push(`diyalog -${dlgDelta}`);
  if (ruDelta) notes.push(`rusça -${ruDelta}`);
  if (missingNames.length) notes.push(`ad yok: ${missingNames.join('/')}`);
  if (missingNums.length) notes.push(`sayı yok: ${missingNums.join('/')}`);
  if (ratio !== null && ratio < 0.65) notes.push(`kısa x${ratio.toFixed(2)}`);
  if (ratio !== null && ratio > 1.35) notes.push(`uzun x${ratio.toFixed(2)}`);

  return { score: Math.max(0, Math.round(s)), notes, ratio, enDlg, trDlg, ew, tw };
}

function analyze(vol) {
  const [srcRel, trRel] = PAIRS[vol];
  const srcPath = path.join(ROOT, srcRel);
  const trPath = path.join(ROOT, trRel);
  if (!fs.existsSync(srcPath) || !fs.existsSync(trPath)) return null;
  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));
  const srcArr = Array.isArray(src) ? src : Object.values(src);
  const rows = [];
  for (let i = 0; i < srcArr.length; i++) {
    const enRaw = srcArr[i] && srcArr[i].text;
    if (!enRaw || unwrapEN(enRaw).length < 20) continue;
    const pageKey = String(i + 1);
    const trPage = tr[pageKey];
    if (!trPage) {
      rows.push({ page: i + 1, score: 0, notes: ['TR sayfa yok'], ratio: 0 });
      continue;
    }
    rows.push({ page: i + 1, ...scorePage(enRaw, trText(trPage)) });
  }
  const avg = rows.reduce((a, b) => a + b.score, 0) / Math.max(1, rows.length);
  return { vol, rows, avg, low: rows.filter((r) => r.score < 70).length };
}

module.exports = { analyze, scorePage, unwrapEN, trText, words, PAIRS };

if (require.main === module) {
  const lines = [];
  const summary = [];
  const detail = [];
  for (const vol of Object.keys(PAIRS)) {
    if (only && vol !== only) continue;
    const res = analyze(vol);
    if (!res) continue;
    summary.push({ vol, pages: res.rows.length, avg: res.avg, low: res.low });
    detail.push(res);
    lines.push(
      `\n== Cilt ${vol} ==  ${res.rows.length} sayfa · ort. sadakat ${res.avg.toFixed(1)} · <70: ${res.low} sayfa`
    );
    res.rows
      .slice()
      .sort((a, b) => a.score - b.score)
      .slice(0, topN)
      .forEach((r) =>
        lines.push(
          `   s.${String(r.page).padEnd(4)} ${String(r.score).padStart(3)}  ${(r.notes || []).join(' ')}`
        )
      );
  }

  if (md) {
    const out = [
      '# Metne Sadakat Raporu',
      '',
      'Yapısal sadakat göstergeleri: diyalog satırı sayısı, Rusça {…} blokları, özel adlar,',
      'sayılar, uzunluk oranı, paragraf oranı. 100 = yapı birebir, <70 = inceleme gerekli.',
      '',
      '| Cilt | Sayfa | Ort. sadakat | <70 sayfa |',
      '| --- | ---: | ---: | ---: |',
      ...summary.map((s) => `| ${s.vol} | ${s.pages} | ${s.avg.toFixed(1)} | ${s.low} |`),
      '',
      '## Cilt bazında en zayıf sayfalar',
      '',
    ];
    for (const res of detail) {
      out.push(`### Cilt ${res.vol}`, '', '| Sayfa | Puan | Bulgu |', '| ---: | ---: | --- |');
      res.rows
        .slice()
        .sort((a, b) => a.score - b.score)
        .slice(0, 5)
        .forEach((r) => out.push(`| ${r.page} | ${r.score} | ${(r.notes || []).join(' ') || '—'} |`));
      out.push('');
    }
    fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs/fidelity.md'), out.join('\n'));
    console.log('yazıldı: docs/fidelity.md');
  }
  console.log(lines.join('\n'));
  console.log('\n== Özet ==');
  summary.forEach((s) => console.log(`Cilt ${s.vol}: ort ${s.avg.toFixed(1)} · <70: ${s.low}/${s.pages}`));
}
