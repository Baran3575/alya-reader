// Automated verification of QC CLI, Schema, and Regression Gating
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'qc', 'cli.js');
const PATCH_SCRIPT = path.join(ROOT, 'scripts', 'patch.js');

function runCLI(args = [], expectSuccess = true, extraEnv = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
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

function testOmittedPageAndLowCoverageRatio() {
  console.log('Testing omitted usable page and low EN-TR coverage ratio gates...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    // 1. Completely omitted usable prose page (e.g. epilogue page 282)
    const omittedData = JSON.parse(orig);
    omittedData['282'] = [];
    fs.writeFileSync(v4Path, JSON.stringify(omittedData));

    const res1 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res1.code, 1, 'Omitted usable page must exit 1');
    assert(res1.out.includes('eksik sayfa çevirisi'), 'Diagnostics must report omitted page translation');

    // 2. Half-dropped page (simulating bottom-half omission on p.103)
    const truncatedPageData = JSON.parse(orig);
    truncatedPageData['103'] = truncatedPageData['103'].slice(0, 4);
    fs.writeFileSync(v4Path, JSON.stringify(truncatedPageData));

    const res2 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res2.code, 1, 'Low coverage ratio page must exit 1');
    assert(
      res2.out.includes('kelime oranı') || res2.out.includes('kapsam ihlali'),
      'Diagnostics must report coverage/word-ratio violation'
    );
    console.log('  ✓ Omitted page and low EN-TR coverage ratio caught');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testEmptyBilingualSlot() {
  console.log('Testing empty {g:"", d:""} slot detection in bilingual.json...');
  const bil45Path = path.join(ROOT, 'data45', 'bilingual.json');
  const orig = fs.readFileSync(bil45Path, 'utf8');
  try {
    const bil = JSON.parse(orig);
    bil['329'][3] = { g: '', d: '' };
    fs.writeFileSync(bil45Path, JSON.stringify(bil));

    const res = runCLI(['--volume', '4.5', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Empty bilingual slot must exit 1');
    assert(res.out.includes('boş bilingual çeviri yuvası'), 'Diagnostics must mention empty bilingual slot');
    assert(res.out.includes('329.3'), 'Diagnostics must identify slot 329.3');
    console.log('  ✓ Empty bilingual slot caught with exact page.index diagnostic');
  } finally {
    fs.writeFileSync(bil45Path, orig);
  }
}

function testBoundaryAndLowercaseFragmentGate() {
  console.log('Testing cross-page unfinished boundary and mid-page lowercase fragment gates...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    // 1. Unfinished cross-page boundary
    const splitData = JSON.parse(orig);
    const lastIdx = splitData['14'].length - 1;
    splitData['14'][lastIdx] = 'Son cümle sayfa sonunda yarım kaldı';
    fs.writeFileSync(v4Path, JSON.stringify(splitData));

    const res1 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res1.code, 1, 'Unfinished page-end sentence must exit 1');
    assert(res1.out.includes('sayfa sınırı yarım cümle / küçük harf başlangıcı'), 'Must report boundary violation');

    // 2. Mid-page orphan lowercase fragment
    const midData = JSON.parse(orig);
    midData['14'][1] = 'yarım kalmış küçük harfli cümle parçası.';
    fs.writeFileSync(v4Path, JSON.stringify(midData));

    const res2 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res2.code, 1, 'Mid-page lowercase start must exit 1');
    assert(res2.out.includes('sayfa sınırı yarım cümle / küçük harf başlangıcı'), 'Must report lowercase start');
    console.log('  ✓ Cross-page and mid-page sentence boundary violations caught');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testFanTlSpamAndUrlEnglishResidue() {
  console.log('Testing fan-TL spam detection and token-bounded URL stripping...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    // 1. Fan-TL domain / Discord recruitment link
    const spamData = JSON.parse(orig);
    spamData['14'][0] += ' Sunucumuza katılın: discord.gg/roshidere.';
    fs.writeFileSync(v4Path, JSON.stringify(spamData));

    const res1 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res1.code, 1, 'Fan-TL spam must exit 1');
    assert(res1.out.includes('fan-TL spam'), 'Diagnostics must mention fan-TL spam');

    // 2. English residue appearing AFTER a URL on the same paragraph (must NOT be masked by URL stripping)
    const urlEnData = JSON.parse(orig);
    urlEnData['14'][0] += ' Kaynak: https://example.com/path and with that there was nothing.';
    fs.writeFileSync(v4Path, JSON.stringify(urlEnData));

    const res2 = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res2.code, 1, 'English residue after URL must exit 1');
    assert(res2.out.includes('İngilizce kalıntı'), 'URL stripping must be token-bounded and catch trailing English');
    console.log('  ✓ Fan-TL spam and post-URL English residue both caught');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testMidPageKnownSplitQuoteRejected() {
  console.log('Testing mid-page KNOWN_PAGE_SPLIT_QUOTES rejection...');
  const res = runCLI(
    ['--volume', '4', '--strict'],
    false,
    { ALYA_KNOWN_SPLIT_QUOTES: JSON.stringify({ '4': ['14.1'] }) }
  );
  assert.strictEqual(res.code, 1, 'Mid-page quote exception must exit 1');
  assert(res.out.includes('KNOWN_PAGE_SPLIT_QUOTES'), 'Diagnostics must flag mid-page quote whitelist entry');
  console.log('  ✓ Mid-page KNOWN_PAGE_SPLIT_QUOTES entry rejected');
}

function testTruncatedPatchRejected() {
  console.log('Testing truncated patch completeness guard...');
  const patchesPath = path.join(ROOT, 'scripts', 'patches.json');
  const orig = fs.readFileSync(patchesPath, 'utf8');
  try {
    const truncated = JSON.parse(orig);
    truncated['72.0'] = 'Kısa bir cümle.';
    fs.writeFileSync(patchesPath, JSON.stringify(truncated));

    const cliRes = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(cliRes.code, 1, 'Truncated patch must fail QC CLI');
    assert(cliRes.out.includes('Kırpılmış yama hatası'), 'Diagnostics must report truncated patch');

    let patchFailed = false;
    try {
      execFileSync(process.execPath, [PATCH_SCRIPT, '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
    } catch (err) {
      patchFailed = true;
      const combined = (err.stdout || '') + (err.stderr || '');
      assert(combined.includes('Kırpılmış yama hatası'), 'patch.js --dry-run must report truncated patch');
    }
    assert(patchFailed, 'patch.js --dry-run must exit non-zero on truncated patch');
    console.log('  ✓ Truncated patch rejected by both QC CLI and patch.js --dry-run');
  } finally {
    fs.writeFileSync(patchesPath, orig);
  }
}

function testPipelineStitcherAndRestoredPassages() {
  console.log('Testing cross-page source stitcher and restored reader passages...');
  const { stitchPages } = require('../scripts/translate3');
  const samplePages = [
    {
      page: 103,
      words: 30,
      text: 'I stood up.\n\n"Therefore, I decided to call Masachika-\nPage 90 Goldenagato | mp4directs.com',
    },
    {
      page: 104,
      words: 25,
      text: 'kun by his first name as well." She smiled brightly.\n\n"Everyone gasped!"',
    },
  ];
  const stitched = stitchPages(samplePages);
  assert.strictEqual(
    stitched.get('103')[1],
    '"Therefore, I decided to call Masachika-kun by his first name as well."',
    'Stitcher must rejoin hyphenated honorific across Goldenagato page-footer collision'
  );
  assert.strictEqual(
    stitched.get('104')[0],
    'She smiled brightly.',
    'Remainder sentence on next page must be preserved cleanly'
  );
  assert.strictEqual(
    stitched.get('104')[1],
    '"Everyone gasped!"',
    'Following dialogue paragraph on next page must remain separate'
  );

  // Verify credit spam pages are empty and epilogue / named passages are restored
  const tr4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'paragraphs_final.json'), 'utf8'));
  const tr45 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data45', 'paragraphs_final.json'), 'utf8'));
  assert.deepStrictEqual(tr4['12'], [], 'Vol 4 p.12 spam page must be empty');
  assert.deepStrictEqual(tr4['282'], ['“Masachika.”'], 'Vol 4 p.282 epilogue caption must be restored without TN');
  assert(tr4['103'].some((p) => p.includes('Masachika-kun')), 'Vol 4 p.103 must contain stitched Masachika-kun line');
  assert.deepStrictEqual(tr45['7'], [], 'Vol 4.5 p.7 spam page must be empty');
  assert.deepStrictEqual(tr45['347'], [], 'Vol 4.5 p.347 recruitment page must be empty');
  assert.strictEqual(tr45['12'][2], '“!?”', 'Vol 4.5 12.2 reaction must remain intact');
  assert(tr45['329'][3] && tr45['329'][3].length > 80, 'Vol 4.5 329.3 empty slot must be restored');
  assert(tr45['330'][3] && tr45['330'][3].length > 80, 'Vol 4.5 330.3 empty slot must be restored');
  assert(tr45['338'][0] && tr45['338'][0].length > 80, 'Vol 4.5 338.0 empty slot must be restored');

  // Verify static bundle metadata marks credit/recruitment pages skip:true, art:false and caps V4.5 Ch 13 at p.346
  const bundleJs = fs.readFileSync(path.join(ROOT, 'public', 'bundle.js'), 'utf8');
  const match = bundleJs.match(/window\.ALYA_BUNDLE=(\{[\s\S]*?\});\s*\nwindow\.ALYA_BUNDLE_VERSION=/);
  assert(match, 'public/bundle.js must assign window.ALYA_BUNDLE');
  const bundle = JSON.parse(match[1]);
  const v4p12 = bundle.vols['4'].pages.find((p) => p.n === 12);
  const v45p7 = bundle.vols['4.5'].pages.find((p) => p.n === 7);
  const v45p347 = bundle.vols['4.5'].pages.find((p) => p.n === 347);
  assert.strictEqual(v4p12.skip, true, 'Bundle Vol 4 p.12 must have skip:true');
  assert.strictEqual(v4p12.art, false, 'Bundle Vol 4 p.12 must have art:false');
  assert.strictEqual(v45p7.skip, true, 'Bundle Vol 4.5 p.7 must have skip:true');
  assert.strictEqual(v45p347.skip, true, 'Bundle Vol 4.5 p.347 must have skip:true');
  assert.strictEqual(v45p347.art, false, 'Bundle Vol 4.5 p.347 must have art:false');
  const ch13 = bundle.vols['4.5'].chapters.find((c) => c.label === 'Bölüm 13');
  assert.strictEqual(ch13.endPage, 346, 'Bundle Vol 4.5 Ch 13 must end at page 346');
  console.log('  ✓ Pipeline stitcher, restored passages, and skipped credit page metadata verified');
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
  testOmittedPageAndLowCoverageRatio();
  testEmptyBilingualSlot();
  testBoundaryAndLowercaseFragmentGate();
  testFanTlSpamAndUrlEnglishResidue();
  testMidPageKnownSplitQuoteRejected();
  testTruncatedPatchRejected();
  testPipelineStitcherAndRestoredPassages();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
