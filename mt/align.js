// Kelime hizalaması: IBM Model 1 + köşegen önceli (IBM-2 benzeri), iki yönlü eğitim,
// grow-diag-final simetrikleştirme. Öbek tablosu bundan üretilir.
const NULL = 'NULL';

function pairKey(e, f) {
  return e + '\u0001' + f;
}

function normalize(t) {
  const groups = new Map();
  for (const [k] of t) {
    const e = k.slice(0, k.indexOf('\u0001'));
    if (!groups.has(e)) groups.set(e, []);
    groups.get(e).push(k);
  }
  for (const [, keys] of groups) {
    let sum = 0;
    for (const k of keys) sum += t.get(k);
    if (sum <= 0) continue;
    for (const k of keys) t.set(k, t.get(k) / sum);
  }
}

function initTable(eSeqs, fSeqs) {
  const t = new Map();
  for (let s = 0; s < eSeqs.length; s++) {
    for (const ew of eSeqs[s]) for (const fw of fSeqs[s]) {
      const k = pairKey(ew, fw);
      t.set(k, (t.get(k) || 0) + 1);
    }
  }
  for (const [k, c] of t) t.set(k, c / t.size);
  return t;
}

function em(eSeqs, fSeqs, { iterations = 5, alpha = 0.7 } = {}) {
  const t = initTable(eSeqs, fSeqs);
  normalize(t);
  for (let it = 0; it < iterations; it++) {
    const total = new Map();
    for (let s = 0; s < eSeqs.length; s++) {
      const e = eSeqs[s];
      const f = fSeqs[s];
      const m = f.length;
      const l = e.length || 1;
      for (let i = 0; i < e.length; i++) {
        const center = (i / l) * m;
        let z = 0;
        const probs = new Array(m);
        for (let j = 0; j < m; j++) {
          const prior = Math.exp(-alpha * Math.abs(j - center));
          const p = (t.get(pairKey(e[i], f[j])) || 0) * prior;
          probs[j] = p;
          z += p;
        }
        if (z <= 0) continue;
        for (let j = 0; j < m; j++) {
          if (!probs[j]) continue;
          const k = pairKey(e[i], f[j]);
          total.set(k, (total.get(k) || 0) + probs[j] / z);
        }
      }
    }
    for (const [k] of t) t.set(k, Math.max(1e-9, total.get(k) || 0));
    normalize(t);
  }
  return t;
}

function viterbi(t, e, f) {
  const links = new Set();
  for (let i = 0; i < e.length; i++) {
    let bestJ = -1;
    let bestP = 1e-9;
    for (let j = 0; j < f.length; j++) {
      const p = t.get(pairKey(e[i], f[j])) || 0;
      if (p > bestP) {
        bestP = p;
        bestJ = j;
      }
    }
    if (bestJ >= 0) links.add(i + ':' + bestJ);
  }
  return links;
}

// intersection -> grow (komşuluk) -> final (her iki ucu boş bağlantıları ekle)
function symmetrize(a, b) {
  const inter = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  const out = new Set(inter);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of union) {
      if (out.has(link)) continue;
      const [i, j] = link.split(':').map(Number);
      const neigh = [i - 1 + ':' + j, i + 1 + ':' + j, i + ':' + (j - 1), i + ':' + (j + 1), i - 1 + ':' + (j - 1), i + 1 + ':' + (j + 1)];
      if (neigh.some((x) => out.has(x))) {
        out.add(link);
        changed = true;
      }
    }
  }
  const hasE = new Set([...out].map((x) => x.split(':')[0]));
  const hasF = new Set([...out].map((x) => x.split(':')[1]));
  for (const link of union) {
    const [i, j] = link.split(':').map(Number);
    if (!hasE.has(String(i)) || !hasF.has(String(j))) out.add(link);
  }
  return out;
}

function alignPairs(pairs, { iterations = 5 } = {}) {
  const eSeqs = pairs.map((p) => p.e);
  const fSeqs = pairs.map((p) => p.f);
  const tEF = em(eSeqs, fSeqs, { iterations });
  const tFE = em(fSeqs, eSeqs, { iterations });
  return pairs.map((p, idx) => {
    const a1 = viterbi(tEF, eSeqs[idx], fSeqs[idx]);
    // ters yön: aynı bağlantı biçimine çevir (i:j)
    const a2raw = viterbi(tFE, fSeqs[idx], eSeqs[idx]);
    const a2 = new Set([...a2raw].map((x) => {
      const [j, i] = x.split(':');
      return i + ':' + j;
    }));
    const links = symmetrize(a1, a2);
    const cleaned = [...links]
      .map((x) => x.split(':').map(Number))
      .filter(([i]) => eSeqs[idx][i] !== NULL)
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return cleaned;
  });
}

module.exports = { alignPairs, NULL };
