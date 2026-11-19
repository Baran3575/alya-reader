// FlipHTML5 çok ciltli içe aktarma adaptörü (Cilt 5–10).
// - fliphtml5.com bağlantılarını HTTP 403 hatasını önlemek için online.fliphtml5.com'a normalize eder.
// - files/search/search_config.js (sayfa metinleri) ve javascript/config.js (WASM _DeString ile sayfa görselleri) ayrıştırır.
// - data<vol>/source.json üretir ve kapak/illüstrasyon WebP dosyalarını public/art/v<vol>/ altına indirir.
// Kullanım:
//   node scripts/ingest/fliphtml5.js --volume 5 [--url https://online.fliphtml5.com/hlsms/zusi/]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

const FLIPHTML5_SOURCES = {
  '5': { url: 'https://online.fliphtml5.com/hlsms/zusi/', dataDir: 'data5', artDir: 'public/art/v5' },
  '6': { url: 'https://online.fliphtml5.com/hlsms/mfba/', dataDir: 'data6', artDir: 'public/art/v6' },
  '7': { url: 'https://online.fliphtml5.com/utpiy/ekus/', dataDir: 'data7', artDir: 'public/art/v7' },
  '8': { url: 'https://online.fliphtml5.com/utpiy/tlew/', dataDir: 'data8', artDir: 'public/art/v8' },
  '9': { url: 'https://online.fliphtml5.com/utpiy/ctbm/', dataDir: 'data9', artDir: 'public/art/v9' },
  '10': { url: 'https://online.fliphtml5.com/dzxyw/fhfj/', dataDir: 'data10', artDir: 'public/art/v10' },
};

const DESTRING_URL = 'https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function normalizeFlipHtml5Url(rawUrl) {
  const u = new URL(String(rawUrl).trim());
  if (u.hostname === 'fliphtml5.com' || u.hostname === 'www.fliphtml5.com') {
    u.hostname = 'online.fliphtml5.com';
  }
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length >= 2) {
    u.pathname = `/${segs[0]}/${segs[1]}/`;
  } else if (!u.pathname.endsWith('/')) {
    u.pathname += '/';
  }
  u.search = '';
  u.hash = '';
  return u.toString();
}

