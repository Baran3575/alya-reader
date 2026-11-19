// Bölüm bazlı sayfa dikişli (chapter-stitched) çift motor çeviri boru hattı -> data<vol>/bilingual.json
// Kullanım:
//   node scripts/translate3.js                    # Cilt 4 (varsayılan)
//   node scripts/translate3.js --volume 4.5       # Cilt 4.5 (veya Faz 2..5 ciltleri: 5..12)
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');

const DEFAULT_DEEPL_KEY =
  process.env.DEEPL_KEY ||
  (fs.existsSync(path.join(ROOT, '.deepl-key')) ? fs.readFileSync(path.join(ROOT, '.deepl-key'), 'utf8').trim() : '');
const G_URL = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const D_URL = 'https://api-free.deepl.com/v2/translate';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const NOISE = /(Goldenagato|mp4directs|jnovels|zerobooks|Download all your Favorite|Stay up to date On Light Novels)/i;
const CHAPTER_HEADING_RE = /^(Prologue|Epilogue|Afterword|Interlude|Chapter\s+(\d+))\s*[:–—-]/i;

function isUsablePage(text) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
  return words.length >= 6 && alpha / words.length >= 0.4;
}

function detectChapterHeading(rawTextOrFirstPara) {
  const firstLine =
    String(rawTextOrFirstPara || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !NOISE.test(s))[0] || '';
  return CHAPTER_HEADING_RE.test(firstLine.replace(/\s+/g, ' '));
}

