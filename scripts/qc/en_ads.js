// İngilizce kaynakta reklam / filigran satırlarını bulur.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { VOLUME_KEYS, VOLUMES } = require('../lib/volumes');

const AD_RE = /(zerobooks|download our mobile app|glucose translation|yen press|patreon|discord\.gg|follow us on|visit www|http:\/\/|https:\/\/|isbn|all rights reserved|translation by)/i;

let total = 0;
for (const k of VOLUME_KEYS) {
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile)) continue;
  const pages = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
  const hits = [];
  for (const p of pages) {
    if (!p.text) continue;
    const lines = p.text.split(/\n/).filter((l) => AD_RE.test(l));
    if (lines.length) hits.push({ page: p.page, lines });
  }
  if (hits.length) {
    console.log('Cilt', k, '-', hits.length, 'sayfa');
    for (const h of hits.slice(0, 3)) console.log('   s.' + h.page, JSON.stringify(h.lines[0].slice(0, 90)));
    total += hits.length;
  }
}
console.log('toplam', total, 'sayfa');
