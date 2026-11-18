// Gelişmiş eğitim: simetrik hizalama -> olasılıklı öbek tablosu (leksik ağırlıklarla),
// yeniden sıralama (distortion) modeli ve 3-gram dil modeli (absolute discounting).
// Çıktı: mt/model2.json
const fs = require('fs');
const path = require('path');
const { loadPairs, buildSentences } = require('./train');
const { alignPairs, NULL } = require('./align');

const MAX_E = 5;
const MAX_F = 7;
const ITER = 6;
const DISCOUNT = 0.75;

function extractPhrases(sents, aligns) {
  const counts = new Map(); // "e|||f"
  const cE = new Map();
  const cF = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  for (let s = 0; s < sents.length; s++) {
    const e = sents[s].e;
    const f = sents[s].f;
    const links = aligns[s];
    const e2f = new Map();
    const f2e = new Map();
    for (const [i, j] of links) {
      if (!e2f.has(i)) e2f.set(i, []);
      e2f.get(i).push(j);
      if (!f2e.has(j)) f2e.set(j, []);
      f2e.get(j).push(i);
    }

    for (let i1 = 0; i1 < e.length; i1++) {
      for (let i2 = i1; i2 < Math.min(e.length, i1 + MAX_E); i2++) {
        // bu aralıktaki tüm bağlantılar
        let ok = true;
        let js = [];
        for (let i = i1; i <= i2; i++) {
          const l = e2f.get(i);
          if (!l) { ok = false; break; }
          js.push(...l);
        }
        if (!ok || !js.length) continue;
        const j1 = Math.min(...js);
        const j2 = Math.max(...js);
        if (j2 - j1 + 1 > MAX_F) continue;
        // dışa taşma kontrolü (her iki yön)
        let leak = false;
        for (let i = i1; i <= i2 && !leak; i++) {
          for (const j of e2f.get(i) || []) if (j < j1 || j > j2) leak = true;
        }
        for (let j = j1; j <= j2 && !leak; j++) {
          for (const i of f2e.get(j) || []) if (i < i1 || i > i2) leak = true;
        }
        if (leak) continue;
        const ep = e.slice(i1, i2 + 1).join(' ');
        const fp = f.slice(j1, j2 + 1).join(' ');
        if (!ep.trim() || !fp.trim()) continue;
        bump(counts, ep + '|||' + fp);
        bump(cE, ep);
        bump(cF, fp);
      }
    }
  }
  return { counts, cE, cF };
}

// kelime çeviri olasılıkları (leksik ağırlık için)
function wordTable(sents, aligns) {
  const t = new Map();
  const tot = new Map();
  for (let s = 0; s < sents.length; s++) {
    for (const [i, j] of aligns[s]) {
      const k = sents[s].e[i] + '\u0001' + sents[s].f[j];
      t.set(k, (t.get(k) || 0) + 1);
      tot.set(sents[s].e[i], (tot.get(sents[s].e[i]) || 0) + 1);
    }
  }
  return { t, tot };
}

function lexicalWeight(ew, fw, wt) {
  const c = wt.t.get(ew + '\u0001' + fw) || 0;
  const d = wt.tot.get(ew) || 0;
  return d ? Math.max(1e-7, c / d) : 1e-7;
}

