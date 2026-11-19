// Metne sadakat kapısı: çeviri, kaynak sayfayla yapısal olarak eşleşmeli.
// Ölçüt: scripts/qc/fidelity.js (diyalog, {…}, özel adlar, uzunluk oranı).
const assert = require('assert');
const { analyze, PAIRS } = require('../scripts/qc/fidelity.js');

const MIN_AVG = 80; // cilt ortalaması alt sınırı
const MIN_PAGE = 30; // tek sayfa taban puanı
const MIN_RATIO = 0.45; // TR/EN kelime oranı alt sınırı

console.log('Metne sadakat denetimi...');
const results = [];
for (const vol of Object.keys(PAIRS)) {
  const res = analyze(vol);
  if (res) results.push(res);
}

const problems = [];
for (const r of results) {
  const short = r.rows.filter((x) => x.ratio && x.ratio < MIN_RATIO);
  const worst = r.rows.slice().sort((a, b) => a.score - b.score)[0];
  console.log(
    `  Cilt ${r.vol}: ort ${r.avg.toFixed(1)} · <70: ${r.low}/${r.rows.length}` +
      (worst ? ` · en düşük s.${worst.page} (${worst.score})` : '')
  );
  if (r.avg < MIN_AVG) problems.push(`Cilt ${r.vol}: ortalama ${r.avg.toFixed(1)} < ${MIN_AVG}`);
  for (const row of r.rows) {
    if (row.score < MIN_PAGE) problems.push(`C${r.vol} s.${row.page}: puan ${row.score} < ${MIN_PAGE}`);
  }
  for (const row of short) {
    problems.push(`C${r.vol} s.${row.page}: uzunluk oranı ${row.ratio.toFixed(2)} < ${MIN_RATIO} (içerik atlanmış)`);
  }
}

assert.deepStrictEqual(problems, [], 'sadakat sorunları:\n  ' + problems.join('\n  '));
console.log('  ✓ Tüm ciltlerde yapısal sadakat eşiklerin üstünde');
