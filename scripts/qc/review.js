// Bölüm bazlı Türkçe kalite taraması: kelime seçimi, gramer, akıcılık, edebîlik göstergeleri.
// node scripts/qc/review.js --vol 4 [--chapter 3] [--top 5]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOKS = {
  '4': 'data/paragraphs_final.json',
  '4.5': 'data45/paragraphs_final.json',
  '5': 'data5/paragraphs_final.json',
  '6': 'data6/paragraphs_final.json',
  '7': 'data7/paragraphs_final.json',
  '8': 'data8/paragraphs_final.json',
  '9': 'data9/paragraphs_final.json',
  '9.5': 'data95/paragraphs_final.json',
  '10': 'data10/paragraphs_final.json',
  '11': 'data11/paragraphs_final.json',
  '12': 'data12/paragraphs_final.json',
};
const CHAPTERS = (v) => `public/books/v${v}.json`;

const args = process.argv.slice(2);
const vol = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : '4';
const onlyCh = args.includes('--chapter') ? Number(args[args.indexOf('--chapter') + 1]) : null;

const book = JSON.parse(fs.readFileSync(path.join(ROOT, BOOKS[vol]), 'utf8'));
let chapters = null;
const chFile = path.join(ROOT, CHAPTERS(vol));
if (fs.existsSync(chFile)) {
  const meta = JSON.parse(fs.readFileSync(chFile, 'utf8'));
  chapters = meta.chapters || null;
}

// Metni kalınlaştırılmış işaretlerden arındır
function plain(t) {
  return String(t).replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
}

const CHECKS = [
  { name: 'senin/benim/onun (gereksiz iyelik)', re: /\b(senin|benim|onun)\b/gu, w: 1 },
  { name: 'cümle başı "Ve"', re: /(?:^|[.!?…]\s+)Ve\s/gu, w: 3 },
  { name: 'cümle başı "Ama/Fakat"', re: /(?:^|[.!?…]\s+)(Ama|Fakat)\s/gu, w: 2 },
  { name: '"bir şey"', re: /\bbir şey\b/gu, w: 1 },
  { name: '"bir şekilde"', re: /\bbir şekilde\b/gu, w: 3 },
  { name: '"gerçekten"', re: /\bgerçekten\b/gu, w: 2 },
  { name: '"sadece"', re: /\bsadece\b/gu, w: 2 },
  { name: '"çok" (yoğun)', re: /\bçok\b/gu, w: 1 },
  { name: '"şey"', re: /\bşey(ler)?\b/gu, w: 1 },
  { name: '"-mek/-mak için" yığılması', re: /\b\w+(mek|mak) için\b/gu, w: 1 },
  { name: '"-diği için"', re: /\b(diği|dığı|duğu|düğü) için\b/gu, w: 1 },
  { name: '"olduğunu" zinciri', re: /\bolduğunu\b/gu, w: 1 },
  { name: 'fiil isimleştirme "-mesi/-ması"', re: /\b\w+(mesi|ması)\b/gu, w: 1 },
  {
    name: 'İngilizce kalıntı',
    re: /(?<![A-Za-zÇĞİÖŞÜçğıöşü])(the|and|with|that|you|from|about|because)(?![A-Za-zÇĞİÖŞÜçğıöşü])/gu,
    w: 10,
  },
  { name: 'çift boşluk', re: /[^\s] {2,}[^\s]/gu, w: 5 },
  { name: 'noktalama öncesi boşluk', re: /\s+[,.!?;:]/gu, w: 5 },
  {
    name: 'ardışık aynı kelime',
    re: /(?<![A-Za-zÇĞİÖŞÜçğıöşü])(?!hadi hadi|uzun uzun|sessiz sessiz|evet evet|vay vay|peki peki|tek tek|tir tir|yavaş yavaş|azar azar)([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+\1(?![A-Za-zÇĞİÖŞÜçğıöşü])/giu,
    w: 5,
  },
  { name: 'üç nokta "..."', re: /\.\.\./gu, w: 2 },
  { name: '-- tire', re: /--/gu, w: 3 },
  { name: 'tırnak dengesiz satır', re: null, w: 5 },
  { name: 'uzun cümle (>45 kelime)', re: null, w: 2 },
];

function sentences(text) {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const pages = Object.keys(book)
  .map(Number)
  .sort((a, b) => a - b);

const perChapter = new Map();
const samples = new Map();

for (const p of pages) {
  const entry = book[p];
  const paras = Array.isArray(entry) ? entry : entry.p || entry.paragraphs;
  if (!Array.isArray(paras)) continue;
  let ch = 0;
  if (chapters) {
    chapters.forEach((c, i) => {
      if (p >= (c.page ?? 0)) ch = i;
    });
  }
  if (onlyCh !== null && ch !== onlyCh) continue;
  if (!perChapter.has(ch)) perChapter.set(ch, { words: 0, sents: 0, counts: {}, longS: 0 });
  const st = perChapter.get(ch);
  for (const raw of paras) {
    const t = String(raw);
    const isNote = t.startsWith('ÇN:');
    if (isNote) continue;
    const tx = plain(t);
    if (!tx) continue;
    st.words += tx.split(/\s+/).filter(Boolean).length;
    const ss = sentences(tx);
    st.sents += ss.length;
    for (const c of CHECKS) {
      let n = 0;
      if (c.re) {
        c.re.lastIndex = 0;
        const m = tx.match(c.re);
        n = m ? m.length : 0;
      } else if (c.name.startsWith('tırnak')) {
        const open = (tx.match(/“/g) || []).length;
        const close = (tx.match(/”/g) || []).length;
        n = open === close ? 0 : 1;
      } else if (c.name.startsWith('uzun cümle')) {
        n = ss.filter((s) => s.split(/\s+/).length > 45).length;
        st.longS += n;
      }
      if (!n) continue;
      st.counts[c.name] = (st.counts[c.name] || 0) + n;
      if (c.w >= 5) {
        const key = c.name;
        if (!samples.has(key)) samples.set(key, []);
        const arr = samples.get(key);
        if (arr.length < 12) arr.push(`s.${p}: ${tx.slice(0, 140)}`);
      }
    }
  }
}

const rows = [...perChapter.entries()].sort((a, b) => a[0] - b[0]);
console.log(`\n== Cilt ${vol} bölüm taraması ==`);
for (const [ch, st] of rows) {
  const c = chapters && chapters[ch];
  const name = c ? `${c.label}: ${c.title}` : `Bölüm ${ch}`;
  const per1000 = (k) => ((st.counts[k] || 0) / Math.max(1, st.words)) * 1000;
  const hot = Object.keys(st.counts)
    .sort((a, b) => per1000(b) - per1000(a))
    .slice(0, 6)
    .map((k) => `${k}:${st.counts[k]}`);
  console.log(
    `[${ch}] ${String(name).slice(0, 34).padEnd(34)} kelime:${String(st.words).padStart(6)} ort.cümle:${(st.words / Math.max(1, st.sents)).toFixed(1)}  ${hot.join('  ')}`
  );
}

const showSamples = args.includes('--samples');
if (showSamples) {
  for (const [k, arr] of samples) {
    console.log(`\n--- ${k} ---`);
    arr.forEach((a) => console.log('  ' + a));
  }
}
