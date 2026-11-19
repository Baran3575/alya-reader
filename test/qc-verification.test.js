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

const os = require('os');
const { buildBook, readBundleArt } = require('../server');

function testArtFlagDetection() {
  console.log('Testing server.js art flag detection and tail TN exclusion...');
  const b4 = buildBook({
    volKey: '4',
    dataDir: 'data',
    imgPrefix: '/pages/',
    volume: 'Cilt 4',
    titlesFile: path.join(ROOT, 'data', 'chapters.json'),
  });
  const b45 = buildBook({
    volKey: '4.5',
    dataDir: 'data45',
    imgPrefix: '/pages45/',
    volume: 'Cilt 4.5',
    titlesFile: path.join(ROOT, 'data45', 'chapters.json'),
  });

  // Cover pages 1-3 without local scans or ALYA_ART entries must be art: false
  for (const n of [1, 2, 3]) {
    assert.strictEqual(b4.pages[n - 1].art, false, `Vol 4 page ${n} should be art: false without scans/art`);
    assert.strictEqual(b45.pages[n - 1].art, false, `Vol 4.5 page ${n} should be art: false without scans/art`);
  }

  // Vol 4 page 282 "(TN: ...)" tail page must be excluded from art: true
  assert.strictEqual(b4.pages[281].n, 282);
  assert.strictEqual(b4.pages[281].art, false, 'Vol 4 page 282 translator note must not be flagged as art');

  // Mixed art+text pages must remain art: true
  assert.strictEqual(b4.pages[74].art, true, 'Vol 4 page 75 should remain art: true');
  assert(b4.pages[74].tr.length > 0, 'Vol 4 page 75 should retain Turkish text');
  assert.strictEqual(b45.pages[82].art, true, 'Vol 4.5 page 83 should remain art: true');
  assert(b45.pages[82].tr.length > 0, 'Vol 4.5 page 83 should retain Turkish text');

  // Total real illustrations: 15 in Vol 4 + 15 in Vol 4.5 = 30
  const artCount4 = b4.pages.filter((p) => p.art).length;
  const artCount45 = b45.pages.filter((p) => p.art).length;
  assert.strictEqual(artCount4, 15, `Expected 15 art pages in Vol 4, got ${artCount4}`);
  assert.strictEqual(artCount45, 15, `Expected 15 art pages in Vol 4.5, got ${artCount45}`);

  // Cover pages 1-3 qualify as art when ALYA_ART or local scan files exist
  const bWithArtMap = buildBook({
    volKey: '4',
    dataDir: 'data',
    imgPrefix: '/pages/',
    volume: 'Cilt 4',
    artMap: { '4': { '001': 'data:image/webp;base64,AAAA' } },
  });
  assert.strictEqual(bWithArtMap.pages[0].art, true, 'Cover page 1 should be art: true when ALYA_ART entry exists');
  assert.strictEqual(bWithArtMap.pages[1].art, false, 'Cover page 2 should remain art: false without asset');

  const tmpPub = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-pub-'));
  try {
    fs.mkdirSync(path.join(tmpPub, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpPub, 'pages', '002.webp'), Buffer.from('RIFF'));
    const bWithScan = buildBook({
      volKey: '4',
      dataDir: 'data',
      imgPrefix: '/pages/',
      volume: 'Cilt 4',
      pubDir: tmpPub,
      artMap: { '4': {} },
    });
    assert.strictEqual(bWithScan.pages[1].art, true, 'Cover page 2 should be art: true when local scan exists');
    assert.strictEqual(bWithScan.pages[1].scan, true, 'Cover page 2 should mark scan: true when local scan exists');
  } finally {
    fs.rmSync(tmpPub, { recursive: true, force: true });
  }
  // Structured volumes (5-12, 9.5): illustration pages with disk .webp have art: true & scan: true; prose pages omit scan
  const b5 = buildBook({
    volKey: '5',
    dataDir: 'data5',
    imgPrefix: '/pages5/',
    volume: 'Cilt 5',
    titlesFile: path.join(ROOT, 'data5', 'chapters.json'),
  });
  const b5Art = b5.pages.filter((p) => p.art);
  const b5Prose = b5.pages.filter((p) => !p.art);
  assert(b5Art.length >= 5 && b5Art.every((p) => p.scan === true), 'Vol 5 art pages must have scan: true');
  assert(b5Prose.every((p) => !p.scan), 'Vol 5 prose pages without disk scans must omit scan');
  console.log('  ✓ Art flag detection and cover/tail/structured-scan rules verified');
}

