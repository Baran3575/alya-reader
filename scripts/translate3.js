// Bölüm bazlı sayfa dikişli (chapter-stitched) çift motor çeviri boru hattı -> data<vol>/bilingual.json
// Kullanım:
//   node scripts/translate3.js                    # Cilt 4 (varsayılan)
//   node scripts/translate3.js --volume 4.5       # Cilt 4.5 (veya Faz 2..5 ciltleri: 5..12)
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');
const {
  NOISE,
  CHAPTER_HEADING_RE,
  isUsablePage,
  detectChapterHeading,
  paragraphs,
  hasUnclosedQuote,
  shouldStitchAcrossPages,
  joinCrossPageParagraphs,
  stitchChapterPages,
} = require('./ingest/lib/paginate');

const DEFAULT_DEEPL_KEY =
  process.env.DEEPL_KEY ||
  (fs.existsSync(path.join(ROOT, '.deepl-key')) ? fs.readFileSync(path.join(ROOT, '.deepl-key'), 'utf8').trim() : '');
const G_URL = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr';
const D_URL = 'https://api-free.deepl.com/v2/translate';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

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
