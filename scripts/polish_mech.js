// Mekanik metin temizliği (anlam değiştirmez).
// node scripts/polish_mech.js [--dry]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'data/paragraphs_final.json',
  'data45/paragraphs_final.json',
  'data5/paragraphs_final.json',
  'data6/paragraphs_final.json',
  'data7/paragraphs_final.json',
  'data8/paragraphs_final.json',
  'data9/paragraphs_final.json',
  'data95/paragraphs_final.json',
  'data10/paragraphs_final.json',
  'data11/paragraphs_final.json',
  'data12/paragraphs_final.json',
];

const dry = process.argv.includes('--dry');
const RULES = [
  // kapanış tırnağından sonra bitişik küçük harf: “...,”diye -> “...,” diye
  [/([,.!?…])”(?=[A-Za-zÇĞİÖŞÜçğıöşü])/gu, '$1” '],
  // bozuk çoklu tırnaklar
  [/^“{2,}\s*/u, '“'],
  [/”{2,}$/u, '”'],
  // çift boşluk
  [/[ \t]{2,}/gu, ' '],
  // üç nokta yerine …
  [/\.\.\./gu, '…'],
];

let total = 0;
for (const rel of TARGETS) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const key of Object.keys(book)) {
    const entry = book[key];
    const arr = Array.isArray(entry) ? entry : entry.p || entry.paragraphs;
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      let t = String(arr[i]);
      const before = t;
      for (const [re, rep] of RULES) t = t.replace(re, rep);
      t = t.trim();
      if (t !== before) {
        arr[i] = t;
        n++;
      }
    }
  }
  if (n && !dry) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  total += n;
  console.log(`${rel}: ${n} paragraf düzeltildi${dry ? ' (dry)' : ''}`);
}
console.log('toplam:', total);
