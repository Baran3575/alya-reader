const fs = require('fs');
const path = require('path');
const FILE = process.env.ALYA_TR_FILE
  ? path.resolve(process.env.ALYA_TR_FILE)
  : path.join(__dirname, '..', '..', 'data', 'paragraphs_final.json');

function load() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data));
}
// her paragrafı gezer, fn(text) -> yeni metin
function run(fn, { label, dry = false, show = 6 } = {}) {
  const data = load();
  let changed = 0;
  const samples = [];
  for (const [pg, arr] of Object.entries(data)) {
    arr.forEach((t, i) => {
      const out = fn(t, pg, i);
      if (out !== t) {
        changed++;
        if (samples.length < show) samples.push([pg, i, t, out]);
        data[pg][i] = out;
      }
    });
  }
  if (!dry) save(data);
  console.log(`${label}: ${changed} paragraf ${dry ? '(önizleme)' : 'düzeltildi'}`);
  for (const [pg, i, a, b] of samples) {
    console.log(`  s${pg}.${i}`);
    console.log('   -,', a.slice(0, 150));
    console.log('   +,', b.slice(0, 150));
  }
  return changed;
}
const VOWELS = 'aeıioöuüâîû';
function lastVowel(word) {
  const w = word.toLocaleLowerCase('tr');
  for (let i = w.length - 1; i >= 0; i--) if (VOWELS.includes(w[i])) return w[i];
  return 'a';
}
function harmony(word) {
  // son ünlüye göre ı/i/u/ü
  const v = lastVowel(word);
  if ('aı'.includes(v)) return 'ı';
  if ('ei'.includes(v)) return 'i';
  if ('ou'.includes(v)) return 'u';
  return 'ü';
}
module.exports = { load, save, run, lastVowel, harmony };
