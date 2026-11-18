// Bu romanın paralel verisiyle özel bir MT modeli eğitir:
//  1) IBM Model 1 ile kelime hizalaması (EM)
//  2) hizalamadan öbek (phrase) tablosu çıkarımı
//  3) Türkçe 3-gram dil modeli (kitabın kendi üslubu)
//  4) terim/isim istatistikleri
const fs = require('fs');
const path = require('path');
const { loadPairs, DATA } = require('./pairs');
const { tokenize, words } = require('./tokenize');

const ITER = 8;
const MAX_LEN = 120;

// cümle bölme: noktalama + büyük harf/tırnak sonrası
function splitSentences(text) {
  return (text || '')
    .split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9"“'\u2018(])/u)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function buildSentences(pairs) {
  const out = [];
  for (const p of pairs) {
    const es = splitSentences(p.en);
    const fsent = splitSentences(p.tr);
    // cümle sayıları yakınsa bire bir eşle; değilse uzunluğa göre orantılı eşle
    let aligned = [];
    if (es.length === fsent.length) {
      aligned = es.map((x, i) => [x, fsent[i]]);
    } else {
      // kümülatif karakter oranıyla eşleme
      const totalE = es.reduce((a, x) => a + x.length, 0) || 1;
      const totalF = fsent.reduce((a, x) => a + x.length, 0) || 1;
      let acc = 0;
      let fi = 0;
      for (const x of es) {
        acc += x.length;
        const target = Math.round((acc / totalE) * fsent.length);
        const j = Math.min(fsent.length - 1, Math.max(fi, target - 1));
        aligned.push([x, fsent[j]]);
        fi = j;
      }
    }
    aligned.forEach(([en, tr], k) => {
      const e = words(en, 'en');
      const f = words(tr, 'tr');
      if (e.length < 3 || f.length < 3 || e.length > MAX_LEN || f.length > MAX_LEN) return;
      out.push({ e: [...e, 'NULL'], eRaw: e, f, page: p.page, i: p.i, s: k });
    });
  }
  return out;
}

function trainIBM1(sents) {
  // t(f|e) seyrek tablo
  const t = new Map();
  const key = (e, f) => e + '\u0001' + f;
  const counts = new Map();
  for (const s of sents) {
    const uniqE = [...new Set(s.e)];
    const uniqF = [...new Set(s.f)];
    for (const e of uniqE) for (const f of uniqF) counts.set(key(e, f), (counts.get(key(e, f)) || 0) + 1);
  }
  for (const [k, c] of counts) t.set(k, c / counts.size + 1e-6);
  // normalize per e
  const byE = new Map();
  for (const [k, v] of t) {
    const [e] = k.split('\u0001');
    if (!byE.has(e)) byE.set(e, []);
    byE.get(e).push(k);
  }
  const normalize = () => {
    for (const [e, keys] of byE) {
      let sum = 0;
      for (const k of keys) sum += t.get(k);
      for (const k of keys) t.set(k, t.get(k) / sum);
    }
  };
  normalize();

  for (let it = 0; it < ITER; it++) {
    const total = new Map();
    for (const s of sents) {
      const uniqF = [...new Set(s.f)];
      for (const e of new Set(s.e)) {
        let z = 0;
        for (const f of uniqF) z += t.get(key(e, f)) || 0;
        if (z <= 0) continue;
        for (const f of uniqF) {
          const k = key(e, f);
          const v = (t.get(k) || 0) / z;
          total.set(k, (total.get(k) || 0) + v);
        }
      }
    }
    for (const [k, v] of total) t.set(k, v / sents.length);
    normalize();
    process.stdout.write(`  EM tur ${it + 1}/${ITER}\n`);
  }
  return t;
}

function viterbi(t, s) {
  const links = [];
  for (let i = 0; i < s.e.length; i++) {
    if (s.e[i] === 'NULL') continue;
    let best = -1;
    let bestP = -1;
    for (let j = 0; j < s.f.length; j++) {
      const p = t.get(s.e[i] + '\u0001' + s.f[j]) || 0;
      if (p > bestP) {
        bestP = p;
        best = j;
      }
    }
    if (best >= 0 && bestP > 0) links.push([i, best]);
  }
  return links;
}

