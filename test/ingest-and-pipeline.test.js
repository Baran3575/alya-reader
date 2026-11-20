// Kapsamlı İçe Aktarma, Çeviri Hattı, Sunucu ve Cilt 4–12 Bütünlük Testleri
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { VOLUME_KEYS, VOLUMES, resolveVolume, parseVolumeArg } = require('../scripts/lib/volumes');
const {
  isSkippedSourceUrl,
  normalizeFlipBookUrl,
  parseSearchConfigJs,
  alignMidIllustrationsToBody,
} = require('../scripts/ingest/adapters/fliphtml5');
const { solveAnubisHash, parseAnubisChallenge } = require('../scripts/ingest/lib/anubis');
const { isTranslationInProgress, parseChapterHeadingMeta } = require('../scripts/ingest/adapters/secreftls12');
const { cleanOcrText } = require('../scripts/ingest/adapters/glucosetl95');
const { polish, balanceCurlyQuotes } = require('../scripts/merge');
const { notes, naturalize } = require('../scripts/naturalize');
const { normalizeWhisperBraces, refineLiteraryTurkish } = require('../scripts/translate_llm');
const { buildBook } = require('../server');

function testVolumeRegistry() {
  console.log('1. Testing shared volume registry (4 through 12)...');
  assert.deepStrictEqual(
    VOLUME_KEYS,
    ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'],
    'All 11 volumes must be registered in canonical order'
  );
  assert.strictEqual(resolveVolume('9.5').dataDir, 'data95');
  assert.strictEqual(resolveVolume('9.5').imgPrefix, '/pages95/');
  assert.strictEqual(parseVolumeArg(['--volume', '11']), '11');
  assert.strictEqual(parseVolumeArg(['--vol=9.5']), '9.5');
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts45')), 'scripts45/ directory must be retired');
  console.log('   ✓ Shared volume registry and scripts45 retirement verified');
}

function testFlipHtml5UrlRules() {
  console.log('2. Testing FlipHTML5/AnyFlip URL normalization & skip guards...');
  assert.strictEqual(
    isSkippedSourceUrl('https://www.scribd.com/document/722853252/Alya-Sometimes-Hides-Her-Feelings-in-Russian-Vol-5'),
    true,
    'Fastly-challenged Scribd URL must be skipped'
  );
  assert.strictEqual(
    isSkippedSourceUrl('https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js'),
    true,
    'WASM-encrypted deString.js must be skipped'
  );
  assert.strictEqual(
    normalizeFlipBookUrl('https://fliphtml5.com/utpiy/tlew/Alya_Sometimes_Hides_Her_Feelings_in_Russian%2C_Vol_8/'),
    'https://online.fliphtml5.com/utpiy/tlew/files/search/search_config.js',
    'Vol 8 catalog URL must normalize to online.fliphtml5.com search_config.js'
  );
  assert.strictEqual(
    normalizeFlipBookUrl('https://anyflip.com/bryaq/rmsk/'),
    'https://online.anyflip.com/bryaq/rmsk/files/search/search_config.js',
    'AnyFlip URL must normalize to online.anyflip.com search_config.js'
  );

  const samplePages = parseSearchConfigJs('var textForPages = ["Page 1 &quot;Hello&quot;", "Chapter 1: Test"];');
  assert.deepStrictEqual(samplePages, ['Page 1 "Hello"', 'Chapter 1: Test']);
  console.log('   ✓ FlipHTML5/AnyFlip normalizer and skip guards verified');
}

function testAnubisSolverAndOcrCleanup() {
  console.log('3. Testing Anubis SHA-256 PoW solver and OCR text cleanup...');
  const sampleHtml = '<script id="anubis_challenge" type="application/json">{"rules":{"difficulty":3},"challenge":{"id":"abc","randomData":"deadbeef"}}</script>';
  const parsed = parseAnubisChallenge(sampleHtml);
  assert.strictEqual(parsed.challenge.id, 'abc');
  const solved = solveAnubisHash('deadbeef', 3);
  assert.ok(solved.hash.startsWith('000'), 'PoW hash must meet difficulty prefix');

  const cleaned = cleanOcrText('“Right...2”\n\n“No, | don’t think | am wrong.”\n\n14');
  assert.strictEqual(cleaned[0], '“Right…?”');
  assert.strictEqual(cleaned[1], '“No, I don’t think I am wrong.”');
  assert.strictEqual(cleaned.length, 2, 'Standalone page numbers must be stripped');
  console.log('   ✓ Anubis PoW solver and OCR cleanup verified');
}

