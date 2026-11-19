// Google Translate + DeepL ile paragraf paragraf çift çeviri -> data<vol>/bilingual.json
// Kullanım: node scripts/translate3.js [--volume <v>]
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');
const {
  TERMINAL_END_RE,
  HONORIFIC_CONT_RE,
  NAME_TAIL_RE,
  isUnfinishedParagraph,
  splitFirstSentenceFragment,
  joinFragments,
  stitchPageParagraphMap,
} = require('./ingest/lib/paginate');

function resolveVolumePaths(vol = '4') {
  const v = String(vol || '4').trim();
  const reg = resolveVolume(v);
  if (reg) {
    return {
      vol: reg.key,
      dir: reg.dataDir,
      src: reg.sourceFile,
      out: reg.bilingualFile,
      fin: reg.finalFile,
    };
  }
  const dir = v === '4' ? 'data' : 'data' + v.replace(/\./g, '');
  return {
    vol: v,
    dir,
    src: path.join(ROOT, dir, 'source.json'),
    out: path.join(ROOT, dir, 'bilingual.json'),
    fin: path.join(ROOT, dir, 'paragraphs_final.json'),
  };
}

const DEEPL_KEY_PATH = path.join(ROOT, '.deepl-key');
const DEEPL_KEY =
  process.env.DEEPL_KEY || (fs.existsSync(DEEPL_KEY_PATH) ? fs.readFileSync(DEEPL_KEY_PATH, 'utf8').trim() : '');
const G_URL = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const D_URL = 'https://api-free.deepl.com/v2/translate';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const NOISE =
  /(?:https?:\s*\/\/\S*(?:glucosetl|novelupdates|lightnovelreader|mp4directs|jnovels|zerobooks)\S*|Goldenagato\s*\|\s*mp4directs\.com|Goldenagato|mp4directs(?:\.com)?|jnovels(?:\.com)?|zerobooks(?:\s+(?:Universal|USA\s+ONLY|IOS))?|glucosetl(?:\.(?:wordpress\.com|xyz))?|discord\.gg\/\S+|novelupdates(?:\.com\S*)?|lightnovelreader(?:\.me\S*)?|Download all your Favorite(?: Light Novels)?|Stay up to date On Light Novels[^\n]*|Join our Discord and meet Thousands[^\n]*)/gi;

const SKIP_PAGE_RE =
  /(discord\.gg|glucosetl|novelupdates|lightnovelreader|TLed and Edited\s*by|fan translators? and editors?|Volume\s+\d+(?:\.\d+)?,?\s+Fan\s+Translation|Do not reupload our chapters behind ad-link shorteners|Join our Discord|Download all your Favorite Light Novels|Stay up to date On Light Novels)/i;

function stripInlineNoise(line) {
  return String(line || '')
    .replace(/Page\s+\d+/gi, '')
    .replace(NOISE, '')
    .replace(/\s+\|\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableSourcePage(p) {
  if (p && p.pending) return false;
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

function stitchPages(pages) {
  const perPage = new Map();
  const stitchOrder = [];

  for (const p of pages) {
    const key = String(p.page);
    if ((p && p.pending) || SKIP_PAGE_RE.test(String(p.text || ''))) {
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

  return stitchPageParagraphMap(perPage, stitchOrder);
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
  const vol = volArg || parseVolumeArg(process.argv.slice(2), '4');
  const volCfg = resolveVolume(vol);
  if (!volCfg) {
    console.error(`Bilinmeyen cilt: ${vol}`);
    process.exit(1);
  }
  const { src: SRC, out: OUT } = resolveVolumePaths(volCfg.key);

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
  console.log(`Cilt ${volCfg.key} | çevrilecek paragraf: ${items.length} | DeepL anahtarı: ${DEEPL_KEY ? 'var' : 'yok'}`);

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
