// Reklam, hayran künyesi ve OCR gürültüsü sayfalarını temizler; içindekiler sayfalarını chapters.json ile yeniden yazar.
const fs = require('fs');
const path = require('path');
const { isOcrNoise } = require('./qc/verify');

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
  fs.writeFileSync(fin45Path, JSON.stringify(fin45, null, 1) + '\n');
}

// Cilt 6, 7, 8, 9, 10: Glucose Translations / NaCl hayran çeviri künyesi ve Discord/doxx uyarı sayfaları
const FAN_CREDIT_PAGES = {
  data6: ['6'],
  data7: ['5'],
  data8: ['6'],
  data9: ['7'],
  data10: ['6', '7', '249'],
};
for (const [dir, pages] of Object.entries(FAN_CREDIT_PAGES)) {
  const fp = path.join(ROOT, dir, 'paragraphs_final.json');
  if (!fs.existsSync(fp)) continue;
  const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
  for (const p of pages) {
    if (Object.prototype.hasOwnProperty.call(obj, p)) obj[p] = [];
  }
  fs.writeFileSync(fp, JSON.stringify(obj, null, 1) + '\n');
}

// Cilt 9.5: siyah-beyaz illüstrasyon Tesseract OCR gürültüsü ve ters eğik çizgi kalıntıları
const fin95Path = path.join(ROOT, 'data95/paragraphs_final.json');
if (fs.existsSync(fin95Path)) {
  const fin95 = JSON.parse(fs.readFileSync(fin95Path, 'utf8'));
  const SHORT_OCR_JUNK = new Set([
    '1S',
    '2a',
    '2P',
    '88 ay',
    '@: 7 ——“\\”',
    '’ e I yasaları S',
  ]);
  for (const [pg, arr] of Object.entries(fin95)) {
    if (!Array.isArray(arr)) continue;
    fin95[pg] = arr
      .map((t) =>
        String(t)
          .replace(/^“\\\.\s*/u, '“…')
          .replace(/^“\\…/u, '“…')
          .replace(/:\s*a\s*=\s*Ye\s+çiğ\s*-\s*Y\s+N\\\\[\s\S]*$/u, '…')
      )
      .filter((t) => {
        if (!t.trim()) return false;
        if (isOcrNoise(t)) return false;
        if (SHORT_OCR_JUNK.has(t.trim())) return false;
        if (pg === '131' && (t === 'Ben' || t === 'Vay be')) return false;
        return true;
      });
  }
  fs.writeFileSync(fin95Path, JSON.stringify(fin95, null, 1) + '\n');
}

console.log('ön/arka hayran künyesi ve OCR gürültüsü sayfaları düzeltildi (Cilt 4 – 10)');