function extractPhrases(sents, t) {
  const phraseCount = new Map(); // "e|||f"
  const add = (e, f) => {
    const k = e + '|||' + f;
    phraseCount.set(k, (phraseCount.get(k) || 0) + 1);
  };
  for (const s of sents) {
    const links = viterbi(t, s);
    if (!links.length) continue;
    const fOfE = new Map();
    for (const [i, j] of links) {
      if (!fOfE.has(i)) fOfE.set(i, []);
      fOfE.get(i).push(j);
    }
    const eSeq = s.e.filter((x) => x !== 'NULL');
    for (let i1 = 0; i1 < eSeq.length; i1++) {
      for (let i2 = i1; i2 < Math.min(eSeq.length, i1 + 3); i2++) {
        let js = [];
        let ok = true;
        for (let i = i1; i <= i2; i++) {
          const l = fOfE.get(i);
          if (!l) { ok = false; break; }
          js = js.concat(l);
        }
        if (!ok || !js.length) continue;
        const j1 = Math.min(...js);
        const j2 = Math.max(...js);
        if (j2 - j1 + 1 > 6) continue;
        if (j2 - j1 + 1 !== new Set(js).size) continue; // delik varsa öbek sayma
        add(eSeq.slice(i1, i2 + 1).join(' '), s.f.slice(j1, j2 + 1).join(' '));
      }
    }
  }
  // skorla: sıklık * uzunluk; en iyi 120k öbek
  const rows = [];
  for (const [k, c] of phraseCount) {
    if (c < 2) continue;
    const [e, f] = k.split('|||');
    const ec = e.split(' ').length;
    const fc = f.split(' ').length;
    if (fc > ec * 3 + 2) continue;
    rows.push([e, f, c, c * (ec + fc)]);
  }
  rows.sort((a, b) => b[3] - a[3]);
  const keep = rows.slice(0, 120000);
  const table = {};
  for (const [e, f, c] of keep) {
    if (!table[e]) table[e] = [];
    if (table[e].length < 4) table[e].push([f, c]);
  }
  return table;
}

function trainLM(sents) {
  const uni = new Map();
  const bi = new Map();
  const tri = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const s of sents) {
    const w = s.f;
    const seq = ['<s>', ...w, '</s>'];
    for (let i = 0; i < seq.length; i++) {
      bump(uni, seq[i]);
      if (i > 0) bump(bi, seq[i - 1] + ' ' + seq[i]);
      if (i > 1) bump(tri, seq[i - 2] + ' ' + seq[i - 1] + ' ' + seq[i]);
    }
  }
  const V = uni.size;
  const total = [...uni.values()].reduce((a, b) => a + b, 0);
  const model = {};
  // trigram olasılıkları: (count(w3|w1w2)+0.1)/(count(w1w2)+0.1*V)
  const triOut = {};
  for (const [k, c] of tri) {
    const parts = k.split(' ');
    const ctx = parts[0] + ' ' + parts[1];
    triOut[ctx] = triOut[ctx] || { c: bi.get(ctx) || c, next: {} };
    triOut[ctx].next[parts[2]] = c;
  }
  for (const [ctx, o] of Object.entries(triOut)) {
    const denom = o.c + 0.1 * V;
    const p = {};
    for (const [w3, c] of Object.entries(o.next)) p[w3] = (c + 0.1) / denom;
    model[ctx] = p;
  }
  const uniP = {};
  for (const [w, c] of uni) uniP[w] = c / total;
  return { uni: uniP, tri: model, V, total };
}

function trainAll(sents) {
  const t = trainIBM1(sents);
  const phrases = extractPhrases(sents, t);
  const lm = trainLM(sents);
  return { phrases, lm };
}

function main() {
  const pairs = loadPairs();
  const sents = buildSentences(pairs);
  console.log('paralel cümle:', sents.length, '| EN kelime:', sents.reduce((a, s) => a + s.e.length, 0), '| TR kelime:', sents.reduce((a, s) => a + s.f.length, 0));

  console.log('IBM Model 1 eğitimi');
  const t = trainIBM1(sents);

  console.log('öbek tablosu');
  const phrases = extractPhrases(sents, t);
  const phraseCount = Object.keys(phrases).length;

  console.log('Türkçe dil modeli');
  const lm = trainLM(sents);

  const model = {
    meta: {
      pairs: sents.length,
      phrases: phraseCount,
      vocabTr: Object.keys(lm.uni).length,
      trainedAt: new Date().toISOString(),
      source: 'Alya Sometimes Hides Her Feelings in Russian, Vol 4 (EN fan translation -> TR)',
    },
    phrases,
    lm,
  };
  const out = path.join(__dirname, 'model.json');
  fs.writeFileSync(out, JSON.stringify(model));
  console.log('model yazıldı:', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
}

if (require.main === module) main();
module.exports = { buildSentences, trainIBM1, extractPhrases, trainLM, trainAll, splitSentences, loadPairs };
