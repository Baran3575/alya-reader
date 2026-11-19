// Google Translate + DeepL ile paragraf paragraf çift çeviri -> data/bilingual.json
// Kullanım: node scripts/translate3.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function resolveVolumePaths(vol = '4') {
  const v = String(vol || '4');
  const dir = v === '4' ? 'data' : 'data' + v.replace(/\./g, '');
  return {
    vol: v,
    dir,
    src: path.join(ROOT, dir, 'source.json'),
    out: path.join(ROOT, dir, 'bilingual.json'),
    fin: path.join(ROOT, dir, 'paragraphs_final.json'),
  };
}

const DEEPL_KEY =
  process.env.DEEPL_KEY || (fs.existsSync(path.join(ROOT, '.deepl-key')) ? fs.readFileSync(path.join(ROOT, '.deepl-key'), 'utf8').trim() : '');
const G_URL = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const D_URL = 'https://api-free.deepl.com/v2/translate';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const NOISE =
  /(?:https?:\s*\/\/\S*(?:glucosetl|novelupdates|lightnovelreader|mp4directs|jnovels|zerobooks)\S*|Goldenagato\s*\|\s*mp4directs\.com|Goldenagato|mp4directs(?:\.com)?|jnovels(?:\.com)?|zerobooks(?:\s+(?:Universal|USA\s+ONLY|IOS))?|glucosetl(?:\.wordpress\.com)?|discord\.gg\/\S+|novelupdates(?:\.com\S*)?|lightnovelreader(?:\.me\S*)?|Download all your Favorite(?: Light Novels)?|Stay up to date On Light Novels[^\n]*|Join our Discord and meet Thousands[^\n]*)/gi;

const SKIP_PAGE_RE =
  /(discord\.gg|glucosetl|novelupdates|lightnovelreader|TLed and Edited\s*by|fan translators? and editors?|Join our Discord|Download all your Favorite Light Novels|Stay up to date On Light Novels)/i;