function testPostProcessorsAndTranslatorHelpers() {
  console.log('4. Testing post-processing fixes (merge, naturalize, fix_headings, whispers)...');
  const polished = polish('"Sweet..." it\'s Alya\'s whisper...');
  assert.strictEqual(polished, '“Sweet…” it’s Alya’s whisper…');
  assert.ok(!/["']/.test(polished), 'polish() must emit zero straight quotes');

  const balanced = balanceCurlyQuotes('“Unclosed quote example');
  assert.strictEqual((balanced.match(/“/g) || []).length, (balanced.match(/”/g) || []).length);

  const strippedNotes = notes('Masachika iç çekti (TN: Japanese pun here) ve yürüdü (ÇN: kelime oyunu).');
  assert.strictEqual(strippedNotes, 'Masachika iç çekti ve yürüdü.');
  assert.ok(!/TN:|ÇN:/i.test(naturalize('Test (TN: note) cümlesi (ÇN: not).')));

  assert.strictEqual(normalizeWhisperBraces('【Milashka...】 (TN: cute)'), '{Milashka...}');
  const refined = refineLiteraryTurkish('"Bir şekilde söz konusu plan and this!" (TN: test)', {});
  assert.ok(!/["']/.test(refined));
  assert.ok(!/bir şekilde|söz konusu|TN:|ÇN:/i.test(refined));

  // fix_headings.js .deepl-key olmadan çıkış kodu 0 ile çalışmalı
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'fix_headings.js'), '--volume', '5', '--dry'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.ok(out.includes('fix_headings tamamlandı'));
  console.log('   ✓ Post-processor rules and optional .deepl-key verified');
}

function testSecreftlsPendingHandling() {
  console.log('5. Testing SecreFTLs [Translation In Progress] pending state (Vol 12)...');
  assert.strictEqual(isTranslationInProgress('<p>[Translation In Progress]</p>'), true);
  assert.strictEqual(isTranslationInProgress('<p>Normal translated chapter text.</p>'.repeat(20)), false);
  const head = parseChapterHeadingMeta('Chapter 2 - Christmas Eve with Everyone');
  assert.strictEqual(head.label, 'Bölüm 2');

  const v12Chapters = JSON.parse(fs.readFileSync(VOLUMES['12'].titlesFile, 'utf8'));
  const ch2 = v12Chapters.chapters.find((c) => /Bölüm 2/.test(c.label));
  assert.ok(ch2, 'Volume 12 must include Chapter 2 metadata');
  assert.strictEqual(ch2.pending, true, 'Volume 12 Chapter 2 must be marked pending: true');

  const v12Final = JSON.parse(fs.readFileSync(VOLUMES['12'].finalFile, 'utf8'));
  assert.deepStrictEqual(
    v12Final[String(ch2.startPage)],
    [],
    'Pending chapter must have zero invented Turkish story paragraphs'
  );
  console.log('   ✓ Volume 12 Chapter 2 pending state and zero-invention invariant verified');
}

function testAllVolumesCanonicalArtifactsAndServer() {
  console.log('6. Verifying canonical files, illustrations, and server buildBook() for all 11 volumes...');
  for (const k of VOLUME_KEYS) {
    const cfg = VOLUMES[k];
    assert.ok(fs.existsSync(cfg.sourceFile), `Missing source.json for Vol ${k}`);
    assert.ok(fs.existsSync(cfg.finalFile), `Missing paragraphs_final.json for Vol ${k}`);
    assert.ok(fs.existsSync(cfg.titlesFile), `Missing chapters.json for Vol ${k}`);

    const src = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
    assert.ok(Array.isArray(src) && src.length > 0, `source.json must be non-empty array for Vol ${k}`);
    assert.ok(typeof src[0].page === 'number' && typeof src[0].img === 'string' && typeof src[0].text === 'string');

    const book = buildBook({
      dataDir: cfg.dataDir,
      imgPrefix: cfg.imgPrefix,
      volume: cfg.label,
      titlesFile: cfg.titlesFile,
    });
    assert.strictEqual(book.total, src.length, `Book page count mismatch for Vol ${k}`);
    assert.ok(book.chapters.length >= 4, `Expected chapters in Vol ${k}`);

    if (k !== '4' && k !== '4.5') {
      const artPages = book.pages.filter((p) => p.art);
      assert.ok(artPages.length >= 5, `Expected clean WebP illustrations for Vol ${k}, got ${artPages.length}`);
      for (const p of artPages) {
        const diskFile = path.join(ROOT, 'public', p.img.replace(/^\/+/, ''));
        assert.ok(fs.existsSync(diskFile), `Missing WebP illustration file on disk: ${diskFile}`);
      }
    }
  }
  console.log('   ✓ All 11 volumes verified across source.json, chapters.json, WebP assets, and server.js');
}

function testFlipIllustrationPositionAlignment() {
  console.log('7. Testing FlipHTML5 position-based illustration alignment (no blind separator shifts)...');
  const activeBody = [
    { kind: 'prose', srcIdx: 10, text: 'Prologue opening scene with Alisa and Masachika talking.', heading: { label: 'Prolog', enTitle: 'Prologue' } },
    { kind: 'empty', srcIdx: 11 }, // Boş bölüm ayırıcı (illüstrasyon yok)
    { kind: 'prose', srcIdx: 12, text: 'Chapter 1 starts here in the student council room.', heading: { label: 'Bölüm 1', enTitle: 'Chapter 1' } },
    { kind: 'empty', srcIdx: 13 }, // Gerçek Bölüm 1 sahne illüstrasyonu (PDF s.14)
    { kind: 'prose', srcIdx: 14, text: 'She smiled mischievously as the shutter clicked behind them.' },
    { kind: 'prose', srcIdx: 15, text: 'Afterword thanks to Momoco-sensei for the wonderful art.', heading: { label: 'Sonsöz', enTitle: 'Afterword' } },
  ];

  // 1) PDF sayfa numarasına (pdfPage) göre eşleştirme + eksik yuva ekleme
  const byPdf = alignMidIllustrationsToBody(activeBody, [
    { buffer: Buffer.from('ch1-art'), pdfPage: 14 },
    { buffer: Buffer.from('afterword-art'), pdfPage: 17 },
  ]);
  // Boş ayırıcı (srcIdx 11) elenmeli, ch1-art Chapter 1 başlangıcından SONRA (index 2), afterword-art en sonda olmalı
  assert.strictEqual(byPdf.length, 6);
  assert.strictEqual(byPdf[0].kind, 'prose');
  assert.strictEqual(byPdf[1].heading.label, 'Bölüm 1', 'Blank separator before Chapter 1 must not receive Chapter 1 art');
  assert.strictEqual(byPdf[2].kind, 'art');
  assert.strictEqual(byPdf[2].buffer.toString(), 'ch1-art');
  assert.strictEqual(byPdf[5].kind, 'art');
  assert.strictEqual(byPdf[5].buffer.toString(), 'afterword-art');

  // 2) EPUB metin çapalarına (prevAnchor / nextAnchor) göre eşleştirme
  const byAnchor = alignMidIllustrationsToBody(activeBody, [
    {
      buffer: Buffer.from('epub-ch1-art'),
      prevAnchor: 'Chapter 1 starts here in the student council room.',
      nextAnchor: 'She smiled mischievously as the shutter clicked behind them.',
    },
  ]);
  assert.strictEqual(byAnchor.length, 5, 'Unmatched empty separator must be omitted');
  assert.strictEqual(byAnchor[1].heading.label, 'Bölüm 1');
  assert.strictEqual(byAnchor[2].kind, 'art');
  assert.strictEqual(byAnchor[2].buffer.toString(), 'epub-ch1-art');
  console.log('   ✓ Position-based PDF page & EPUB anchor matching verified');
}

function testVol5To7BodyIllustrationScanAlignment() {
  console.log('8. Verifying Vol 5, 6, and 7 body illustrations against neighboring PDF scan/*.webp pages...');

  const pyVerify = `
import json, os, sys
from PIL import Image

payload = json.loads(sys.argv[1])

def nvec(im, size=32):
    g = im.convert('L').resize((size, size), Image.Resampling.BILINEAR)
    px = list(g.tobytes())
    mean = sum(px) / len(px)
    var = sum((x - mean) ** 2 for x in px) / len(px)
    std = (var ** 0.5) or 1.0
    return [(x - mean) / std for x in px]

def corr(a, b):
    return sum(x * y for x, y in zip(a, b)) / len(a)

def crop_band(im):
    small = im.resize((96, 144), Image.Resampling.BILINEAR)
    w, h = small.size
    px = small.convert('L').tobytes()
    ys = [y for y in range(h) if sum(1 for v in px[y * w:(y + 1) * w] if v < 245) > w * 0.08]
    xs = [x for x in range(w) if sum(1 for y in range(h) if px[y * w + x] < 245) > h * 0.05]
    if ys and xs and (ys[-1] - ys[0]) > h * 0.20 and (xs[-1] - xs[0]) > w * 0.30:
        return small.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))
    return small

def pair_score(clean_im, scan_im):
    vc_f, vc_c = nvec(clean_im), nvec(crop_band(clean_im))
    vs_f, vs_c = nvec(scan_im), nvec(crop_band(scan_im))
    best = max(corr(vc_f, vs_f), corr(vc_c, vs_c), corr(vc_f, vs_c))
    if clean_im.width > clean_im.height and scan_im.height > scan_im.width:
        g64 = scan_im.convert('L').resize((64, 96), Image.Resampling.BILINEAR)
        th = round(64 * clean_im.height / clean_im.width)
        if 8 <= th <= 96:
            for y in range(0, 96 - th + 1, 2):
                c = corr(vc_f, nvec(g64.crop((0, y, 64, y + th))))
                if c > best:
                    best = c
    return best

def color_sat(im):
    raw = im.convert('RGB').resize((48, 72), Image.Resampling.BILINEAR).tobytes()
    return sum(max(raw[i], raw[i+1], raw[i+2]) - min(raw[i], raw[i+1], raw[i+2]) for i in range(0, len(raw), 3)) / (len(raw) // 3)

out = {}
for vol, spec in payload.items():
    scan_cache = {}
    def get_scan(pdf_no):
        if pdf_no not in scan_cache:
            scan_cache[pdf_no] = Image.open(os.path.join(spec['scanDir'], f'{pdf_no:03d}.webp')).convert('RGB')
        return scan_cache[pdf_no]

    all_art_pdfs = spec['allArtPdfs']
    vol_res = []
    for item in spec['items']:
        cim = Image.open(item['cleanPath']).convert('RGB')
        sat = color_sat(cim)
        # Kendi komşuluk PDF penceresindeki en iyi eşleşme
        win_scores = [(pair_score(cim, get_scan(p)), p) for p in item['windowPdfs']]
        win_scores.sort(reverse=True)
        win_best_corr, win_best_pdf = win_scores[0] if win_scores else (0.0, None)

        # Tüm gövde illüstrasyon PDF sayfaları arasındaki en iyi eşleşme
        global_scores = [(pair_score(cim, get_scan(p)), p) for p in all_art_pdfs]
        global_scores.sort(reverse=True)
        glob_best_corr, glob_best_pdf = global_scores[0]

        vol_res.append({
            'page': item['page'],
            'sat': round(sat, 2),
            'winBestPdf': win_best_pdf,
            'winBestCorr': round(win_best_corr, 4),
            'globBestPdf': glob_best_pdf,
            'globBestCorr': round(glob_best_corr, 4),
        })
    out[vol] = vol_res

print(json.dumps(out))
`;

  const payload = {};
  for (const vol of ['5', '6', '7']) {
    const cfg = VOLUMES[vol];
    const src = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
    const tr = JSON.parse(fs.readFileSync(cfg.finalFile, 'utf8'));
    const chMeta = JSON.parse(fs.readFileSync(cfg.titlesFile, 'utf8'));
    const scanMapObj = JSON.parse(fs.readFileSync(path.join(ROOT, cfg.dataDir, 'scan_map.json'), 'utf8'));
    const scanMap = scanMapObj.map;
    const scanCount = scanMapObj.count;

    assert.strictEqual(scanMap.length, src.length, `Vol ${vol} scan_map length must match source.json length`);

    const book = buildBook({
      dataDir: cfg.dataDir,
      imgPrefix: cfg.imgPrefix,
      volume: cfg.label,
      titlesFile: cfg.titlesFile,
    });

    const firstStoryCh = chMeta.chapters.find((c) => c.label !== 'İllüstrasyonlar');
    const firstBodyPage = firstStoryCh.startPage;

    const volDir = path.join(ROOT, cfg.imgDir);
    const scanDir = path.join(volDir, 'scan');
    const diskWebps = fs
      .readdirSync(volDir)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => Number(f.split('.')[0]))
      .sort((a, b) => a - b);

    // Ön İllüstrasyonlar bölümü en az 4 görsel içermeli
    const frontWebps = diskWebps.filter((p) => p < firstBodyPage);
    assert.ok(frontWebps.length >= 4, `Vol ${vol} must have >= 4 front illustrations in İllüstrasyonlar`);

    const bodyWebps = diskWebps.filter((p) => p >= firstBodyPage);
    assert.strictEqual(bodyWebps.length, 11, `Vol ${vol} must have all 11 body scene illustrations aligned`);

    // Boş ayırıcı sayfalarda (diskte .webp olmayan boş metin yuvalarında) kırık görsel yolu olmamalı
    for (const pg of book.pages) {
      if (pg.n >= firstBodyPage && pg.tr.length === 0 && !bodyWebps.includes(pg.n)) {
        assert.strictEqual(pg.art, false, `Vol ${vol} separator p.${pg.n} must have art=false`);
        assert.strictEqual(pg.img, null, `Vol ${vol} separator p.${pg.n} must have img=null`);
      }
    }

    // Statik v<vol>.json varsa onda da boş ayırıcıların img=null olduğu doğrulanmalı
    const staticBookPath = path.join(ROOT, 'public', 'books', `v${vol}.json`);
    if (fs.existsSync(staticBookPath)) {
      const staticBook = JSON.parse(fs.readFileSync(staticBookPath, 'utf8'));
      for (const pg of staticBook.pages) {
        if (pg.n >= firstBodyPage && pg.tr.length === 0 && !bodyWebps.includes(pg.n)) {
          assert.strictEqual(pg.img, null, `Static v${vol}.json separator p.${pg.n} must keep img=null`);
        }
      }
    }

    const items = [];
    const allArtPdfs = new Set();

    for (const pno of bodyWebps) {
      const idx = pno - 1;
      assert.strictEqual(src[idx].text.trim(), '', `Vol ${vol} body art p.${pno} must sit on an empty source.json slot`);
      assert.strictEqual((tr[String(pno)] || []).length, 0, `Vol ${vol} body art p.${pno} must have 0 TR paragraphs`);

      // Komşu metin sayfalarının PDF aralığını [loPdf, hiPdf] bul
      let loPdf = 1;
      for (let j = idx - 1; j >= firstBodyPage - 1; j--) {
        if (src[j].text.trim().length > 0) {
          loPdf = scanMap[j];
          break;
        }
      }
      let hiPdf = scanCount;
      for (let j = idx + 1; j < src.length; j++) {
        if (src[j].text.trim().length > 0) {
          hiPdf = scanMap[j];
          break;
        }
      }

      const windowPdfs = [];
      for (let s = Math.max(1, loPdf); s <= Math.min(scanCount, hiPdf); s++) {
        if (fs.existsSync(path.join(scanDir, `${String(s).padStart(3, '0')}.webp`))) {
          windowPdfs.push(s);
        }
      }

      allArtPdfs.add(scanMap[idx]);
      items.push({
        page: pno,
        cleanPath: path.join(volDir, `${String(pno).padStart(3, '0')}.webp`),
        mappedPdf: scanMap[idx],
        windowPdfs,
      });
    }

    payload[vol] = {
      scanDir,
      allArtPdfs: [...allArtPdfs].sort((a, b) => a - b),
      items,
    };
  }

  const pyOut = JSON.parse(
    execFileSync('python3', ['-c', pyVerify, JSON.stringify(payload)], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  );

  for (const vol of ['5', '6', '7']) {
    for (const r of pyOut[vol]) {
      assert.ok(
        r.sat < 4.0,
        `Vol ${vol} p.${r.page} has color saturation ${r.sat} >= 4.0 (leaked front color kuchie in story body!)`
      );
      assert.ok(
        r.winBestCorr >= 0.92,
        `Vol ${vol} p.${r.page} failed neighborhood PDF scan match: best corr=${r.winBestCorr} (PDF s.${r.winBestPdf})`
      );
      assert.strictEqual(
        r.winBestPdf,
        r.globBestPdf,
        `Vol ${vol} p.${r.page} is in the wrong chapter/slot! Neighborhood best=PDF s.${r.winBestPdf} (${r.winBestCorr}), but matches PDF s.${r.globBestPdf} (${r.globBestCorr})`
      );
    }
  }

  console.log('   ✓ All 33 body illustrations across Vols 5, 6, and 7 match their exact neighborhood PDF scans (corr >= 0.92, zero wrong chapters, zero kuchie leaks)');
}

function run() {
  console.log('=== Starting Ingestion, Translation & Multi-Volume Pipeline Tests ===\n');
  testVolumeRegistry();
  testFlipHtml5UrlRules();
  testAnubisSolverAndOcrCleanup();
  testPostProcessorsAndTranslatorHelpers();
  testSecreftlsPendingHandling();
  testAllVolumesCanonicalArtifactsAndServer();
  testFlipIllustrationPositionAlignment();
  testVol5To7BodyIllustrationScanAlignment();
  console.log('\n=== All Ingestion & Pipeline Tests Passed! ===');
}

run();
