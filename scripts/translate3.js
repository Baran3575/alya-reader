// Google Translate + DeepL ile paragraf paragraf çift çeviri -> data<vol>/bilingual.json
// Kullanım:
//   node scripts/translate3.js [--volume <4|4.5|5|...|12>] [--dir <dataDir>] [--concurrency 4]
const fs = require('fs');
const path = require('path');
const { resolveVolumeDir } = require('./volumes');

const ROOT = path.join(__dirname, '..');

function parseCli() {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const dIdx = args.indexOf('--dir');
  const cIdx = args.indexOf('--concurrency');
  const dataDir = dIdx > -1 && args[dIdx + 1]
    ? args[dIdx + 1]
    : resolveVolumeDir(vIdx > -1 ? args[vIdx + 1] : '4');
  const concurrency = cIdx > -1 && Number(args[cIdx + 1]) > 0 ? Number(args[cIdx + 1]) : 4;
  const force = args.includes('--force');
  return { dataDir, concurrency, force };
}

const DEEPL_KEY =
  process.env.DEEPL_KEY ||
  (fs.existsSync(path.join(ROOT, '.deepl-key'))
    ? fs.readFileSync(path.join(ROOT, '.deepl-key'), 'utf8').trim()
    : '');
const G_URL = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const D_URL = 'https://api-free.deepl.com/v2/translate';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const NOISE_LINE =
  /(Goldenagato|mp4directs|jnovels|zerobooks|Download all your Favorite|Stay up to date On Light Novels|Fan[- ]translated by Glucose Translations|NOT FOR RESALE|^Glucose Translations\s*\d*$|^Fan Translator[’']?s Note\s*$|^Feel free to check the other series we fan translate)/i;

const FOOTNOTE_LINE =
  /^(?:\[\d+\]\s*:?|TN\s*:|TL\s*note\s*:|Translator[’']?s?\s*Note\s*:|Illustration\s+translates\s+to\b)/i;

function stripInlineNotes(str) {
  return String(str || '')
    .replace(/\[\d+\]/g, '')
    .replace(/\((?:TN|TL|ÇN|TL\s*note|Translator[’']?s?\s*note)\s*:[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongBlock(clean) {
  if (!clean) return [];
  if (clean.length <= 440) return [clean];
  const sents = clean.match(/[^.!?]+[.!?]+["”’)]?|\S[^.!?]*$/g) || [clean];
  const out = [];
  let buf = '';
  for (const s of sents) {
    if ((buf + s).length > 400 && buf.trim()) {
      out.push(buf.trim());
      buf = '';
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function paragraphs(text, isChapterNative = false) {
  if (!text) return [];
  if (isChapterNative) {
    const rawParas = String(text)
      .split(/\n+/)
      .map((s) => stripInlineNotes(s))
      .filter((s) => s && !NOISE_LINE.test(s) && !FOOTNOTE_LINE.test(s));
    const out = [];
    for (const p of rawParas) {
      out.push(...splitLongBlock(p));
    }
    return out;
  }

  const lines = String(text)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !NOISE_LINE.test(s) && !FOOTNOTE_LINE.test(s));

  // İçindekiler sayfası kontrolü (çoklu bölüm satırları içeriyorsa satır bazlı koru)
  const tocHits = lines.filter((ln) => /^(?:Prologue|Epilogue|Chapter\s+\d+)\b/i.test(ln)).length;
  if (tocHits >= 3) {
    return lines.map(stripInlineNotes).filter(Boolean);
  }

  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’…~)\]]$/;
  const headingLine =
    /^(?:Prologue|Epilogue|Chapter\s+\d+|Afterword(?:\s+SS)?|Author[’']?s\s+(?:Note|Afterword)|Side\s+Story|Short\s+Story|Bookwalker(?:\s+Exclusive\s+Bonus|\s+SS)?|Anecdote|Interlude)\b/i;

  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev) || headingLine.test(prev);
      const newDialogue = /^[“"‘'«(]/.test(ln);
      const shortPrev = prev.length < 52 && prevEnds;
      if (headingLine.test(cur[0]) && cur.length === 1 && (prevEnds || newDialogue || /^[A-Z“"]/.test(ln))) {
        blocks.push(cur.join(' '));
        cur = [];
      } else if (prevEnds && (newDialogue || shortPrev)) {
        blocks.push(cur.join(' '));
        cur = [];
      }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));

  const out = [];
  for (const b of blocks) {
    const clean = stripInlineNotes(b.replace(/Page\s+\d+/gi, '').replace(NOISE_LINE, ''));
    if (!clean || FOOTNOTE_LINE.test(clean)) continue;
    out.push(...splitLongBlock(clean));
  }
  return out;
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
      await sleep(900 * (a + 1));
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
      await sleep(1500 * (a + 1));
    }
  }
}

async function translateVolume({ dataDir, concurrency = 4, force = false }) {
  const srcFile = path.join(ROOT, dataDir, 'source.json');
  const outFile = path.join(ROOT, dataDir, 'bilingual.json');
  const pages = JSON.parse(fs.readFileSync(srcFile, 'utf8'));

  let done = {};
  if (!force && fs.existsSync(outFile)) {
    try {
      done = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    } catch {}
  }

  const items = [];
  for (const p of pages) {
    const key = String(p.page);
    if (done[key] && Array.isArray(done[key])) continue;
    const paras = paragraphs(p.text || '', Boolean(p.chapterNative));
    if (!paras.length) {
      done[key] = [];
      continue;
    }
    paras.forEach((t, i) => items.push({ key, i, t, n: paras.length }));
  }

  console.log(
    `[${dataDir}] çevrilecek paragraf: ${items.length} | sayfa: ${pages.length} | DeepL: ${DEEPL_KEY ? 'var' : 'yok'}`
  );
  if (!items.length) {
    fs.writeFileSync(outFile, JSON.stringify(done));
    return outFile;
  }

  const SIZE = 22;
  const batches = [];
  for (let i = 0; i < items.length; i += SIZE) batches.push(items.slice(i, i + SIZE));

  let quotaOut = false;
  let completed = 0;

  async function processBatch(batch) {
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
        }
      }
    }

    batch.forEach((it, idx) => {
      const k = it.key;
      if (!Array.isArray(done[k]) || done[k].length !== it.n) {
        done[k] = new Array(it.n).fill(null).map(() => ({ g: '', d: '' }));
      }
      done[k][it.i] = { g: (g[idx] || '').trim(), d: (d[idx] || '').trim() };
    });

    completed++;
    if (completed % 12 === 0 || completed === batches.length) {
      fs.writeFileSync(outFile, JSON.stringify(done));
      console.log(`  [${dataDir}] grup ${completed}/${batches.length} (${Object.keys(done).length}/${pages.length} birim)`);
    }
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    await Promise.all(slice.map((b) => processBatch(b)));
    await sleep(120);
  }

  fs.writeFileSync(outFile, JSON.stringify(done));
  console.log(`✓ [${dataDir}] çeviri tamamlandı -> ${path.relative(ROOT, outFile)}`);
  return outFile;
}

if (require.main === module) {
  translateVolume(parseCli()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { paragraphs, google, translateVolume };
