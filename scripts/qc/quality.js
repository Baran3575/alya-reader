// Cilt 4 çeviri kalite taraması: paragraf başına "makine çevirisi" izlerini puanlar.
// Kullanım: node scripts/qc/quality.js [TR dosyası] [--top N]
const fs = require('fs');
const path = require('path');

const TR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data/paragraphs_final.json';
const topArg = process.argv.indexOf('--top');
const TOP = topArg > -1 ? Number(process.argv[topArg + 1]) : 25;

const data = JSON.parse(fs.readFileSync(path.resolve(TR), 'utf8'));

// Ağırlıklı izler: [ad, regex, puan]
const SIGNS = [
  ['kalıp: bir şekilde', /bir şekilde/g, 2],
  ['kalıp: bir nevi', /bir nevi/g, 2],
  ['kalıp: söz konusu', /söz konusu/g, 3],
  ['kalıp: -lı bir şekilde', /lı bir şekilde|li bir şekilde/g, 3],
  ['kalıp: olmasına rağmen', /olmasına rağmen/g, 1],
  ['kalıp: açısından', /açısından/g, 1],
  ['kalıp: konusunda', /konusunda/g, 1],
  ['kalıp: yönelik', /yönelik/g, 1],
  ['kalıp: adeta', /adeta|âdeta/g, 1],
  ['kalıp: sanki', /sanki/g, 1],
  ['kalıp: gibiydi/görünüyordu', /gibiydi|görünüyordu/g, 1],
  ['kalıp: fark etmeden', /farkında olmadan|fark etmeden/g, 1],
  ['edilgen: -ilmektedir', /[ıiuü]lmektedir|[ıiuü]lmıştır/g, 3],
  ['edilgen zinciri', /(?:ildi|ıldı|uldu|üldü)(?!\p{L})[^.!?]{0,120}?(?:ildi|ıldı|uldu|üldü)(?!\p{L})/gu, 2],
  ['İngilizce kalıntı', /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gu, 3],
  ['çevirmen notu', /\b(?:ÇN|TN)\s*:/g, 5],
  ['düz tırnak', /["']/g, 2],
  ['çift boşluk', / {2,}/g, 1],
  ['nokta tekrarı', /([!?.])\1{1,}/g, 2],
  ['tire ile başlayan cümle', /(?:^|[.!?]\s)—\s/g, 1],
];

function sentences(t) {
  return t.split(/(?<=[.!?…])\s+/).filter(Boolean);
}

function score(p, i, x) {
  const notes = [];
  let s = 0;
  for (const [name, re, w] of SIGNS) {
    const m = x.match(re);
    if (m) {
      s += w * Math.min(m.length, 3);
      notes.push(name + (m.length > 1 ? '×' + m.length : ''));
    }
  }
  const sents = sentences(x);
  const words = x.split(/\s+/).filter(Boolean);
  const long = sents.filter((q) => q.split(/\s+/).length > 32);
  if (long.length) {
    s += 3 * long.length;
    notes.push('uzun cümle×' + long.length);
  }
  if (words.length > 90 && sents.length < 3) {
    s += 2;
    notes.push('tek nefeslik blok');
  }
  const ve = (x.match(/\bve\b/g) || []).length;
  if (ve >= 4) {
    s += ve - 3;
    notes.push('“ve”×' + ve);
  }
  const virgul = (x.match(/,/g) || []).length;
  if (virgul >= 7) {
    s += 1;
    notes.push('virgül yığını×' + virgul);
  }
  // aynı cümle başı iki kez
  const heads = sents.map((q) => q.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
  const dupHead = heads.find((h, k) => heads.indexOf(h) !== k);
  if (dupHead && dupHead.length > 3) {
    s += 2;
    notes.push('tekrar eden cümle başı: ' + dupHead);
  }
  // aynı kelime 4+ kez
  const freq = {};
  for (const w of words) {
    const k = w.toLowerCase().replace(/[^\wçğıöşüâî]/gu, '');
    if (k.length < 5) continue;
    freq[k] = (freq[k] || 0) + 1;
  }
  const worst = Object.entries(freq).filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1])[0];
  if (worst) {
    s += 2;
    notes.push('kelime tekrarı: ' + worst[0] + '×' + worst[1]);
  }
  return { key: p + '.' + i, page: +p, idx: i, score: s, notes, words: words.length, text: x };
}

const rows = [];
for (const [p, arr] of Object.entries(data)) arr.forEach((x, i) => rows.push(score(p, i, x)));

rows.sort((a, b) => b.score - a.score || b.words - a.words);
const total = rows.length;
const flagged = rows.filter((r) => r.score >= 3);
const sum = rows.reduce((a, r) => a + r.score, 0);

console.log('=== ' + path.basename(TR) + ' ===');
console.log('paragraf:', total, '| ortalama puan:', (sum / total).toFixed(2), '| 3+ puanlı:', flagged.length);
const byNote = {};
for (const r of flagged) for (const n of r.notes) {
  const k = n.replace(/×\d+$/, '').replace(/:.*$/, '');
  byNote[k] = (byNote[k] || 0) + 1;
}
console.log('iz dağılımı:', Object.entries(byNote).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · '));
console.log('\n--- en kötü ' + TOP + ' ---');
for (const r of rows.slice(0, TOP)) {
  console.log('s' + r.key + ' [' + r.score + '] ' + r.notes.join(', '));
  console.log('   ' + r.text.slice(0, 200).replace(/\n/g, ' '));
}

if (process.argv.includes('--json')) {
  fs.writeFileSync('data/quality_queue.json', JSON.stringify(rows.filter((r) => r.score >= 3).slice(0, 200), null, 0));
  console.log('\nkuiuk: data/quality_queue.json');
}
