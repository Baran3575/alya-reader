// en_quality'nin hangi karaktere takıldığını gösterir (teşhis aracı).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { VOLUME_KEYS, VOLUMES } = require('../lib/volumes');

const BOX = /[\u2500-\u257F\u2580-\u259F\u25A0-\u25FF]/;
const CJK = /[\u3040-\u9FFF\uFF01-\uFF60]/;
const REP = /([bcdfghjklmnpqrstvwxyz])\1{3,}/i;
const W = /[\\|<>{}[\]]/g;

const vol = process.argv[2];
for (const k of VOLUME_KEYS) {
  if (vol && k !== vol) continue;
  const cfg = VOLUMES[k];
  if (!fs.existsSync(cfg.sourceFile)) continue;
  const pages = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
  for (const p of pages) {
    const t = p.text || '';
    const out = [];
    const b = t.match(BOX);
    const c = t.match(CJK);
    const r = t.match(REP);
    const w = t.match(W);
    if (b) out.push('BOX U+' + b[0].codePointAt(0).toString(16));
    if (c) out.push('CJK U+' + c[0].codePointAt(0).toString(16));
    if (r) out.push('REP ' + JSON.stringify(r[0]));
    if (w && w.length >= 3) out.push('ESC x' + w.length + ' ' + JSON.stringify(w.join('')));
    if (out.length) console.log('Cilt ' + k + ' s.' + p.page + ': ' + out.join(' | '));
  }
}
