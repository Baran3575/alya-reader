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

function testLiteraryRestorations() {
  console.log('Testing literary restorations in Vol 4 and Vol 4.5...');
  const v4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'paragraphs_final.json'), 'utf8'));
  const v45 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data45', 'paragraphs_final.json'), 'utf8'));
  const bi45 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data45', 'bilingual.json'), 'utf8'));

  // Vol 4 Page 30: zero amusement-park fabrication, 16 canonical bedroom/warden paragraphs
  assert.strictEqual(v4['30'].length, 16, 'Vol 4 page 30 must have all 16 canonical paragraphs');
  const p30Joined = v4['30'].join(' ');
  assert(!/eğlence parkı/i.test(p30Joined), 'Vol 4 page 30 must not contain fabricated amusement-park lines');
  assert(p30Joined.includes('gardiyan') && p30Joined.includes('sake'), 'Vol 4 page 30 must contain canonical prison-warden skit');

  // Vol 4 Pages 103, 112, 118, 279 completeness
  assert.strictEqual(v4['103'].length, 10, 'Vol 4 page 103 must have 10 paragraphs');
  assert(v4['103'].join(' ').includes('Alya-san') && v4['103'].join(' ').includes('Yuki-san'), 'Vol 4 page 103 must restore Alya/Yuki dialogue');
  assert.strictEqual(v4['112'].length, 13, 'Vol 4 page 112 must have 13 paragraphs');
  assert.strictEqual(v4['118'].length, 16, 'Vol 4 page 118 must have 16 paragraphs');
  assert(v4['118'].join(' ').includes('2D') && v4['118'].join(' ').includes('Ayano'), 'Vol 4 page 118 must restore 2D joke and Ayano');
  assert.strictEqual(v4['279'].length, 11, 'Vol 4 page 279 must have 11 paragraphs');
  assert(v4['279'].join(' ').includes('Alisa'), 'Vol 4 page 279 must preserve Alisa');

  // Vol 4.5 restored passages: 10.3, 329.3, 330.3, 338.0
  assert(v45['10'][3].includes('Sayaka') && v45['10'][3].includes('Yuki'), 'Vol 4.5 10.3 must restore omitted sentences');
  assert.strictEqual(v45['329'].length, 5, 'Vol 4.5 page 329 must have 5 paragraphs');
  assert.strictEqual(v45['330'].length, 7, 'Vol 4.5 page 330 must have 7 paragraphs');
  assert(v45['330'][3].includes('Touya') && v45['330'][3].includes('Chisaki') && v45['330'][3].includes('Yuki'), 'Vol 4.5 330.3 must restore Touya, Chisaki, and Yuki');
  assert.strictEqual(v45['338'].length, 4, 'Vol 4.5 page 338 must have 4 paragraphs');
  assert(bi45['329'][3].d.trim().length > 0 && bi45['330'][3].d.trim().length > 0 && bi45['338'][0].d.trim().length > 0, 'Vol 4.5 bilingual.json entries must be non-empty');
  console.log('  ✓ Canonical literary restorations verified');
}

