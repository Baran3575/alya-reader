// Kapsamlı İçe Aktarma, Çeviri Hattı, Sunucu ve Cilt 4–12 Bütünlük Testleri
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { VOLUME_KEYS, VOLUMES, resolveVolume, parseVolumeArg } = require('../scripts/lib/volumes');
const { isSkippedSourceUrl, normalizeFlipBookUrl, parseSearchConfigJs } = require('../scripts/ingest/adapters/fliphtml5');
const { solveAnubisHash, parseAnubisChallenge } = require('../scripts/ingest/lib/anubis');
const { isTranslationInProgress, parseChapterHeadingMeta } = require('../scripts/ingest/adapters/secreftls12');
const { cleanOcrText, mergeCrossPageParagraphs } = require('../scripts/ingest/adapters/glucosetl95');
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

  const stitchedBlocks = mergeCrossPageParagraphs(
    [
      { isIllustration: false, paragraphs: ['“Wait, isn’t that cat'] },
      { isIllustration: false, paragraphs: ['looking right at us?”', 'Masachika nodded slowly.'] },
    ],
    "Right, Let's Go to a Cat Café"
  );
  assert.strictEqual(stitchedBlocks.length, 2);
  assert.strictEqual(stitchedBlocks[0].text, '“Wait, isn’t that cat looking right at us?”');
  console.log('   ✓ Anubis PoW solver, OCR cleanup, and paginate.js ingestion stitching verified');
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

function run() {
  console.log('=== Starting Ingestion, Translation & Multi-Volume Pipeline Tests ===\n');
  testVolumeRegistry();
  testFlipHtml5UrlRules();
  testAnubisSolverAndOcrCleanup();
  testPostProcessorsAndTranslatorHelpers();
  testSecreftlsPendingHandling();
  testAllVolumesCanonicalArtifactsAndServer();
  console.log('\n=== All Ingestion & Pipeline Tests Passed! ===');
}

run();
