// Uzun/birleşik paragrafları ışık romanı düzenine göre böler.
// Kurallar (muhafazakâr):
//   1) Cümle bitiminden sonra açılan tırnak -> yeni paragraf
//   2) Kapanış tırnağından sonra BÜYÜK harfle başlayan yeni cümle -> yeni paragraf
//   3) 3+ cümleli anlatım paragrafları en fazla 2 cümlelik parçalara bölünür
// node scripts/fix_para_split.js [--dry] [--vol 4]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOLS = {
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

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const verbose = args.includes('--show');
const noSentence = args.includes('--no-sentence');

const QUOTE_OPEN = '“';
const QUOTE_CLOSE = '”';

function splitSentences(t) {
  return t
    .split(/(?<=[.!?…])\s+(?=[“A-ZÇĞİÖŞÜ0-9(¿¡])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function balance(t) {
  return (t.match(/“/g) || []).length === (t.match(/”/g) || []).length;
}

function splitParagraph(t) {
  if (!t || t.startsWith('ÇN:')) return [t];
  if (!balance(t)) return [t];
  const out = [];

  // 1/2: tırnak sınırlarında böl
  let buf = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    buf += ch;
    if (ch === QUOTE_OPEN && buf.length > 1) {
      const before = buf.slice(0, -1).trimEnd();
      if (/[.!?…]$/u.test(before)) {
        out.push(before);
        buf = QUOTE_OPEN;
      }
    } else if (ch === QUOTE_CLOSE) {
      const rest = t.slice(i + 1);
      const nextNonSpace = rest.replace(/^\s+/, '');
      if (/^[A-ZÇĞİÖŞÜ]/u.test(nextNonSpace)) {
        out.push(buf.trim());
        buf = '';
        while (t[i + 1] === ' ') i++;
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());

  // 3: aşırı uzun anlatım paragraflarını 2'şer cümleye indir
  if (noSentence) return out;
  const res = [];
  for (const p of out) {
    if (p.includes(QUOTE_OPEN)) {
      res.push(p);
      continue;
    }
    const sents = splitSentences(p);
    if (sents.length <= 2) {
      res.push(p);
      continue;
    }
    for (let i = 0; i < sents.length; i += 2) {
      res.push(sents.slice(i, i + 2).join(' '));
    }
  }
  return res.length ? res : [t];
}

let total = 0;
for (const [vol, rel] of Object.entries(VOLS)) {
  if (only && vol !== only) continue;
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const page of Object.keys(book)) {
    const entry = book[page];
    const paras = Array.isArray(entry) ? entry : entry.p || entry.paragraphs;
    if (!Array.isArray(paras)) continue;
    const out = [];
    for (const t of paras) {
      const parts = splitParagraph(String(t));
      if (parts.length > 1) {
        n++;
        if (verbose) {
          console.log(`  s.${page}:`);
          parts.forEach((x) => console.log('    • ' + x.slice(0, 90)));
        }
      }
      out.push(...parts);
    }
    if (Array.isArray(entry)) book[page] = out;
    else if (entry.p) entry.p = out;
    else entry.paragraphs = out;
  }
  if (n && !dry) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  total += n;
  console.log(`Cilt ${vol}: ${n} paragraf bölündü${dry ? ' (deneme)' : ''}`);
}
console.log('toplam:', total);