function paragraphs(text) {
  const rawLines = String(text || '').split('\n');
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?…"”’]$/;
  for (const rawLn of rawLines) {
    const ln = rawLn.trim();
    if (!ln) {
      if (cur.length && endPunct.test(cur[cur.length - 1])) {
        blocks.push(cur.join(' '));
        cur = [];
      }
      continue;
    }
    if (NOISE.test(ln)) continue;
    if (CHAPTER_HEADING_RE.test(ln)) {
      if (cur.length) {
        blocks.push(cur.join(' '));
        cur = [];
      }
      blocks.push(ln);
      continue;
    }
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = ln.startsWith('"') || ln.startsWith('“');
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
    const sents = clean.split(/(?<=[.!?]["”’]?)\s+(?=[A-Z"“‘(\[『「])/g);
    if (sents.length <= 1) {
      out.push(clean);
      continue;
    }
    let buf = '';
    for (const s of sents) {
      const sep = buf ? ' ' : '';
      if ((buf + sep + s).length > 480 && buf) {
        out.push(buf.trim());
        buf = s;
      } else {
        buf += sep + s;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

function countDoubleQuotes(s) {
  return (String(s || '').match(/["“”]/g) || []).length;
}

function hasUnclosedQuote(s) {
  const opens = (String(s || '').match(/“/g) || []).length;
  const closes = (String(s || '').match(/”/g) || []).length;
  const straight = (String(s || '').match(/"/g) || []).length;
  if (opens !== closes && straight === 0) return opens > closes;
  return (opens + closes + straight) % 2 !== 0;
}

function hasUnclosedParen(last, first) {
  const o1 = (last.match(/\(/g) || []).length;
  const c1 = (last.match(/\)/g) || []).length;
  const o2 = (first.match(/\(/g) || []).length;
  const c2 = (first.match(/\)/g) || []).length;
  return o1 > c1 && c2 > o2;
}

function shouldStitchAcrossPages(last, first) {
  if (!last || !first) return false;
  if (CHAPTER_HEADING_RE.test(first)) return false;
  if (hasUnclosedParen(last, first)) return true;
  if (hasUnclosedQuote(last)) return true;
  const trimmedLast = last.trim();
  const trimmedFirst = first.trim();
  if (!/[.!?…"”’)\]}~]$/.test(trimmedLast)) return true;
  if (/^["“”'‘’)\]]*[a-z]/.test(trimmedFirst)) return true;
  return false;
}

function joinCrossPageParagraphs(last, first) {
  let a = last.trim();
  let b = first.trim();
  // Sayfa başında tekrarlanan açılış tırnağı tek konuşmayı bölüyorsa fazladan açılış tırnağını düşür
  if (hasUnclosedQuote(a) && /^["“]/.test(b) && countDoubleQuotes(a + ' ' + b) % 2 !== 0) {
    b = b.slice(1).trimStart();
  }
  // Satır sonu tirelemesi (örn. "under-" + "stand")
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) {
    return a.slice(0, -1) + b;
  }
  return (a + ' ' + b).replace(/\s+/g, ' ').trim();
}

// Bölüm sınırlarını gözeterek sayfa geçişlerindeki yarım cümle ve tırnakları
// çeviri öncesinde birleştirir; tüm sayısal sayfa anahtarlarını korur.
function stitchChapterPages(pages) {
  const entries = pages.map((p) => {
    const key = String(p.page);
    const raw = String(p.text || '');
    const usable = isUsablePage(raw);
    const paras = usable ? paragraphs(raw) : [];
    const isChapterStart = usable && detectChapterHeading(raw);
    return { key, page: p.page, usable: usable && paras.length > 0, isChapterStart, paras };
  });

  let prevUsable = null;
  for (const curr of entries) {
    if (!curr.usable) continue;
    if (curr.isChapterStart) {
      prevUsable = curr;
      continue;
    }
    if (prevUsable && prevUsable.paras.length > 0 && curr.paras.length > 0) {
      const lastIdx = prevUsable.paras.length - 1;
      const last = prevUsable.paras[lastIdx];
      const first = curr.paras[0];
      if (shouldStitchAcrossPages(last, first)) {
        prevUsable.paras[lastIdx] = joinCrossPageParagraphs(last, first);
        curr.paras.shift();
      }
    }
    if (curr.paras.length > 0) {
      prevUsable = curr;
    }
  }

  const pageMap = {};
  for (const e of entries) {
    pageMap[e.key] = e.paras;
  }
  return pageMap;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function google(texts, fetchImpl = fetch, sleepMs = 1200) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetchImpl(G_URL, {
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
      await sleep(sleepMs * (a + 1));
    }
  }
}

async function deepl(texts, deeplKey = DEFAULT_DEEPL_KEY, fetchImpl = fetch, sleepMs = 2000) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetchImpl(D_URL, {
        method: 'POST',
        headers: {
          Authorization: 'DeepL-Auth-Key ' + deeplKey,
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
      if (r.status === 456) {
        throw Object.assign(new Error('DeepL kotası doldu (HTTP 456)'), { fatal: true, status: 456 });
      }
      if (!r.ok) throw new Error('DeepL HTTP ' + r.status);
      const data = await r.json();
      const out = data.translations.map((t) => t.text);
      if (out.length !== texts.length) throw new Error('DeepL count ' + out.length + '/' + texts.length);
      return out;
    } catch (e) {
      if (e.fatal || e.status === 456 || a === 3) throw e;
      await sleep(sleepMs * (a + 1));
    }
  }
}

async function runTranslate(options = {}) {
  const volKey = options.volume || '4';
  const volCfg = resolveVolume(volKey);
  if (!volCfg && !options.srcFile) {
    throw new Error(`Bilinmeyen cilt: ${volKey}`);
  }
  const srcFile = options.srcFile || volCfg.sourceFile;
  const outFile = options.outFile || volCfg.bilingualFile;
  const deeplKey = options.deeplKey !== undefined ? options.deeplKey : DEFAULT_DEEPL_KEY;
  const fetchImpl = options.fetchImpl || fetch;
  const batchDelayMs = options.batchDelayMs !== undefined ? options.batchDelayMs : 200;
  const retryDelayMs = options.retryDelayMs !== undefined ? options.retryDelayMs : 1200;

  const pages = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  let done = {};
  if (fs.existsSync(outFile)) {
    try {
      done = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    } catch {}
  }

  const stitchedByPage = stitchChapterPages(pages);
  const items = [];
  for (const p of pages) {
    const key = String(p.page);
    if (done[key]) continue;
    const paras = stitchedByPage[key] || [];
    if (!paras.length) {
      done[key] = [];
      continue;
    }
    paras.forEach((t, i) => items.push({ key, i, t, n: paras.length }));
  }

  if (!options.silent) {
    console.log(
      `[Cilt ${volKey}] çevrilecek paragraf:`,
      items.length,
      '| DeepL anahtarı:',
      deeplKey ? 'var' : 'yok'
    );
  }

  const SIZE = options.batchSize || 20;
  const batches = [];
  for (let i = 0; i < items.length; i += SIZE) batches.push(items.slice(i, i + SIZE));

  let b = 0;
  for (const batch of batches) {
    b++;
    const texts = batch.map((x) => x.t);

    let d = new Array(texts.length).fill('');
    if (deeplKey) {
      try {
        d = await deepl(texts, deeplKey, fetchImpl, retryDelayMs);
      } catch (e) {
        if (e.fatal || e.status === 456 || /kota/i.test(e.message)) {
          // Kota dolduğunda ham Google yedeğine sessizce düşmek yerine tamamlananları kaydedip dur!
          fs.writeFileSync(outFile, JSON.stringify(done));
          throw e;
        }
        d = new Array(texts.length).fill('');
      }
    }

    let g = [];
    try {
      g = await google(texts, fetchImpl, retryDelayMs);
    } catch {
      g = [];
      for (const t of texts) {
        try {
          g.push((await google([t], fetchImpl, retryDelayMs))[0] || '');
        } catch {
          g.push('');
        }
      }
    }

    batch.forEach((it, idx) => {
      const k = it.key;
      if (!Array.isArray(done[k])) done[k] = new Array(it.n).fill(null).map(() => ({ g: '', d: '' }));
      done[k][it.i] = { g: (g[idx] || '').trim(), d: (d[idx] || '').trim() };
    });

    if (b % 4 === 0 || b === batches.length) {
      fs.writeFileSync(outFile, JSON.stringify(done));
      if (!options.silent) {
        console.log(`grup ${b}/${batches.length} — ${Object.keys(done).length}/${pages.length} sayfa`);
      }
    }
    if (batchDelayMs > 0) await sleep(batchDelayMs);
  }

  fs.writeFileSync(outFile, JSON.stringify(done));
  if (!options.silent) console.log('bitti');
  return done;
}

if (require.main === module) {
  const volume = parseVolumeArg(process.argv.slice(2), '4');
  if (!resolveVolume(volume)) {
    console.error(`Bilinmeyen cilt: ${volume}`);
    process.exit(1);
  }
  runTranslate({ volume }).catch((err) => {
    console.error('Çeviri durduruldu:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  NOISE,
  CHAPTER_HEADING_RE,
  isUsablePage,
  detectChapterHeading,
  paragraphs,
  hasUnclosedQuote,
  shouldStitchAcrossPages,
  joinCrossPageParagraphs,
  stitchChapterPages,
  deepl,
  google,
  runTranslate,
};
