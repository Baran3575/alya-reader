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
  isCreditsOrTocPage,
  detectPageHeading,
  alignMidIllustrationsToBody,
} = require('../scripts/ingest/adapters/fliphtml5');
const { fixLigatures, selectVolumes } = require('../scripts/fix_en_ocr');
const { repairBoundaries } = require('../scripts/fix_boundaries');
const { solveAnubisHash, parseAnubisChallenge } = require('../scripts/ingest/lib/anubis');
const { isTranslationInProgress, parseChapterHeadingMeta } = require('../scripts/ingest/adapters/secreftls12');
const { cleanOcrText } = require('../scripts/ingest/adapters/glucosetl95');
const { polish, balanceCurlyQuotes } = require('../scripts/merge');
const { notes, naturalize } = require('../scripts/naturalize');
const { normalizeWhisperBraces, refineLiteraryTurkish } = require('../scripts/translate_llm');
const { getImageDimensions } = require('../scripts/ingest/lib/webp');
const {
  encodePngRgb,
  encodePpmP6,
  parsePpmP6,
  decodeWebpRgbSync,
  forEachDecodedWebpSync,
  resizeGrayBilinear,
  nvecFromGray,
  corr,
  colorSat,
  summarizeFrameForCorrelation,
  pairScore,
  cropScanLetterboxToWebp,
} = require('../scripts/lib/webp_pixels');
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
  const preservedCn = naturalize('ÇN: Rusçada “stoykost”, sarsılmaz irade anlamına gelir.');
  assert.ok(preservedCn.startsWith('ÇN:'), 'Standalone ÇN: footnote paragraphs must be preserved by naturalize()');

  // FlipHTML5 fan-translation credits filter & canonical Turkish headings
  assert.strictEqual(
    isCreditsOrTocPage('Glucose Translations\nTranslation & Editing: Fan Translation\nOur discord: https://discord.gg/example\nsolely non-profit'),
    true,
    'Fan translation credit pages must be detected and filtered'
  );
  assert.deepStrictEqual(
    detectPageHeading('Prologue\nEncounter\n“Hey, Alya,” Masachika said as he walked into the student council room.'),
    {
      enLabel: 'Prologue',
      label: 'Önsöz',
      enTitle: 'Encounter',
      consumedLines: 2,
    }
  );
  assert.deepStrictEqual(
    detectPageHeading('Chapter 2\nWait, Did My Cowlick Just\nStand Up?\n“Whoa,” Masachika muttered while staring into the bathroom mirror.'),
    {
      enLabel: 'Chapter 2',
      label: 'Bölüm 2',
      enTitle: 'Wait, Did My Cowlick Just Stand Up?',
      consumedLines: 3,
    }
  );
  assert.deepStrictEqual(
    detectPageHeading('Epilogue\nThe End\nMasachika looked out the window as the autumn breeze drifted past.'),
    {
      enLabel: 'Epilogue',
      label: 'Sonsöz',
      enTitle: 'The End',
      consumedLines: 2,
    }
  );
  assert.deepStrictEqual(detectPageHeading('Afterword\nHello everyone, thank you so much for picking up this volume.'), {
    enLabel: 'Afterword',
    label: 'Yazarın Notu',
    enTitle: 'Afterword',
    consumedLines: 1,
  });

  // fix_en_ocr ligature & --vol selector
  assert.strictEqual(fixLigatures('Public Relations Of icer and dif icult choices'), 'Public Relations Officer and difficult choices');
  assert.deepStrictEqual(selectVolumes(['--vol', '5,6,7']), ['5', '6', '7']);

  // fix_boundaries source-guided orphan fragment repair
  const sampleBoundaryData = {
    '11': ['Sağ işaret parmağını kaydırdı ve kenarını çekti.'],
    '12': ['Elbise. Sonra baştan çıkarıcı bir sesle fısıldadı.'],
  };
  const sampleBoundarySrc = [
    { page: 11, text: 'She slid her finger and pulled the edge of the' },
    { page: 12, text: 'dress. Then she whispered in a seductive voice.' },
  ];
  const boundaryRep = repairBoundaries(sampleBoundaryData, sampleBoundarySrc);
  assert.strictEqual(boundaryRep.fragments.length, 1, 'Orphan fragment across mid-sentence page break must be repaired');
  assert.ok(sampleBoundaryData['11'][0].includes('elbise.'), 'Fragment must attach to previous page');
  assert.strictEqual(sampleBoundaryData['12'][0], 'Sonra baştan çıkarıcı bir sesle fısıldadı.');

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