let cachedDecoder = null;
async function getFlipDecoder() {
  if (cachedDecoder) return cachedDecoder;
  const res = await fetch(DESTRING_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('deString.js indirilemedi: HTTP ' + res.status);
  const deStrCode = await res.text();
  const fn = new Function(
    'window',
    'require',
    '__dirname',
    '__filename',
    deStrCode + '\nreturn { Module, stringToUTF8, UTF8ToString, lengthBytesUTF8 };'
  );
  const mod = fn({}, require, __dirname, __filename);
  await new Promise((r) => setTimeout(r, 250));
  cachedDecoder = function decodeFlipPages(encoded) {
    if (Array.isArray(encoded)) return encoded;
    const raw = String(encoded || '');
    const len = mod.lengthBytesUTF8(raw) + 1;
    const ptr = mod.Module._malloc(len);
    mod.stringToUTF8(raw, ptr, len);
    const outPtr = mod.Module._DeString(ptr);
    const decoded = mod.UTF8ToString(outPtr);
    mod.Module._free(ptr);
    const endIdx = decoded.lastIndexOf(']');
    const jsonSlice = endIdx > -1 ? decoded.slice(0, endIdx + 1) : decoded;
    return JSON.parse(jsonSlice);
  };
  return cachedDecoder;
}

function parseSearchConfig(jsText) {
  const m = String(jsText).match(/textForPages\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!m) throw new Error('search_config.js içinde textForPages dizisi bulunamadı');
  return JSON.parse(m[1]);
}

function isCandidateArtPage(pageNum, rawText, totalPages) {
  if (pageNum === 1) return true; // Kapak her zaman alınır
  const t = String(rawText || '');
  if (/(Fan[- ]translated by Glucose Translations|Fan Translator[’']?s Note|NOT FOR RESALE)/i.test(t)) {
    return false;
  }
  if (/^\s*(?:TN\s*:|\[\d+\]\s*:)/i.test(t.trim()) && t.trim().length > 25) {
    return false;
  }
  const cleanLen = t
    .replace(/Page\s+\d+/gi, '')
    .replace(/Goldenagato.*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim().length;
  if (pageNum <= 18 && cleanLen < 120) return true;
  if (pageNum > 3 && pageNum < totalPages && cleanLen < 220) {
    // Tek satırlık yalın başlık veya dipnot sayfası değilse aday görseldir
    const trimmed = t.replace(/\s+/g, ' ').trim();
    if (/^(?:\[\d+\]|TN:|P\.\s*S\.)/i.test(trimmed)) return false;
    return true;
  }
  return false;
}

function optimizeAndFilterWebp(inputBuf, outPath) {
  const tmpIn = outPath + '.raw.webp';
  fs.writeFileSync(tmpIn, inputBuf);
  try {
    const verdict = execFileSync(
      'python3',
      [
        '-c',
        `
import sys
from PIL import Image, ImageStat
im = Image.open(sys.argv[1])
gray = im.convert('L')
st = ImageStat.Stat(gray)
# Düz beyaz/siyah boş ayırıcı sayfaları ele (stddev < 6)
if st.stddev[0] < 6.0:
    print('BLANK')
    sys.exit(0)
rgb = im.convert('RGB')
w, h = rgb.size
max_dim = 1350
if max(w, h) > max_dim:
    scale = max_dim / float(max(w, h))
    rgb = rgb.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
rgb.save(sys.argv[2], 'WEBP', quality=78, method=6)
print('OK')
`,
        tmpIn,
        outPath,
      ],
      { encoding: 'utf8' }
    ).trim();
    return verdict === 'OK';
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
  }
}

async function ingestFlipHtml5Volume(vol, customUrl) {
  const cfg = FLIPHTML5_SOURCES[vol];
  if (!cfg && !customUrl) throw new Error(`Bilinmeyen FlipHTML5 cildi: ${vol}`);
  const baseUrl = normalizeFlipHtml5Url(customUrl || cfg.url);
  const dataDir = path.join(ROOT, cfg ? cfg.dataDir : `data${vol}`);
  const artDir = path.join(ROOT, cfg ? cfg.artDir : `public/art/v${vol}`);

  console.log(`\n[FlipHTML5] Cilt ${vol} indiriliyor: ${baseUrl}`);

  const [searchRes, configRes, decodeFlipPages] = await Promise.all([
    fetch(baseUrl + 'files/search/search_config.js', { headers: { 'User-Agent': UA } }),
    fetch(baseUrl + 'javascript/config.js', { headers: { 'User-Agent': UA } }),
    getFlipDecoder(),
  ]);

  if (!searchRes.ok) throw new Error(`search_config.js HTTP ${searchRes.status}`);
  if (!configRes.ok) throw new Error(`config.js HTTP ${configRes.status}`);

  const texts = parseSearchConfig(await searchRes.text());
  const configJs = await configRes.text();
  const win = {};
  new Function('window', configJs + '\nwindow.__hc = typeof htmlConfig !== "undefined" ? htmlConfig : window.htmlConfig;')(win);
  const hc = win.__hc || win.htmlConfig || {};
  const rawPages = decodeFlipPages(hc.fliphtml5_pages || []);

  const total = Math.max(texts.length, rawPages.length);
  const source = [];
  for (let i = 0; i < total; i++) {
    const pgObj = rawPages[i] || {};
    const nArr = Array.isArray(pgObj.n) ? pgObj.n : [];
    const imgName = String(nArr[0] || '').replace(/^\.?\/?files\/large\//, '');
    const thumbName = String(pgObj.t || '').replace(/^\.?\/?files\/thumb\//, '');
    const rawText = String(texts[i] || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    source.push({
      page: i + 1,
      img: imgName,
      thumb: thumbName,
      text: rawText,
    });
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(artDir, { recursive: true });
  const sourceFile = path.join(dataDir, 'source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(source, null, 2) + '\n');
  console.log(`  ✓ ${path.relative(ROOT, sourceFile)} yazıldı (${source.length} sayfa)`);

  // İllüstrasyon adaylarını indir ve boş ayırıcı sayfaları ele
  const candidates = source.filter((p) => p.img && isCandidateArtPage(p.page, p.text, source.length));
  let savedArt = 0;
  let skippedBlank = 0;

  for (const p of candidates) {
    const outFile = path.join(artDir, `${String(p.page).padStart(3, '0')}.webp`);
    const imgUrl = `${baseUrl}files/large/${p.img}`;
    const r = await fetch(imgUrl, { headers: { 'User-Agent': UA, Referer: baseUrl } });
    if (!r.ok) {
      console.warn(`  ! Görsel indirilemedi (s.${p.page}): HTTP ${r.status}`);
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const kept = optimizeAndFilterWebp(buf, outFile);
    if (kept) savedArt++;
    else skippedBlank++;
  }

  console.log(`  ✓ ${savedArt} illüstrasyon kaydedildi (${skippedBlank} boş ayırıcı sayfa elendi) -> ${path.relative(ROOT, artDir)}`);
  return { total: source.length, savedArt, skippedBlank, baseUrl };
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
    const uIdx = args.indexOf('--url');
    const customUrl = uIdx > -1 ? args[uIdx + 1] : undefined;
    const vols = vIdx > -1 && args[vIdx + 1] ? args[vIdx + 1].split(',') : Object.keys(FLIPHTML5_SOURCES);
    for (const v of vols) {
      await ingestFlipHtml5Volume(v.trim(), customUrl);
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  FLIPHTML5_SOURCES,
  normalizeFlipHtml5Url,
  ingestFlipHtml5Volume,
};
