// Google Translate ile sayfa metinlerini Türkçeye çevirir.
// Kullanım: node scripts/translate.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data/source.json');
const OUT = path.join(ROOT, 'data/tr.json');

const API = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const clean = (t) =>
  t
    .replace(/Page\s+\d+\s*(Goldenagato\s*\|\s*mp4directs\.com)?/gi, '')
    .replace(/Goldenagato\s*\|\s*mp4directs\.com/gi, '')
    .replace(/(Stay up to date On Light Novels[\s\S]*?Join our Discord[\s\S]*?(?:account|novels\.com))/gi, '')
    .replace(/Download all your Favorite Light Novels/gi, '')
    .replace(/Zerobooks[^\n]*/gi, '')
    .replace(/Jnovels\.com/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

async function translateChunk(texts) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  for (let attempt = 0; attempt < 4; attempt++) {
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
      if (flat.length !== texts.length) throw new Error('count mismatch ' + flat.length + '/' + texts.length);
      return flat;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}

(async () => {
  const pages = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  let done = {};
  if (fs.existsSync(OUT)) done = JSON.parse(fs.readFileSync(OUT, 'utf8'));

  const todo = [];
  for (const p of pages) {
    const key = String(p.page);
    if (done[key] && done[key].length > 0) continue;
    const text = clean(p.text || '');
    if (text.length < 25) {
      done[key] = '';
      continue;
    }
    todo.push({ page: p.page, text });
  }
  console.log(`çevrilecek sayfa: ${todo.length} (önbellekte ${Object.keys(done).length})`);

  // sayfaları ~3500 karakterlik gruplara böl (tek istekte çok sayfa)
  const batches = [];
  let cur = [];
  let curLen = 0;
  for (const item of todo) {
    if (cur.length >= 6 || (curLen + item.text.length > 3500 && cur.length)) {
      batches.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(item);
    curLen += item.text.length;
  }
  if (cur.length) batches.push(cur);

  let n = 0;
  for (const batch of batches) {
    n++;
    const texts = batch.map((b) => b.text);
    let out;
    try {
      out = await translateChunk(texts);
    } catch (e) {
      // grupta sorun varsa tek tek dene
      out = [];
      for (const t of texts) {
        try {
          out.push((await translateChunk([t]))[0] || '');
        } catch {
          out.push('');
        }
      }
    }
    batch.forEach((b, i) => {
      done[String(b.page)] = (out[i] || '').trim();
    });
    fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
    console.log(`grup ${n}/${batches.length} tamam (${Object.keys(done).length}/282)`);
  }
  console.log('bitti');
})();
