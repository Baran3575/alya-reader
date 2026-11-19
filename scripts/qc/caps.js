// Büyük harf sadakati: kaynakta ALL CAPS değilse çeviride de büyük harf olmamalı.
// node scripts/qc/caps.js [--md] [--vol 4]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MAP = {
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

// Kısaltmalar ve özel adlar büyük harf kalabilir.
const ACR = new Set([
  'USB', 'NTR', 'BSS', 'TN', 'ÇN', 'ASK', 'DVD', 'TV', 'PC', 'SNS', 'CG', 'OK', 'NG',
  'BGM', 'OP', 'ED', 'SS', 'HD', 'CM', 'PR', 'AI', 'ABD', 'DSÖ', 'MVP', 'VIP', 'FTL',
  'SSCB', 'BM', 'NATO', 'JR', 'OL', 'IS', 'AT', 'WD', 'BT', 'NM', 'TL', 'MMLC', 'FTL',
]);

const args = process.argv.slice(2);
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const md = args.includes('--md');

const CAP_TR = /(?<![\p{L}ÇĞİÖŞÜçğıöşü])([A-ZÇĞİÖŞÜ]{2,})(?![\p{L}ÇĞİÖŞÜçğıöşü])/gu;
const CAP_EN = /\b[A-Z]{2,}\b/g;

const rows = [];
for (const [vol, [sf, tf]] of Object.entries(MAP)) {
  if (only && vol !== only) continue;
  if (!fs.existsSync(path.join(ROOT, sf))) continue;
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, sf), 'utf8'));
  const srcArr = Array.isArray(src) ? src : Object.values(src);
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, tf), 'utf8'));
  for (let i = 0; i < srcArr.length; i++) {
    const page = String(i + 1);
    const arr = tr[page] || [];
    if (!arr.length) continue;
    const en = String(srcArr[i] && srcArr[i].text || '');
    const enCaps = new Set((en.match(CAP_EN) || []).map((w) => w.replace(/[^A-Z]/g, '')));
    // Kaynakta vurgu (ALL CAPS) varsa sayfa bütünüyle muaftır: vurgu eklenmiş sayılmaz.
    if (enCaps.size > 0) continue;
    for (let k = 0; k < arr.length; k++) {
      const txt = String(arr[k]);
      const found = new Set(txt.match(CAP_TR) || []);
      for (const w of found) {
        if (ACR.has(w)) continue;
        if (enCaps.has(w)) continue;
        rows.push({ vol, page, idx: k, word: w, text: txt });
      }
    }
  }
}

if (!rows.length) {
  console.log('✓ Büyük harf sadakati: kaynakta olmayan vurgu yok');
  process.exit(0);
}

console.log(`Kaynakta büyük harf olmayan vurgu: ${rows.length}`);
for (const r of rows.slice(0, 40)) {
  console.log(`  C${r.vol} s.${r.page}[${r.idx}] ${r.word} :: ${r.text.slice(0, 90)}`);
}
if (md) {
  const out = ['# Büyük Harf Sadakati', '', `Toplam: **${rows.length}**`, ''];
  for (const r of rows) out.push(`- C${r.vol} s.${r.page}[${r.idx}] **${r.word}** :: ${r.text}`);
  fs.writeFileSync(path.join(ROOT, 'docs/caps-review.md'), out.join('\n'));
  console.log('yazıldı: docs/caps-review.md');
}
if (args.includes('--check')) process.exit(1);
