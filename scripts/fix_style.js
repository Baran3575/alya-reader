// Mekanik dil/noktalama onarımı: yazım birleşikleri, kesme, çift noktalama,
// üç nokta, tırnak bitişikliği, "diye" öncesi virgül, noktalama öncesi boşluk.
// Hem paragraphs_final.json hem data/quality/v*.json üzerinde çalışır (ikisi tutarlı kalsın).
// node scripts/fix_style.js [--dry] [--vol 4]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = {
  '4': ['data/paragraphs_final.json', 'data/quality/v4.json'],
  '4.5': ['data45/paragraphs_final.json', 'data/quality/v4.5.json'],
  '5': ['data5/paragraphs_final.json', 'data/quality/v5.json'],
  '6': ['data6/paragraphs_final.json', 'data/quality/v6.json'],
  '7': ['data7/paragraphs_final.json', 'data/quality/v7.json'],
  '8': ['data8/paragraphs_final.json', 'data/quality/v8.json'],
  '9': ['data9/paragraphs_final.json', 'data/quality/v9.json'],
  '9.5': ['data95/paragraphs_final.json', 'data/quality/v9.5.json'],
  '10': ['data10/paragraphs_final.json', 'data/quality/v10.json'],
  '11': ['data11/paragraphs_final.json', 'data/quality/v11.json'],
  '12': ['data12/paragraphs_final.json', 'data/quality/v12.json'],
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const show = args.includes('--show') ? Number(args[args.indexOf('--show') + 1]) : 0;
let shown = 0;
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;

// [ad, regex, yerine] — sıra önemli
const FIXES = [
  // yazım: birleşik yazılması gerekenler
  [/\bbirşey\b/gu, 'bir şey'],
  [/\bbirşeyler\b/gu, 'bir şeyler'],
  [/\bherşey\b/gu, 'her şey'],
  [/\bhiçbirşey\b/gu, 'hiçbir şey'],
  [/\bbirçok\b/gu, 'birçok'],
  [/\bbir çok\b/gu, 'birçok'],
  [/\bbirkaç\b/gu, 'birkaç'],
  [/\bbir kaç\b/gu, 'birkaç'],
  [/\bhiç bir\b/gu, 'hiçbir'],
  [/\bherkez\b/gu, 'herkes'],
  [/\byanlız\b/gu, 'yalnız'],
  [/\bhala\b/gu, 'hâlâ'],
  [/\bbirdaha\b/gu, 'bir daha'],
  [/\bfarketmez\b/gu, 'fark etmez'],
  [/\bfarkında\b/gu, 'farkında'],
  // noktalama: boşluklar
  [/\s+([,.!?;:])/gu, '$1'],
  [/([^\s]) {2,}([^\s])/gu, '$1 $2'],
  [/[ \t]+$/gmu, ''],
  // kesme işareti: boşluk ve eğik kesme
  [/\s+’/gu, '’'],
  [/([A-Za-zÇĞİÖŞÜçğıöşü])'(?=[A-Za-zÇĞİÖŞÜçğıöşü])/gu, '$1’'],
  // üç nokta
  [/\.\s*…/gu, '…'],
  [/…\s*\./gu, '…'],
  [/(?<!\.)\.\.\.(?!\.)/gu, '…'],
  // bozuk noktalama sırası: ".," / "…," / ",." kalıpları
  [/([.!?…])\s*,(?=\s|$)/gu, '$1'],
  [/,\s*([.!?…])/gu, '$1'],
  [/([;:])\s*([.!?…])/gu, '$2'],
  [/\.{2}(?![.…])/gu, '…'],
  // tırnak bitişikliği: ”“ -> ayrı satır
  [/”“/gu, '”\n“'],
  // tırnak içinde sondaki nokta gereksiz: “... .” -> “...”
  [/([.!?])”\s*\./gu, '$1”'],
];

let totals = [];
for (const [vol, files] of Object.entries(TARGETS)) {
  if (only && vol !== only) continue;
  const counts = new Map();
  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const book = JSON.parse(fs.readFileSync(p, 'utf8'));
    let changed = 0;
    for (const key of Object.keys(book)) {
      const arr = book[key];
      if (!Array.isArray(arr)) continue;
      const next = [];
      for (const raw of arr) {
        if (typeof raw !== 'string') {
          next.push(raw);
          continue;
        }
        let t = raw;
        for (const [re, rep] of FIXES) {
          const before = t;
          t = t.replace(re, rep);
          if (t !== before) {
            const name = re.source.slice(0, 26);
            counts.set(name, (counts.get(name) || 0) + 1);
          }
        }
        if (t !== raw) {
          changed++;
          if (show && shown < show) {
            shown++;
            console.log(`  [${vol}/${key}] ÖNCE: ${raw.slice(0, 130)}\n              SONRA: ${t.slice(0, 130)}`);
          }
        }
        // ”“ ayrımı satır bölmüşse paragraflara ayır
        if (t.includes('\n')) next.push(...t.split('\n'));
        else next.push(t);
      }
      book[key] = next.filter((t) => !(typeof t === 'string' && /^[“”"'‘’\s]*$/.test(t) && t.trim().length < 4));
    }
    if (changed && !dry) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
    totals.push({ vol, file: rel, changed });
  }
  if (counts.size) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`Cilt ${vol}: ` + top.map(([k, n]) => `${k}×${n}`).join(', '));
  }
}
const sum = totals.reduce((a, t) => a + t.changed, 0);
console.log(`${dry ? '(deneme) ' : ''}toplam değişen paragraf: ${sum}`);