const TERMINAL_END_RE = /[.!?"”'\u2019…~)\]»*}◇]$/;
const HONORIFIC_CONT_RE = /^(kun|chan|san|sama|senpai)\b/i;
const NAME_TAIL_RE = /\b(Masachika|Alisa|Alya|Maria|Masha|Yuki|Ayano|Sayaka|Nonoa|Chisaki|Touya|Suou|Kujou|Sarashina|Kenzaki|Kimishima)$/;

function stripInlineNoise(line) {
  return String(line || '')
    .replace(/Page\s+\d+/gi, '')
    .replace(NOISE, '')
    .replace(/\s+\|\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableSourcePage(p) {
  const text = String((p && p.text) || '');
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
  return words.length >= 6 && alpha / words.length >= 0.4;
}

function isTocSourcePage(p) {
  return /^Table of contents\b/i.test(String((p && p.text) || '').trim());
}

function paragraphs(text) {
  if (SKIP_PAGE_RE.test(String(text || ''))) return [];
  const lines = String(text || '')
    .split('\n')
    .map((s) => stripInlineNoise(s))
    .filter(Boolean);
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = /^["“]/.test(ln);
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
    const clean = stripInlineNoise(b);
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

function countChars(str, re) {
  return (String(str || '').match(re) || []).length;
}

function isUnfinishedParagraph(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (!TERMINAL_END_RE.test(t)) return true;
  if (countChars(t, /\(/g) > countChars(t, /\)/g)) return true;
  if (countChars(t, /["“”]/g) % 2 !== 0) return true;
  return false;
}

function splitFirstSentenceFragment(text, opts = {}) {
  const s = String(text || '').trim();
  if (!s) return ['', ''];
  if (opts.needCloseParen) {
    const idx = s.indexOf(')');
    if (idx > -1) {
      let end = idx + 1;
      while (end < s.length && /[.!?…"”'\u2019]/.test(s[end])) end++;
      return [s.slice(0, end).trim(), s.slice(end).trim()];
    }
  }
  if (opts.needCloseQuote) {
    const m = s.match(/^[\s\S]*?["”]/);
    if (m) {
      const head = m[0].trim();
      const rest = s.slice(m[0].length).trim();
      return [head, rest];
    }
  }
  const m = s.match(/^([\s\S]*?[.!?…]+(?:["”'\u2019)\]]+)?)(?:\s+([\s\S]+))?$/);
  if (m) {
    return [m[1].trim(), (m[2] || '').trim()];
  }
  return [s, ''];
}

function joinFragments(left, right) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith('-')) return a + b;
  if (NAME_TAIL_RE.test(a) && HONORIFIC_CONT_RE.test(b)) return a + '-' + b;
  return a + ' ' + b;
}

function stitchPages(pages) {
  const perPage = new Map();
  const stitchOrder = [];

  for (const p of pages) {
    const key = String(p.page);
    if (SKIP_PAGE_RE.test(String(p.text || ''))) {
      perPage.set(key, []);
      continue;
    }
    const usable = isUsableSourcePage(p);
    const paras = usable ? paragraphs(p.text || '') : [];
    perPage.set(key, paras);
    if (usable && !isTocSourcePage(p)) {
      stitchOrder.push(key);
    }
  }

  for (let i = 0; i < stitchOrder.length - 1; i++) {
    const curKey = stitchOrder[i];
    const nextKey = stitchOrder[i + 1];
    const curParas = perPage.get(curKey);
    const nextParas = perPage.get(nextKey);
    if (!curParas || !curParas.length || !nextParas || !nextParas.length) continue;

    const lastIdx = curParas.length - 1;
    const lastPara = curParas[lastIdx];
    const nextFirst = nextParas[0];

    const needCloseParen = countChars(lastPara, /\(/g) > countChars(lastPara, /\)/g);
    const needCloseQuote = countChars(lastPara, /["“”]/g) % 2 !== 0 && !/^["“]/.test(nextFirst);
    const lacksEnd = !TERMINAL_END_RE.test(lastPara.trim());
    const nextLooksCont = /^[a-zçğıöşü,;:)\]]/.test(nextFirst) || HONORIFIC_CONT_RE.test(nextFirst);

    if (lacksEnd || needCloseParen || needCloseQuote || nextLooksCont) {
      const [head, tail] = splitFirstSentenceFragment(nextFirst, { needCloseParen, needCloseQuote });
      curParas[lastIdx] = joinFragments(lastPara, head);
      if (tail) nextParas[0] = tail;
      else nextParas.shift();
    }
  }

  return perPage;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function google(texts) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(G_URL, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Referer: 'https://translate.google.com/',
        },
        body: body.toString(),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const flat = data.map((d) => (typeof d === 'string' ? d : Array.isArray(d) ? d[0] : ''));
      if (flat.length !== texts.length) throw new Error('count ' + flat.length + '/' + texts.length);
      return flat;
    } catch (e) {
      if (a === 4) throw e;
      await sleep(1200 * (a + 1));
    }
  }
}

async function deepl(texts) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(D_URL, {
        method: 'POST',
        headers: {
          Authorization: 'DeepL-Auth-Key ' + DEEPL_KEY,
          'Content-Type': 'application/json',
          'User-Agent': UA,
        },
        body: JSON.stringify({
          text: texts,
          source_lang: 'EN',
          target_lang: 'TR',
          split_sentences: 'nonewlines',
          preserve_formatting: true,
        }),
      });
      if (r.status === 456) throw Object.assign(new Error('DeepL kotası doldu'), { fatal: true });
      if (!r.ok) throw new Error('DeepL HTTP ' + r.status);
      const data = await r.json();
      const out = data.translations.map((t) => t.text);
      if (out.length !== texts.length) throw new Error('DeepL count ' + out.length + '/' + texts.length);
      return out;
    } catch (e) {
      if (e.fatal || a === 3) throw e;
      await sleep(2000 * (a + 1));
    }
  }
}

async function runTranslate(volArg) {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vol = volArg || (vIdx > -1 && args[vIdx + 1] ? args[vIdx + 1] : '4');
  const { src: SRC, out: OUT } = resolveVolumePaths(vol);

  const pages = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  let done = {};
  if (fs.existsSync(OUT)) {
    try {
      done = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch {}
  }

  const stitchedMap = stitchPages(pages);
  const items = [];
  for (const p of pages) {
    const key = String(p.page);
    if (done[key]) continue;
    const paras = stitchedMap.get(key) || [];
    if (!paras.length) {
      done[key] = [];
      continue;
    }
    paras.forEach((t, i) => items.push({ key, i, t, n: paras.length }));
  }
  console.log('çevrilecek paragraf:', items.length, '| DeepL anahtarı:', DEEPL_KEY ? 'var' : 'yok');

  const SIZE = 20;
  const batches = [];
  for (let i = 0; i < items.length; i += SIZE) batches.push(items.slice(i, i + SIZE));

  let quotaOut = false;
  let b = 0;
  for (const batch of batches) {
    b++;
    const texts = batch.map((x) => x.t);

    let g = [];
    try {
      g = await google(texts);
    } catch {
      g = [];
      for (const t of texts) {
        try {
          g.push((await google([t]))[0] || '');
        } catch {
          g.push('');
        }
      }
    }

    let d = new Array(texts.length).fill('');
    if (!quotaOut && DEEPL_KEY) {
      try {
        d = await deepl(texts);
      } catch (e) {
        if (e.fatal || /kota/i.test(e.message)) {
          quotaOut = true;
          console.log('!! DeepL kotası doldu, kalanlar Google ile:', e.message);
        } else {
          d = new Array(texts.length).fill('');
        }
      }
    }

    batch.forEach((it, idx) => {
      const k = it.key;
      if (!Array.isArray(done[k])) done[k] = new Array(it.n).fill(null).map(() => ({ g: '', d: '' }));
      done[k][it.i] = { g: (g[idx] || '').trim(), d: (d[idx] || '').trim() };
    });

    if (b % 4 === 0 || b === batches.length) {
      fs.writeFileSync(OUT, JSON.stringify(done));
      console.log(`grup ${b}/${batches.length} — ${Object.keys(done).length}/${pages.length} sayfa`);
    }
    await sleep(200);
  }
  fs.writeFileSync(OUT, JSON.stringify(done));
  console.log('bitti');
}

if (require.main === module) {
  runTranslate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  NOISE,
  SKIP_PAGE_RE,
  resolveVolumePaths,
  stripInlineNoise,
  isUsableSourcePage,
  isTocSourcePage,
  isUnfinishedParagraph,
  splitFirstSentenceFragment,
  joinFragments,
  paragraphs,
  stitchPages,
  runTranslate,
};
