// Paragraf bazlı Google Translate çevirisi -> data/paragraphs.json
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data/source.json');
const OUT = path.join(ROOT, 'data/paragraphs.json');

const API = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const NOISE = /(Goldenagato|mp4directs|jnovels|zerobooks|Download all your Favorite|Stay up to date On Light Novels)/i;

function paragraphs(text) {
  const lines = text
    .split('\n')
    .map((s) => s.replace(NOISE.source ? s : s, s).trim())
    .filter((s) => s && !NOISE.test(s));
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = ln.startsWith('"');
      const shortPrev = prev.length < 48 && prevEnds;
      if (prevEnds && (newDialogue || shortPrev)) {
        blocks.push(cur.join(' '));
        cur = [];
      }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));

  const out = [];
  for (const b of blocks) {
    const clean = b
      .replace(/Page\s+\d+/gi, '')
      .replace(NOISE, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) continue;
    if (clean.length <= 520) {
      out.push(clean);
      continue;
    }
    const sents = clean.match(/[^.!?]+[.!?]+["”]?|\S[^.!?]*$/g) || [clean];
    let buf = '';
    for (const s of sents) {
      if ((buf + s).length > 480 && buf) {
        out.push(buf.trim());
        buf = '';
      }
      buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

async function translateChunk(texts) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Referer: 'https://translate.google.com/',
        },
        body: body.toString(),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('bad payload');
      const flat = data.map((d) => (typeof d === 'string' ? d : Array.isArray(d) ? d[0] : ''));
      if (flat.length !== texts.length) throw new Error('count ' + flat.length + '/' + texts.length);
      return flat;
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

(async () => {
  const pages = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  let done = { __meta: {} };
  if (fs.existsSync(OUT)) {
    try {
      done = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch {}
  }

  const items = [];
  for (const p of pages) {
    const key = String(p.page);
    if (done[key]) continue;
    const paras = paragraphs(p.text || '');
    if (!paras.length) {
      done[key] = [];
      continue;
    }
    paras.forEach((t, i) => items.push({ key, i, t, n: paras.length }));
  }
  console.log('çevrilecek paragraf:', items.length);

  const SIZE = 20;
  const batches = [];
  for (let i = 0; i < items.length; i += SIZE) batches.push(items.slice(i, i + SIZE));

  let b = 0;
  for (const batch of batches) {
    b++;
    let res;
    try {
      res = await translateChunk(batch.map((x) => x.t));
    } catch {
      res = [];
      for (const it of batch) {
        try {
          res.push((await translateChunk([it.t]))[0] || '');
        } catch {
          res.push(it.t);
        }
      }
    }
    batch.forEach((it, idx) => {
      const k = it.key;
      if (!Array.isArray(done[k])) done[k] = new Array(it.n).fill('');
      done[k][it.i] = (res[idx] || '').trim();
    });
    if (b % 4 === 0 || b === batches.length) {
      fs.writeFileSync(OUT, JSON.stringify(done));
      console.log(`grup ${b}/${batches.length} — ${Object.keys(done).length - 1}/282 sayfa`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fs.writeFileSync(OUT, JSON.stringify(done));
  console.log('bitti');
})();
