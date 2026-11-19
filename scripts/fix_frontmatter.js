// Reklam, hayran künyesi ve OCR gürültüsü sayfalarını temizler; içindekiler sayfalarını chapters.json ile yeniden yazar.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const LBL = (k) =>
  k === 'Prologue' ? 'Önsöz' : k === 'Epilogue' ? 'Sonsöz' : k.replace(/^Chapter (\d+)$/, 'Bölüm $1');
const normTypo = (s) => String(s).replace(/'/g, '’');

// Cilt 4: s.3 OCR gürültüsü ("V1 Ar l O-p y C Jycc"), s.12 reklam, s.13 İçindekiler
const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));
const chapters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chapters.json'), 'utf8'));
const rows = Object.entries(chapters).map(([k, v]) => `${LBL(k)}: ${normTypo(v)}`);

fin['3'] = []; // kapak/iç kapak OCR gürültüsü
fin['12'] = []; // reklam sayfası: sadece görsel
fin['13'] = [
  'İçindekiler',
  ...rows,
  'Resimler',
];
fs.writeFileSync(path.join(ROOT, 'data/paragraphs_final.json'), JSON.stringify(fin));

// Cilt 4.5: s.7 hayran künyesi/Discord/WordPress bağlantıları, s.8 İçindekiler, s.347 çevirmen sonsözü/bağlantılar
const fin45Path = path.join(ROOT, 'data45/paragraphs_final.json');
const chapters45Path = path.join(ROOT, 'data45/chapters.json');
if (fs.existsSync(fin45Path) && fs.existsSync(chapters45Path)) {
  const fin45 = JSON.parse(fs.readFileSync(fin45Path, 'utf8'));
  const chapters45 = JSON.parse(fs.readFileSync(chapters45Path, 'utf8'));
  const rows45 = Object.entries(chapters45).map(([k, v]) => `${LBL(k)}: ${normTypo(v)}`);

  fin45['7'] = []; // hayran çeviri künyesi (Discord / WordPress / NovelUpdates)
  fin45['8'] = [
    'İçindekiler',
    ...rows45,
  ];
  fin45['347'] = []; // hayran çevirmen notu / Discord davetleri
  fs.writeFileSync(fin45Path, JSON.stringify(fin45));
}

console.log('ön ve arka sayfalar düzeltildi (Cilt 4 & Cilt 4.5)');