function testBundleArtPreservation() {
  console.log('Testing bundle-art.js preservation and pruning during bundle rebuild...');
  const artPath = path.join(ROOT, 'public', 'bundle-art.js');
  const bundlePath = path.join(ROOT, 'public', 'bundle.js');
  const beforeArt = fs.readFileSync(artPath, 'utf8');
  const beforeBundle = fs.readFileSync(bundlePath, 'utf8');
  try {
    const parsedBefore = readBundleArt(artPath);
    assert.strictEqual(Object.keys(parsedBefore['4'] || {}).length, 15, 'Vol 4 should have 15 embedded illustrations');
    assert.strictEqual(Object.keys(parsedBefore['4.5'] || {}).length, 15, 'Vol 4.5 should have 15 embedded illustrations');
    assert(!parsedBefore['4']['282'], 'Misflagged page 282 must be pruned from bundle-art.js');

    // Inject a synthetic art:false entry ("282") and rebuild without local scans:
    // valid entries must be preserved while art:false entry "282" is pruned.
    const injected = {
      '4': { ...parsedBefore['4'], '282': 'data:image/webp;base64,UklGRg==' },
      '4.5': { ...parsedBefore['4.5'] },
    };
    fs.writeFileSync(artPath, 'window.ALYA_ART=' + JSON.stringify(injected) + ';\n');

    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build_bundle.js')], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    const parsedAfter = readBundleArt(artPath);
    assert.strictEqual(Object.keys(parsedAfter['4'] || {}).length, 15, 'All 15 Vol 4 illustrations must be preserved');
    assert.strictEqual(Object.keys(parsedAfter['4.5'] || {}).length, 15, 'All 15 Vol 4.5 illustrations must be preserved');
    assert(!parsedAfter['4']['282'], 'Injected art:false entry 282 must be pruned on rebuild');
    console.log('  ✓ bundle-art.js preservation and art:false pruning verified');
  } finally {
    fs.writeFileSync(artPath, beforeArt);
    fs.writeFileSync(bundlePath, beforeBundle);
  }
}

function testFrontmatterAndFanUrlLeaks() {
  console.log('Testing frontmatter cleanup and fan-URL / Discord / OCR leak gates...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const v45Path = path.join(ROOT, 'data45', 'paragraphs_final.json');
  const orig4 = fs.readFileSync(v4Path, 'utf8');
  const orig45 = fs.readFileSync(v45Path, 'utf8');

  const d4 = JSON.parse(orig4);
  const d45 = JSON.parse(orig45);
  assert.deepStrictEqual(d4['3'], [], 'Vol 4 page 3 OCR noise must be cleared');
  assert.deepStrictEqual(d4['12'], [], 'Vol 4 page 12 ad must be cleared');
  assert.deepStrictEqual(d45['7'], [], 'Vol 4.5 page 7 fan credits must be cleared');
  assert.deepStrictEqual(d45['347'], [], 'Vol 4.5 page 347 translator afterword must be cleared');
  assert.strictEqual(d45['8'][0], 'İçindekiler', 'Vol 4.5 page 8 should start with İçindekiler');
  assert.strictEqual(d45['8'].length, 14, 'Vol 4.5 page 8 should list İçindekiler + 13 chapters');

  // Verify fan credit pages in Vols 6-10 and OCR noise in Vol 9.5 are cleared
  for (const [dir, pages] of [
    ['data6', ['6']],
    ['data7', ['5']],
    ['data8', ['6']],
    ['data9', ['7']],
    ['data10', ['6', '7', '249']],
  ]) {
    const dv = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'paragraphs_final.json'), 'utf8'));
    for (const p of pages) {
      assert.deepStrictEqual(dv[p], [], `${dir} page ${p} fan credit/disclaimer must be cleared`);
    }
  }
  const v95 = runCLI(['--volume', '9.5', '--strict', '--check-regression'], true);
  assert(v95.out.includes('OCR gürültüsü            0'), 'Vol 9.5 must have zero OCR noise');

  try {
    // 1. Intentional fan URL / Discord leak
    const leakUrl = JSON.parse(orig45);
    leakUrl['9'][0] += ' Bize katılın: discord.gg/roshidere ve https://glucosetl.wordpress.com/';
    fs.writeFileSync(v45Path, JSON.stringify(leakUrl));
    const resUrl = runCLI(['--volume', '4.5', '--strict'], false);
    assert.strictEqual(resUrl.code, 1, 'Fan URL / Discord invite must fail CLI');
    assert(resUrl.out.includes('hayran bağlantısı/Discord'), 'Diagnostics must mention fan URL / Discord');

    // 2. Intentional OCR noise leak
    fs.writeFileSync(v45Path, orig45);
    const leakOcr = JSON.parse(orig4);
    leakOcr['3'] = ['V1 Ar l O-p y C Jycc'];
    fs.writeFileSync(v4Path, JSON.stringify(leakOcr));
    const resOcr = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resOcr.code, 1, 'OCR noise must fail CLI');
    assert(resOcr.out.includes('OCR gürültüsü'), 'Diagnostics must mention OCR noise');
    console.log('  ✓ Frontmatter cleanup and fan-URL / OCR zero-tolerance gates verified');
  } finally {
    fs.writeFileSync(v4Path, orig4);
    fs.writeFileSync(v45Path, orig45);
  }
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
  testArtFlagDetection();
  testBundleArtPreservation();
  testFrontmatterAndFanUrlLeaks();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