function testDroppedParagraphFailsCLI() {
  console.log('Testing injected dropped paragraph defect...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    data['112'].pop(); // Drop a single paragraph from page 112
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Dropped paragraph must exit with code 1');
    assert(res.out.includes('düşürülmüş paragraf'), 'Diagnostics must report dropped paragraph');
    console.log('  ✓ Dropped paragraph caught with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testLowWordRatioTruncatedPageFailsCLI() {
  console.log('Testing injected low word-ratio (truncated page) defect...');
  const v45Path = path.join(ROOT, 'data45', 'paragraphs_final.json');
  const orig = fs.readFileSync(v45Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    // Truncate each paragraph on page 10 to a couple of words while keeping paragraph count & names
    data['10'] = [
      'Yuki usulca gülümsedi.',
      'Sayaka teşekkür etti.',
      'Gizli otakular çekinirdi.',
      'Sayaka ve Yuki düşündü.',
      '“…”',
      '“…”',
    ];
    fs.writeFileSync(v45Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4.5', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Low word ratio must exit with code 1');
    assert(res.out.includes('düşük kelime oranı'), 'Diagnostics must report low word ratio');
    console.log('  ✓ Low word ratio caught with code 1');
  } finally {
    fs.writeFileSync(v45Path, orig);
  }
}

function testMissingCharacterNameFailsCLI() {
  console.log('Testing injected missing character name (entity parity) defect...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    // Replace canonical name Chisaki on page 103 without dropping paragraph or ratio
    data['103'] = data['103'].map((p) => p.replace(/Chisaki/g, 'başkan yardımcısı'));
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Missing character name must exit with code 1');
    assert(res.out.includes('eksik özel ad'), 'Diagnostics must report missing entity name');
    console.log('  ✓ Missing character name caught with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testFabricatedPage30FailsCLI() {
  console.log('Testing fabricated amusement-park rewrite on Vol 4 page 30...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const data = JSON.parse(orig);
    data['30'] = [
      '“Sanki senin kasıkların ısınıyormuş gibi konuşmayı bırak!”',
      '“Sonra çayı devirip üstünü ıslatacaksın, elbisesi içini gösterecek—”',
      '“O kadarı da fazla!”',
      'Masachika elini kaldırıp onu susturdu ve derin bir nefes aldı. Yuki gayet memnun, kollarını göğsünde kavuşturdu.',
      '“Neyse… Sen bari o saçma sapan rol yapmayı bırak. Bugün Ayano da gelecek, dışarı çıkıyoruz.”',
      '“Ooo, buluşma mı? Söylesene, kiminle?”',
      '“Kimseyle. Hep birlikte. Bir eğlence parkına.”',
      '“Hıh~ demek öyle~”',
      'Yuki yatakta doğrulup esnedi; saçlarını toplarken gözleri hâlâ kısıktı.',
      '“Bak, gidip üstümü değiştireceğim. Sen de kalk artık, yoksa gerçekten burada bırakırım.”',
      '“Evet evet~ İnsanın abisi de tam bir gardiyan oluyor…”',
    ];
    fs.writeFileSync(v4Path, JSON.stringify(data));

    const res = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(res.code, 1, 'Fabricated page 30 must fail CLI with code 1');
    assert(
      res.out.includes('düşük kelime oranı') && res.out.includes('düşürülmüş paragraf'),
      'Diagnostics must catch both low word ratio and dropped paragraphs on fabricated page 30'
    );
    console.log('  ✓ Fabricated amusement-park scene blocked with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testMergeEmptyBilingualGuard() {
  console.log('Testing merge.js and scripts45/merge.js empty { d, g } guard...');
  const tmpBi = path.join(ROOT, 'data', '_tmp_test_bilingual.json');
  const tmpOut = path.join(ROOT, 'data', '_tmp_test_out.json');
  try {
    fs.writeFileSync(
      tmpBi,
      JSON.stringify({
        '1': [
          { d: 'Geçerli çeviri metni.', g: 'Geçerli yedek.' },
          { d: '', g: '   ' },
        ],
      })
    );

    for (const scriptRel of ['scripts/merge.js', 'scripts45/merge.js']) {
      let failed = false;
      try {
        execFileSync(process.execPath, [path.join(ROOT, scriptRel), tmpBi, tmpOut], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (err) {
        failed = true;
        assert.strictEqual(err.status, 1, `${scriptRel} must exit with code 1 on empty bilingual entry`);
        assert((err.stderr || '').includes('1.1'), `${scriptRel} must identify empty entry 1.1`);
      }
      assert(failed, `${scriptRel} should have failed on empty entry`);
      assert(!fs.existsSync(tmpOut), `${scriptRel} must not write output when empty entries exist`);
    }
    console.log('  ✓ merge.js and scripts45/merge.js fail with code 1 on empty bilingual entries');
  } finally {
    if (fs.existsSync(tmpBi)) fs.unlinkSync(tmpBi);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

function testAuditMeaningZeroSkippedPages() {
  console.log('Testing audit_meaning.js 100% usable page coverage (zero skipped pages)...');
  const { evaluateMeaning } = require('../scripts/qc/audit_meaning');
  const { VOLUMES } = require('../scripts/qc/cli');

  // Verify Faz 1-5 registry covers Volumes 4, 4.5, and 5..12
  for (const expectedVol of ['4', '4.5', '5', '6', '7', '8', '9', '10', '11', '12']) {
    assert(VOLUMES[expectedVol], `VOLUMES registry must define volume ${expectedVol}`);
  }

  for (const vol of ['4', '4.5']) {
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, VOLUMES[vol].src), 'utf8'));
    const tr = JSON.parse(fs.readFileSync(path.join(ROOT, VOLUMES[vol].tr), 'utf8'));
    const res = evaluateMeaning(src, tr);
    assert(res.usablePages > 250, `Vol ${vol} must detect all usable text pages`);
    assert.strictEqual(res.skippedPages, 0, `Vol ${vol} must have 0 skipped usable pages`);
    assert.strictEqual(res.inspectedPages, res.usablePages, `Vol ${vol} must inspect 100% of usable pages`);
  }
  console.log('  ✓ Zero skipped pages and Faz 1–5 volume registry verified');
}

function runAll() {
  console.log('=== Starting QC CLI and Matrix Verification Tests ===\n');
  testCleanPass();
  testLiteraryRestorations();
  testTurkishDotlessCharacters();
  testIntentionalEnglishResidue();
  testIntentionalUnclosedQuote();
  testIntentionalTranslatorNote();
  testPatchValidationAndRegression();
  testScoreRegressionGate();
  testSchemaValidation();
  testDroppedParagraphFailsCLI();
  testLowWordRatioTruncatedPageFailsCLI();
  testMissingCharacterNameFailsCLI();
  testFabricatedPage30FailsCLI();
  testMergeEmptyBilingualGuard();
  testAuditMeaningZeroSkippedPages();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