function buildPhraseTable(ext) {
  const { counts, cE, cF } = ext;
  const rows = [];
  for (const [k, c] of counts) {
    const [e, f] = k.split('|||');
    const eLen = e.split(' ').length;
    const fLen = f.split(' ').length;
    if (fLen > 2 * eLen + 3) continue; // uzunluk dengesizliği
    const pe = cE.get(e) || 1;
    const pfe = cF.get(f) || 1;
    rows.push([e, f, c, c / pe, c / pfe, eLen, fLen]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  return rows;
}

function distortionHistogram(aligns) {
  const buckets = new Array(21).fill(0); // -10..10
  for (const links of aligns) {
    let prevJ = -1;
    for (const [i, j] of links) {
      let d = j - prevJ - 1;
      d = Math.max(-10, Math.min(10, d));
      buckets[d + 10] += 1;
      prevJ = j;
    }
  }
  const total = buckets.reduce((a, b) => a + b, 0) || 1;
  return buckets.map((c) => (c + 0.1) / (total + 0.1 * 21));
}

function trainLM(sents) {
  const p1 = new Map();
  const p2 = new Map();
  const p3 = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const s of sents) {
    const seq = ['<s>', '<s>', ...s.f, '</s>'];
    for (let i = 2; i < seq.length; i++) {
      bump(p1, seq[i]);
      bump(p2, seq[i - 1] + ' ' + seq[i]);
      bump(p3, seq[i - 2] + ' ' + seq[i - 1] + ' ' + seq[i]);
    }
  }
  const V = p1.size;
  const total = [...p1.values()].reduce((a, b) => a + b, 0);
  const uni = {};
  for (const [w, c] of p1) uni[w] = c / total;

  // absolute discounting: p(w|ctx) = max(c - D, 0)/c(ctx) + lambda * p(w|shortctx)
  const build = (counts, order) => {
    const ctxTot = new Map();
    const ctxDiff = new Map();
    for (const [k, c] of counts) {
      const parts = k.split(' ');
      const ctx = parts.slice(0, order).join(' ');
      ctxTot.set(ctx, (ctxTot.get(ctx) || 0) + c);
      ctxDiff.set(ctx, (ctxDiff.get(ctx) || 0) + 1);
    }
    const out = {};
    for (const [k, c] of counts) {
      const parts = k.split(' ');
      const ctx = parts.slice(0, order).join(' ');
      const w = parts[order];
      const tot = ctxTot.get(ctx) || 1;
      const diff = ctxDiff.get(ctx) || 1;
      const lam = (DISCOUNT * diff) / tot;
      if (!out[ctx]) out[ctx] = { lam, next: {} };
      out[ctx].next[w] = Math.max(c - DISCOUNT, 1e-6) / tot;
    }
    return out;
  };

  return {
    uni,
    D: DISCOUNT,
    V,
    tri: build(p3, 2),
    bi: build(p2, 1),
  };
}

function main() {
  const pairs = loadPairs();
  const sents = buildSentences(pairs);
  console.log('cümle:', sents.length);
  console.log('hizalama');
  const aligns = alignPairs(sents, { iterations: ITER });
  const linked = aligns.reduce((a, l) => a + l.length, 0);
  console.log('bağlantı:', linked, '(ortalama', (linked / sents.length).toFixed(2), 'bağlantı/cümle)');

  console.log('öbek tablosu');
  const ext = extractPhrases(sents, aligns);
  const rows = buildPhraseTable(ext);
  console.log('öbek çifti:', rows.length);

  const wt = wordTable(sents, aligns);
  const phrases = {};
  let kept = 0;
  for (const [e, f, c, pfe, pef] of rows) {
    if (kept > 250000) break;
    if (c < 1) continue;
    const eWords = e.split(' ');
    const fWords = f.split(' ');
    let lexF = 1;
    for (const fw of fWords) {
      let sum = 0;
      for (const ew of eWords) sum += lexicalWeight(ew, fw, wt);
      lexF *= sum / eWords.length;
    }
    let lexE = 1;
    for (const ew of eWords) {
      let sum = 0;
      for (const fw of fWords) sum += lexicalWeight(ew, fw, wt);
      lexE *= sum / fWords.length;
    }
    if (!phrases[e]) phrases[e] = [];
    phrases[e].push([f, Math.log(pfe), Math.log(pef), Math.log(lexF), Math.log(lexE), c]);
    kept++;
  }
  for (const e of Object.keys(phrases)) {
    phrases[e].sort((a, b) => b[1] - a[1]);
    phrases[e] = phrases[e].slice(0, 6);
  }

  console.log('dil modeli');
  const lm = trainLM(sents);
  const model = {
    meta: {
      pairs: sents.length,
      alignmentLinks: linked,
      phraseEntries: Object.keys(phrases).length,
      phrasePairs: kept,
      lmVocab: lm.V,
      trainedAt: new Date().toISOString(),
      version: 2,
      source: 'Alya Vol 4 (EN fan translation -> TR), IBM1+diag, grow-diag-final',
    },
    phrases,
    distortion: distortionHistogram(aligns),
    lm,
  };
  const out = path.join(__dirname, 'model2.json');
  fs.writeFileSync(out, JSON.stringify(model));
  console.log('yazıldı:', out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB');

  // hızlı hizalama kontrolü
  for (let k = 0; k < 3; k++) {
    console.log('\nEN:', sents[k].e.filter((x) => x !== NULL).join(' '));
    console.log('TR:', sents[k].f.join(' '));
    console.log('bağlantılar:', aligns[k].map(([i, j]) => `${sents[k].e[i]}→${sents[k].f[j]}`).slice(0, 8).join(', '));
  }
}

if (require.main === module) main();
module.exports = { main };
