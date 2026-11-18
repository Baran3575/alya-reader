// Metin içi bozukluk taraması (elle düzeltme listesi için)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));
const checks = [
  ['başta virgül', /^[,\s]*,\s*\S/],
  ['"bir gibi"', /\bbir gibi\b/],
  ['çift boşluk', /\S {2,}\S/],
  ['boşluk+virgül', /\s,/],
  ['kelime tekrarı', /\b(\w{4,})\s+\1\b/i],
  ['tek başına noktalama', /^[.,;:!?]+$/],
  ['bozuk ek', /\b(bir|bu)\s+(gibi|kadar)\s+(gibi|kadar)\b/],
  ['yarım tırnak', /^[^"]*"[^"]*$/],
];
const hits = {};
for (const [name] of checks) hits[name] = [];
for (const [p, arr] of Object.entries(f)) {
  arr.forEach((t, i) => {
    for (const [name, re] of checks) {
      if (re.test(t)) hits[name].push([p, i, t.slice(0, 110)]);
    }
  });
}
for (const [name, list] of Object.entries(hits)) {
  console.log(`--- ${name}: ${list.length}`);
  if (['başta virgül', '"bir gibi"', 'kelime tekrarı', 'tek başına noktalama'].includes(name)) {
    list.slice(0, 8).forEach((x) => console.log('  s' + x[0] + '.' + x[1], '|', x[2]));
  }
}