function testVols5To7StructuralAndTocInvariants() {
  console.log('7. Verifying Vols 5, 6, and 7 credits cleanup, canonical TOC labels, whispers, and ÇN notes...');
  const v6Final = JSON.parse(fs.readFileSync(VOLUMES['6'].finalFile, 'utf8'));
  const v7Final = JSON.parse(fs.readFileSync(VOLUMES['7'].finalFile, 'utf8'));
  assert.deepStrictEqual(v6Final['6'], [], 'Vol 6 leaked fan-translation credits page 6 must be empty');
  assert.deepStrictEqual(v7Final['5'], [], 'Vol 7 leaked fan-translation credits page 5 must be empty');
  assert.strictEqual(v6Final['233'][0], '◇', 'Vol 6 page 233 must start with scene divider ◇');

  const tnNotesAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'tn_notes.json'), 'utf8'));

  for (const k of ['5', '6', '7']) {
    const ch = JSON.parse(fs.readFileSync(VOLUMES[k].titlesFile, 'utf8'));
    for (const item of ch.chapters) {
      assert.ok(!/^(?:Prolog|Epilog|Afterword)$/i.test(item.label), `Vol ${k} TOC label must use Önsöz/Sonsöz/Yazarın Notu: ${item.label}`);
      assert.ok(!/&[a-z]+;/i.test(item.enTitle || ''), `Vol ${k} enTitle must not contain raw HTML entities: ${item.enTitle}`);
    }
    const src = JSON.parse(fs.readFileSync(VOLUMES[k].sourceFile, 'utf8'));
    const tr = JSON.parse(fs.readFileSync(VOLUMES[k].finalFile, 'utf8'));
    const allParas = Object.values(tr).flat();
    assert.ok(allParas.some((p) => p.startsWith('ÇN: ')), `Vol ${k} must contain standalone ÇN: footnotes`);
    for (const p of allParas) {
      if (p.includes('⋆⋅☆⋅⋆')) assert.strictEqual(p, '⋆⋅☆⋅⋆', `Vol ${k} star divider must be standalone: ${p}`);
      if (p.includes('◇')) assert.strictEqual(p, '◇', `Vol ${k} diamond divider must be standalone: ${p}`);
    }

    // tn_notes.json ve data/quality/v<k>.json anahtarları asla boş illüstrasyon sayfasına düşmemeli (örn. C6 s.259 -> 260)
    for (const notePage of Object.keys(tnNotesAll[k] || {})) {
      const idx = Number(notePage) - 1;
      assert.ok(src[idx] && src[idx].text.trim().length > 0, `Vol ${k} tn_notes page ${notePage} must point to a prose page, not an empty art slot`);
      assert.ok((tr[notePage] || []).length > 0, `Vol ${k} tn_notes page ${notePage} must have non-empty TR paragraphs`);
    }
    const qFile = path.join(ROOT, 'data', 'quality', `v${k}.json`);
    if (fs.existsSync(qFile)) {
      const qData = JSON.parse(fs.readFileSync(qFile, 'utf8'));
      for (const qPage of Object.keys(qData)) {
        const idx = Number(qPage) - 1;
        assert.ok(src[idx] && src[idx].text.trim().length > 0, `Vol ${k} quality v${k}.json page ${qPage} must point to a prose page`);
      }
    }
  }
  console.log('   ✓ Vols 5–7 credits cleanup, TOC labels, standalone dividers, and ÇN/quality page targets verified');
}

