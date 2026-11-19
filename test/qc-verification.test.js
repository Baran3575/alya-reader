// Automated verification of QC CLI, Schema, and Regression Gating
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'qc', 'cli.js');
const PATCH_SCRIPT = path.join(ROOT, 'scripts', 'patch.js');

function runCLI(args = [], expectSuccess = true) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    if (!expectSuccess) {
      assert.fail(`Expected CLI to fail with args: ${args.join(' ')}, but it succeeded:\n${out}`);
    }
    return { code: 0, out };
  } catch (err) {
    if (expectSuccess) {
      assert.fail(`Expected CLI to succeed with args: ${args.join(' ')}, but it failed (code ${err.status}):\n${err.stdout}\n${err.stderr}`);
    }
    return { code: err.status || 1, out: (err.stdout || '') + '\n' + (err.stderr || '') };
  }
}

function testCleanPass() {
  console.log('Testing clean pass for Vol 4 and Vol 4.5...');
  const v4 = runCLI(['--volume', '4', '--strict', '--check-regression'], true);
  assert(v4.out.includes('✓ Tüm eşikler içinde'), 'Vol 4 should pass clean');

  const v45 = runCLI(['--volume', '4.5', '--strict', '--check-regression'], true);
  assert(v45.out.includes('✓ Tüm eşikler içinde'), 'Vol 4.5 should pass clean');

  const both = runCLI(['--strict'], true);
  assert(both.out.includes('Cilt 4') && both.out.includes('Cilt 4.5'), 'Both volumes should run');
  console.log('  ✓ Clean passes verified');
}

