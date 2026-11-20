// public/books/v<CİLT>.json dosyalarını buildBook çıktısıyla yeniler (statik yedek).
const fs = require('fs');
const path = require('path');
const { buildBook } = require('../server.js');
const { VOLUMES, VOLUME_KEYS } = require('./lib/volumes');

const DIR = path.join(__dirname, '..', 'public', 'books');
fs.mkdirSync(DIR, { recursive: true });

let n = 0;
for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile) || !fs.existsSync(cfg.finalFile)) continue;
  const book = buildBook(cfg);
  fs.writeFileSync(path.join(DIR, `v${k}.json`), JSON.stringify(book));
  n += 1;
}
console.log(`✓ public/books yenilendi: ${n} cilt`);
