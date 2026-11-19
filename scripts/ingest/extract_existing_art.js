// Mevcut public/bundle-art.js içindeki Cilt 4 ve Cilt 4.5 illüstrasyonlarını
// deterministik derleme ve sunucu kullanımı için public/art/v4 ve public/art/v45 altına çıkarır.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BUNDLE_ART = path.join(ROOT, 'public', 'bundle-art.js');

function extractExistingArt() {
  if (!fs.existsSync(BUNDLE_ART)) {
    console.log('bundle-art.js bulunamadı, atlanıyor.');
    return 0;
  }
  const code = fs.readFileSync(BUNDLE_ART, 'utf8');
  const win = {};
  new Function('window', code)(win);
  const pack = win.ALYA_ART || {};

  const mapDir = { '4': 'v4', '4.5': 'v45' };
  let written = 0;
  for (const [vol, slug] of Object.entries(mapDir)) {
    const entries = pack[vol] || {};
    const outDir = path.join(ROOT, 'public', 'art', slug);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [num, dataUri] of Object.entries(entries)) {
      const m = String(dataUri).match(/^data:image\/webp;base64,(.+)$/);
      if (!m) continue;
      const outPath = path.join(outDir, `${String(num).padStart(3, '0')}.webp`);
      fs.writeFileSync(outPath, Buffer.from(m[1], 'base64'));
      written++;
    }
  }
  console.log(`✓ ${written} mevcut illüstrasyon public/art/{v4,v45} dizinine çıkarıldı.`);
  return written;
}

if (require.main === module) {
  extractExistingArt();
}

module.exports = { extractExistingArt };
