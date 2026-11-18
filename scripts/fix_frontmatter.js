// Reklam sayfasını metinsiz bırakır, içindekiler sayfasını chapters.json başlıklarıyla yeniden yazar.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));
const chapters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chapters.json'), 'utf8'));
const LBL = (k) =>
  k === 'Prologue' ? 'Önsöz' : k === 'Epilogue' ? 'Sonsöz' : k.replace(/^Chapter (\d+)$/, 'Bölüm $1');
const rows = Object.entries(chapters).map(([k, v]) => `${LBL(k)}: ${v}`);

fin['12'] = []; // reklam sayfası: sadece görsel
fin['13'] = [
  'İçindekiler',
  ...rows,
  'Resimler',
];
fs.writeFileSync(path.join(ROOT, 'data/paragraphs_final.json'), JSON.stringify(fin));
console.log('ön sayfalar düzeltildi');
