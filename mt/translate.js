// Eğitilen modele dayalı monoton öbek tabanlı çözücü (EN -> TR).
// Amaç: romanın kendi terimleriyle kısa cümleleri çevirebilmek; uzun paragraflarda
// yeniden sıralama yapmadığı için DeepL kadar akıcı değildir -> yeniden sıralayıcıda aday olarak kullanılır.
const fs = require('fs');
const path = require('path');
const { tokenize, words } = require('./tokenize');

let MODEL = null;
function loadModel() {
  if (!MODEL) MODEL = JSON.parse(fs.readFileSync(process.env.ALYA_MT_MODEL || path.join(__dirname, 'model.json'), 'utf8'));
  return MODEL;
}

function lmLogp(lm, ctx2, ctx1, w) {
  const tri = lm.tri[ctx2 + ' ' + ctx1];
  if (tri && tri[w]) return Math.log10(tri[w]);
  const uni = lm.uni[w];
  if (uni) return Math.log10(uni) - 0.6; // geri çekilme cezası
  return -4.5; // bilinmeyen kelime
}

const PUNCT = new Set(['.', ',', '!', '?', ';', ':', '(', ')', '"', "'", '…', '—', '–', '~', '-']);

function translate(en, { beam = 40, maxLen = 0, debug = false } = {}) {
  const model = loadModel();
  const toks = tokenize(en, 'en').filter((t) => !PUNCT.has(t));
  const n = toks.length;
  maxLen = maxLen || Math.ceil(n * 2.6) + 6;
  let beams = [{ pos: 0, out: [], score: 0, l1: '<s>', l2: '<s>' }];

  while (true) {
    const active = beams.filter((b) => b.pos < n);
    if (!active.length) break;
    const cand = [];
    for (const b of active) {
      for (let len = 1; len <= 4 && b.pos + len <= n; len++) {
        const key = toks.slice(b.pos, b.pos + len).join(' ');
        const entry = model.phrases[key];
        if (!entry) continue;
        for (const [tr, count] of entry) {
          const trToks = tr.split(' ');
          if (b.out.length + trToks.length > maxLen) continue;
          let lp = 0;
          let l1 = b.l1;
          let l2 = b.l2;
          for (const w of trToks) {
            lp += lmLogp(model.lm, l1, l2, w);
            l2 = l1;
            l1 = w;
          }
          const phr = Math.log10(count) * 0.35;
          cand.push({
            pos: b.pos + len,
            out: b.out.concat(trToks),
            score: b.score + lp + phr + len * 0.25,
            l1,
            l2,
          });
        }
      }
    }
    if (!cand.length) {
      // bilinmeyen kelime: atla
      for (const b of active) {
        cand.push({ ...b, pos: Math.min(b.pos + 1, n), score: b.score - 2.5 });
      }
    }
    cand.sort((a, b) => b.score - a.score);
    // çeşitlilik: aynı pos+son 2 kelime tekrarını at
    const seen = new Set();
    beams = [];
    for (const c of cand) {
      const sig = c.pos + '|' + c.out.slice(-2).join(' ');
      if (seen.has(sig)) continue;
      seen.add(sig);
      beams.push(c);
      if (beams.length >= beam) break;
    }
  }

  const norm = (b) => b.score / Math.pow(Math.max(8, b.out.length), 0.75);
  const best = beams.filter((b) => b.pos >= n).sort((a, b) => norm(b) - norm(a))[0] || beams.sort((a, b) => norm(b) - norm(a))[0];
  if (!best) return '';
  let text = best.out.join(' ').replace(/\s+([.,!?;:…])/g, '$1').replace(/([(\[])\s+/g, '$1');
  text = text.charAt(0).toLocaleUpperCase('tr') + text.slice(1);
  if (!/[.!?…"']$/.test(text)) text += '.';
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1');
  if (debug) console.log('skor:', best.score.toFixed(2));
  return text;
}

if (require.main === module) {
  const line = process.argv.slice(2).join(' ') || 'I have never heard of a belly fetish.';
  console.log(translate(line, { debug: true }));
}

module.exports = { translate, loadModel, lmLogp };