function testFlipIllustrationPositionAlignment() {
  console.log('8. Testing FlipHTML5 position-based illustration alignment (no blind separator shifts)...');
  const activeBody = [
    { kind: 'prose', srcIdx: 10, text: 'Prologue opening scene with Alisa and Masachika talking.', heading: { label: 'Önsöz', enTitle: 'Prologue' } },
    { kind: 'empty', srcIdx: 11 }, // Boş bölüm ayırıcı (illüstrasyon yok)
    { kind: 'prose', srcIdx: 12, text: 'Chapter 1 starts here in the student council room.', heading: { label: 'Bölüm 1', enTitle: 'Chapter 1' } },
    { kind: 'empty', srcIdx: 13 }, // Gerçek Bölüm 1 sahne illüstrasyonu (PDF s.14)
    { kind: 'prose', srcIdx: 14, text: 'She smiled mischievously as the shutter clicked behind them.' },
    { kind: 'prose', srcIdx: 15, text: 'Afterword thanks to Momoco-sensei for the wonderful art.', heading: { label: 'Yazarın Notu', enTitle: 'Afterword' } },
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

function testPilFreeWebpPixelsPipeline() {
  console.log('9. Testing PIL-free WebP/PPM/PNG codecs and resampling helpers (Termux/libwebp path)...');
  // 1) PPM P6 kodlama/çözümleme (açıklama satırları dahil)
  const sampleRgb = Buffer.from([
    255, 0, 0, 0, 255, 0,
    0, 0, 255, 240, 240, 240,
  ]);
  const ppm = encodePpmP6(2, 2, sampleRgb);
  const parsedPpm = parsePpmP6(ppm);
  assert.strictEqual(parsedPpm.width, 2);
  assert.strictEqual(parsedPpm.height, 2);
  assert.deepStrictEqual(parsedPpm.rgb, sampleRgb);

  const commentedPpm = Buffer.concat([Buffer.from('P6\n# libwebp dwebp test\n2 2\n255\n', 'ascii'), sampleRgb]);
  assert.deepStrictEqual(parsePpmP6(commentedPpm).rgb, sampleRgb);

  // 2) PIL'siz PNG üretimi (pypdfium2 + cwebp yoluyla uyumlu)
  const pngBuf = encodePngRgb(2, 2, sampleRgb);
  assert.deepStrictEqual(getImageDimensions(pngBuf), { width: 2, height: 2, format: 'png' });
  assert.ok(colorSat(sampleRgb, 2, 2, 2, 2) > 150, 'Primary RGB pixels must report high color saturation');

  // 3) Üçgen filtreli yeniden örnekleme ve normalize korelasyon özdeşliği
  const grad = new Uint8Array(64 * 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) grad[y * 64 + x] = (x * 2 + y * 2) & 0xff;
  }
  const g32 = resizeGrayBilinear(grad, 64, 64, 32, 32);
  assert.strictEqual(g32.length, 1024);
  const v = nvecFromGray(grad, 64, 64, 32);
  assert.ok(Math.abs(corr(v, v) - 1.0) < 1e-6, 'Self-correlation must equal 1.0');

  // 4) Gerçek WebP dosyası üzerinde PIL tamamen devre dışıyken (disablePil: true) çözümleme
  const sampleWebp = path.join(ROOT, 'public', 'pages5', '036.webp');
  let pilFreeDecoded = null;
  try {
    pilFreeDecoded = decodeWebpRgbSync(sampleWebp, { disablePil: true });
  } catch (e) {
    if (e && e.code !== 'NO_WEBP_DECODER') throw e;
  }
  if (pilFreeDecoded) {
    assert.notStrictEqual(pilFreeDecoded.backend, 'pil', 'disablePil:true must never use Pillow');
    assert.ok(pilFreeDecoded.width > 400 && pilFreeDecoded.height > 600);
    assert.strictEqual(pilFreeDecoded.rgb.length, pilFreeDecoded.width * pilFreeDecoded.height * 3);

    // dwebp CLI sarmalayıcı yolunu da doğrula (Termux pkg install libwebp davranışı)
    if (process.platform !== 'win32') {
      const os = require('os');
      const fakeDwebp = path.join(os.tmpdir(), `alya_test_dwebp_${process.pid}.js`);
      try {
        fs.writeFileSync(
          fakeDwebp,
          [
            `#!${process.execPath}`,
            `const fs = require('fs');`,
            `const { encodePpmP6 } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'lib', 'webp_pixels'))});`,
            `const args = process.argv.slice(2);`,
            `const oIdx = args.indexOf('-o');`,
            `const outFile = args[oIdx + 1];`,
            `fs.writeFileSync(outFile, encodePpmP6(4, 6, Buffer.alloc(4 * 6 * 3, 128)));`,
          ].join('\n'),
          { mode: 0o755 }
        );
        const viaDwebp = decodeWebpRgbSync(sampleWebp, {
          preferredBackend: 'dwebp',
          dwebpBin: fakeDwebp,
          disablePil: true,
        });
        assert.strictEqual(viaDwebp.backend, 'dwebp');
        assert.strictEqual(viaDwebp.width, 4);
        assert.strictEqual(viaDwebp.height, 6);
      } finally {
        try {
          if (fs.existsSync(fakeDwebp)) fs.unlinkSync(fakeDwebp);
        } catch {}
      }
    }

    // PIL'siz letterbox kırpma ve WebP kodlama (cwebp PPM / libwebp WebPEncodeRGB) doğrulaması
    const os = require('os');
    const tmpOutWebp = path.join(os.tmpdir(), `alya_test_enc_${process.pid}.webp`);
    try {
      const encBackend = cropScanLetterboxToWebp(path.join(ROOT, 'public', 'pages7', 'scan', '273.webp'), tmpOutWebp, {
        quality: 80,
        disablePil: true,
      });
      assert.notStrictEqual(encBackend, 'pil');
      const outDim = getImageDimensions(fs.readFileSync(tmpOutWebp));
      assert.ok(outDim && outDim.format === 'webp' && outDim.width > outDim.height, 'Landscape spread letterbox must crop to landscape WebP');
    } finally {
      try {
        if (fs.existsSync(tmpOutWebp)) fs.unlinkSync(tmpOutWebp);
      } catch {}
    }
  }
  console.log(`   ✓ PIL-free PPM/PNG/WebP codecs verified (active backend: ${pilFreeDecoded ? pilFreeDecoded.backend : 'fallback'})`);
}

function testVol5To7BodyIllustrationScanAlignment() {
  console.log('10. Verifying Vol 5, 6, and 7 body illustrations against neighboring PDF scan/*.webp pages (PIL-free)...');

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

  // Tüm benzersiz clean ve scan WebP yollarını PIL gerektirmeden (libwebp / dwebp -> ffmpeg -> pil yedeği) çözümle
  const uniquePaths = new Set();
  for (const vol of ['5', '6', '7']) {
    const spec = payload[vol];
    for (const p of spec.allArtPdfs) {
      uniquePaths.add(path.join(spec.scanDir, `${String(p).padStart(3, '0')}.webp`));
    }
    for (const item of spec.items) {
      uniquePaths.add(item.cleanPath);
      for (const p of item.windowPdfs) {
        uniquePaths.add(path.join(spec.scanDir, `${String(p).padStart(3, '0')}.webp`));
      }
    }
  }

  const summaries = new Map();
  let usedBackend = 'none';
  try {
    usedBackend = forEachDecodedWebpSync([...uniquePaths], (fp, frame) => {
      summaries.set(fp, summarizeFrameForCorrelation(frame));
    });
  } catch (e) {
    if (e && e.code === 'NO_WEBP_DECODER') {
      console.log(`   ⚠ WebP çözücü (libwebp / dwebp / ffmpeg / Pillow) bulunamadı — piksel korelasyon doğrulaması atlandı`);
      return;
    }
    throw e;
  }

  for (const vol of ['5', '6', '7']) {
    const spec = payload[vol];
    for (const item of spec.items) {
      const cleanSum = summaries.get(item.cleanPath);
      const sat = Number(cleanSum.sat.toFixed(2));

      let winBestCorr = -Infinity;
      let winBestPdf = null;
      for (const p of item.windowPdfs) {
        const scanPath = path.join(spec.scanDir, `${String(p).padStart(3, '0')}.webp`);
        const sc = pairScore(cleanSum, summaries.get(scanPath));
        if (sc > winBestCorr) {
          winBestCorr = sc;
          winBestPdf = p;
        }
      }

      let globBestCorr = -Infinity;
      let globBestPdf = null;
      for (const p of spec.allArtPdfs) {
        const scanPath = path.join(spec.scanDir, `${String(p).padStart(3, '0')}.webp`);
        const sc = pairScore(cleanSum, summaries.get(scanPath));
        if (sc > globBestCorr) {
          globBestCorr = sc;
          globBestPdf = p;
        }
      }

      const winCorrRounded = Number(winBestCorr.toFixed(4));
      const globCorrRounded = Number(globBestCorr.toFixed(4));

      assert.ok(
        sat < 4.0,
        `Vol ${vol} p.${item.page} has color saturation ${sat} >= 4.0 (leaked front color kuchie in story body!)`
      );
      assert.ok(
        winCorrRounded >= 0.92,
        `Vol ${vol} p.${item.page} failed neighborhood PDF scan match: best corr=${winCorrRounded} (PDF s.${winBestPdf})`
      );
      assert.strictEqual(
        winBestPdf,
        globBestPdf,
        `Vol ${vol} p.${item.page} is in the wrong chapter/slot! Neighborhood best=PDF s.${winBestPdf} (${winCorrRounded}), but matches PDF s.${globBestPdf} (${globCorrRounded})`
      );
    }
  }

  console.log(
    `   ✓ All 33 body illustrations across Vols 5, 6, and 7 match their exact neighborhood PDF scans (corr >= 0.92, zero wrong chapters, zero kuchie leaks) [decoder: ${usedBackend}]`
  );
}

function run() {
  console.log('=== Starting Ingestion, Translation & Multi-Volume Pipeline Tests ===\n');
  testVolumeRegistry();
  testFlipHtml5UrlRules();
  testAnubisSolverAndOcrCleanup();
  testPostProcessorsAndTranslatorHelpers();
  testSecreftlsPendingHandling();
  testAllVolumesCanonicalArtifactsAndServer();
  testVols5To7StructuralAndTocInvariants();
  testFlipIllustrationPositionAlignment();
  testPilFreeWebpPixelsPipeline();
  testVol5To7BodyIllustrationScanAlignment();
  console.log('\n=== All Ingestion & Pipeline Tests Passed! ===');
}

run();
