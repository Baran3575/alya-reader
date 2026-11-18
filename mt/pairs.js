// Paralel veri: İngilizce kaynak paragrafı <-> Türkçe çeviri paragrafı
const fs = require('fs');
const path = require('path');
const { paragraphs } = require('./paragraphs');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function loadPairs({ includeRejected = false } = {}) {
  const src = JSON.parse(fs.readFileSync(path.join(DATA, 'source.json'), 'utf8'));
  const fin = JSON.parse(fs.readFileSync(path.join(DATA, 'paragraphs_final.json'), 'utf8'));
  const pairs = [];
  for (const p of src) {
    const key = String(p.page);
    const en = paragraphs(p.text || '');
    const tr = fin[key] || [];
    if (!en.length || en.length !== tr.length) continue; // hizası bozuk sayfaları atla
    for (let i = 0; i < en.length; i++) {
      if (!includeRejected && /(Goldenagato|mp4directs|Zerobooks|Jnovels)/i.test(en[i])) continue;
      pairs.push({ page: p.page, i, en: en[i], tr: tr[i], file: key });
    }
  }
  return pairs;
}

module.exports = { loadPairs, DATA, ROOT };
