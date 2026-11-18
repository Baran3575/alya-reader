// Motorun ölçümü: ayrılmış (held-out) cümlelerde NMT / Google / DeepL karşılaştırması.
// Referans: kitabın mevcut Türkçe metni (DeepL ağırlıklı) -> salt okunur bir yakınlık ölçüsü.
const fs = require('fs');
const path = require('path');
const { loadPairs, buildSentences, trainAll, splitSentences } = require('./train');
const { words } = require('./tokenize');

function f1(hyp, ref) {
  const h = words(hyp, 'tr');
  const r = words(ref, 'tr');
  if (!h.length || !r.length) return 0;
  const rc = new Map();
  for (const w of r) rc.set(w, (rc.get(w) || 0) + 1);
  let hit = 0;
  const hc = new Map();
  for (const w of h) hc.set(w, (hc.get(w) || 0) + 1);
  for (const [w, c] of hc) hit += Math.min(c, rc.get(w) || 0);
  const p = hit / h.length;
  const rec = hit / r.length;
  return p + rec ? (2 * p * rec) / (p + rec) : 0;
}

const pairs = loadPairs();
const sents = buildSentences(pairs);
const holdout = sents.filter((_, i) => i % 12 === 0); // ~%8 ayrıldı
const trainSet = sents.filter((_, i) => i % 12 !== 0);
console.log('eğitim cümlesi:', trainSet.length, '| ayrılan:', holdout.length);

const { phrases, lm } = trainAll(trainSet);
fs.writeFileSync(path.join(__dirname, 'model.holdout.json'), JSON.stringify({ phrases, lm }));

const { translate } = require('./translate');
const b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bilingual.json'), 'utf8'));

// ayrılan cümleler için Google/DeepL adaylarını paralel metinden almak zor;
// burada sadece NMT'yi referansa karşı ölçüp, aynı referansın "insan üstü tavan"
// olarak 1.0 olduğunu raporluyoruz. Karşılaştırma için ayrı bir betik kullanılıyor.
let sum = 0;
let n = 0;
const ex = [];
for (const s of holdout.slice(0, 120)) {
  const hyp = translate(s.eRaw.join(' '));
  const ref = s.f.join(' ');
  const sc = f1(hyp, ref);
  sum += sc;
  n++;
  if (ex.length < 8) ex.push({ hyp, ref });
}
console.log('NMT ortalama kelime-F1 (ayrılmış):', (sum / n).toFixed(3));
for (const e of ex) {
  console.log('\nNMT:', e.hyp);
  console.log('REF:', e.ref);
}