function testTurkishDotlessCharacters() {
  console.log('Testing Turkish dotless characters ("andıran", "boşandı")...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    // Append Turkish words with dotless characters to a paragraph
    data['14'][0] += ' Bu durum eski günleri andıran bir hava yarattı ve çift boşandı.';
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], true);
    assert(res.out.includes('İngilizce kalıntı        0'), 'Dotless characters must not trigger English residue');
    console.log('  ✓ Dotless characters produce zero defect warnings');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testIntentionalEnglishResidue() {
  console.log('Testing intentional English residue defect...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    data['14'][0] += ' and with that there was nothing.';
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Should exit code 1');
    assert(res.out.includes('İngilizce kalıntı'), 'Diagnostics must mention English residue');
    console.log('  ✓ Intentional English residue caught with code 1 and descriptive diagnostics');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testIntentionalUnclosedQuote() {
  console.log('Testing intentional unclosed quote defect...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    data['14'][0] += ' “Bu tırnak hiçbir zaman kapanmayacak.';
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Should exit code 1');
    assert(res.out.includes('kapanmamış tırnak') || res.out.includes('tek sayıda tırnak'), 'Diagnostics must mention unclosed quote');
    console.log('  ✓ Intentional unclosed quote caught with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testIntentionalTranslatorNote() {
  console.log('Testing intentional translator note defect...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    data['14'][0] += ' (ÇN: Burası çevirmen notudur.)';
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Should exit code 1');
    assert(res.out.includes('çevirmen notu'), 'Diagnostics must mention translator note');
    console.log('  ✓ Translator note caught with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testPatchValidationAndRegression() {
  console.log('Testing patch schema and regression gating...');
  const patchesPath = path.join(ROOT, 'scripts', 'patches.json');
  const orig = fs.readFileSync(patchesPath, 'utf8');
  try {
    // 1. Invalid key format
    const badKeyData = JSON.parse(orig);
    badKeyData['invalid_key_format'] = 'Metin';
    fs.writeFileSync(patchesPath, JSON.stringify(badKeyData));

    const res1 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res1.code, 1, 'Invalid patch key must fail CLI');
    assert(res1.out.includes('yama'), 'Must mention patch failure');

    // 2. Non-existent target paragraph
    const nonExistentData = JSON.parse(orig);
    nonExistentData['999.999'] = 'Metin';
    fs.writeFileSync(patchesPath, JSON.stringify(nonExistentData));

    const res2 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res2.code, 1, 'Non-existent patch target must fail CLI');

    // 3. Regressing patch (increases defect score)
    const regressingData = JSON.parse(orig);
    regressingData['14.0'] = '“Çift nokta.. ve İngilizce that vardır.” (ÇN: not)';
    fs.writeFileSync(patchesPath, JSON.stringify(regressingData));

    const res3 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res3.code, 1, 'Regressing patch must fail CLI');
    console.log('  ✓ Patch schema validation and regression gating verified');
  } finally {
    fs.writeFileSync(patchesPath, orig);
  }
}

function testScoreRegressionGate() {
  console.log('Testing volume average score regression gate...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    // Add multiple defective sentences to push average score above baseline
    for (let p = 14; p < 80; p++) {
      if (data[String(p)]) {
        data[String(p)].forEach((t, i) => {
          data[String(p)][i] = t + ' bir şekilde bir şekilde söz konusu lı bir şekilde olmasına rağmen';
        });
      }
    }
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--check-regression'], false);
    assert.strictEqual(res.code, 1, 'Degraded average score must be blocked');
    assert(res.out.includes('ortalama puan'), 'Must report score regression');
    console.log('  ✓ Regression gate blocks degraded average score');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testSchemaValidation() {
  console.log('Testing paragraphs_final.json schema validation...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const badData = { "not_a_number": ["paragraf"] };
    fs.writeFileSync(v4Path, JSON.stringify(badData));

    const res = runCLI(['--volume', '4'], false);
    assert.strictEqual(res.code, 1, 'Invalid schema must fail CLI');
    assert(res.out.includes('şema'), 'Must report schema error');
    console.log('  ✓ JSON schema validation verified');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testMultiVolumeCatalogAndFeatures() {
  console.log('Testing 11-volume catalog, standalone TOC headings, chapter-native & ongoing Vol 12...');
  const { VOLUME_ORDER, VOLUMES, getCatalog, buildBook } = require('../server');
  const { CANONICAL_VOLUMES } = require('../scripts/qc/cli');
  const { normalizeFlipHtml5Url } = require('../scripts/volumes');

  const expectedOrder = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];
  assert.deepStrictEqual(VOLUME_ORDER, expectedOrder, 'server.js VOLUME_ORDER must match canonical 11-volume order');
  assert.deepStrictEqual(CANONICAL_VOLUMES, expectedOrder, 'cli.js CANONICAL_VOLUMES must match canonical 11-volume order');

  assert.strictEqual(
    normalizeFlipHtml5Url('https://fliphtml5.com/utpiy/ekus'),
    'https://online.fliphtml5.com/utpiy/ekus/',
    'FlipHTML5 URLs must normalize to online.fliphtml5.com'
  );

  const catalog = getCatalog();
  assert.strictEqual(catalog.length, 11, 'Catalog must expose all 11 volumes');

  // Verify standalone bonus/afterword chapters in Volumes 5-10 without TOC duplicates
  const expectedChapters = {
    '5': ['Prologue', 'Epilogue', 'Afterword'],
    '6': ['Prologue', 'Afterword', 'Afterword SS', 'Bookwalker'],
    '7': ['Prologue', 'Side Story', 'Afterword'],
    '8': ['Prologue', 'Epilogue', 'Afterword'],
    '9': ['Prologue', 'Anecdote', 'Afterword'],
    '10': ['Prologue', 'Afterword', 'Bookwalker'],
  };

  for (const [volKey, reqKeys] of Object.entries(expectedChapters)) {
    const book = buildBook(VOLUMES[volKey]);
    const foundKeys = book.chapters.map((c) => c.key);
    const uniqueKeys = new Set(foundKeys);
    assert.strictEqual(foundKeys.length, uniqueKeys.size, `Volume ${volKey} TOC must not have duplicate chapter keys`);
    for (const rk of reqKeys) {
      assert(uniqueKeys.has(rk), `Volume ${volKey} TOC must include standalone section "${rk}" (got: ${foundKeys.join(', ')})`);
    }
  }

  // Verify chapter-native flag on 9.5, 11, 12 and page-scan flag on 4..9, 10
  for (const volKey of expectedOrder) {
    const book = buildBook(VOLUMES[volKey]);
    const expectNative = ['9.5', '11', '12'].includes(volKey);
    assert.strictEqual(Boolean(book.chapterNative), expectNative, `Volume ${volKey} chapterNative mismatch`);
    assert(book.total > 0 && book.chapters.length > 0, `Volume ${volKey} must have pages and chapters`);

    const bundleVolPath = path.join(ROOT, 'public', 'volumes', `${volKey}.json`);
    assert(fs.existsSync(bundleVolPath), `Lazy-loaded bundle public/volumes/${volKey}.json must exist`);
  }

  // Verify Volume 12 ongoing metadata and absence of [Translation In Progress] placeholders
  const book12 = buildBook(VOLUMES['12']);
  assert.strictEqual(book12.ongoing, true, 'Volume 12 must be marked ongoing');
  const raw12 = fs.readFileSync(path.join(ROOT, 'public', 'volumes', '12.json'), 'utf8');
  assert(!/Translation\s+In\s+Progress/i.test(raw12), 'Volume 12 must not contain [Translation In Progress] placeholders');
  console.log('  ✓ 11-volume catalog, standalone TOC sections, chapter-native flags, and ongoing Vol 12 verified');
}

function runAll() {
  console.log('=== Starting QC CLI and Matrix Verification Tests ===\n');
  testCleanPass();
  testTurkishDotlessCharacters();
  testIntentionalEnglishResidue();
  testIntentionalUnclosedQuote();
  testIntentionalTranslatorNote();
  testPatchValidationAndRegression();
  testScoreRegressionGate();
  testSchemaValidation();
  testMultiVolumeCatalogAndFeatures();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
