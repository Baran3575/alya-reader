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

function testPostProcessorRepairs() {
  console.log('Testing post-processor repairs (-yyor, lowercase starts, "O" starts, quotes/suffixes, parens, HTTP 456)...');
  const { convertFormal } = require('../scripts/qc/qc4_verbs');
  const { naturalize } = require('../scripts/naturalize');
  const { processPageStarts } = require('../scripts/qc/qc10_starts');
  const { orientCurlyQuotes, reattachQuoteSuffixes } = require('../scripts/qc/qc6_typography');
  const { cleanPunctuation } = require('../scripts/qc/qc1_punctuation');
  const { isQuotaError } = require('../scripts/translate3');

  // 1. -yyor verb repair & explicit verb ordering
  assert.strictEqual(convertFormal('Birçok tanık bulunmaktadır.'), 'Birçok tanık bulunuyor.');
  assert.strictEqual(convertFormal('Hâlâ pişmanlık duymaktadır ve konuşmaktadır.'), 'Hâlâ pişmanlık duyuyor ve konuşuyor.');
  assert.strictEqual(convertFormal('bulunuyyor ve duyuyyor'), 'bulunuyor ve duyuyor');

  // 2. Keep uppercase letters after stops in naturalize.js
  const nat = naturalize('“Hadi ama! İstemeden bakışlarım kaydı.” Bunun nedeni neydi? İstemeden dişlerini sıktı.');
  assert(!/[.!?]\s+[a-zçğıöşü]/u.test(nat), `Expected uppercase after stops, got: ${nat}`);

  // 3. No "O" pronoun injection in qc10_starts.js; repairs legacy O’nin
  const starts = processPageStarts([
    'Alisa pencereden dışarı baktı.',
    'Alisa ardından sessizce iç çekti.',
    'O’nin sesi titriyordu.',
  ]);
  assert.strictEqual(starts.paragraphs[1], 'Alisa ardından sessizce iç çekti.');
  assert.strictEqual(starts.paragraphs[2], 'Onun sesi titriyordu.');

  // 4. Context-aware curly quotes & detached suffixes (preserving standalone ” ne and ” ya da)
  assert.strictEqual(
    orientCurlyQuotes('「Soryaa~! “ “Evet, klişe,” diye geçirdi.'),
    '「Soryaa~!」 “Evet, klişe,” diye geçirdi.'
  );
  assert.strictEqual(
    orientCurlyQuotes('“”“ Affedersiniz.””'),
    '“Affedersiniz.”'
  );
  assert.strictEqual(
    reattachQuoteSuffixes('“otaku hobileri” nin anlamı'),
    '“otaku hobileri”nin anlamı'
  );
  assert.strictEqual(
    reattachQuoteSuffixes('onun “ciddiyetinin” ne anlama geldiğini ve “olmaz” ya da “olur” dedi'),
    'onun “ciddiyetinin” ne anlama geldiğini ve “olmaz” ya da “olur” dedi'
  );

  // 5. Unbalanced-parenthesis lines are still cleaned by qc1_punctuation.js
  const cleanedUnbal = cleanPunctuation('(Bu iç monologda çift nokta.. var , değil mi?');
  assert(!cleanedUnbal.includes('..') && !cleanedUnbal.includes(' ,'), `Punctuation should still clean unbalanced parens: ${cleanedUnbal}`);

  // 6. DeepL HTTP 456 detection
  assert.strictEqual(isQuotaError(new Error('DeepL HTTP 456: Quota exceeded')), true);
  assert.strictEqual(isQuotaError(new Error('DeepL HTTP 500')), false);

  console.log('  ✓ Post-processor repairs verified');
}

function testCalqueScoringAndStrictZeroToleranceGates() {
  console.log('Testing calque scoring, glossary typos, unbalanced parens, detached suffixes, lowercase starts, and -yyor gates...');
  const { score } = require('../scripts/qc/quality');
  const { validateCandidate } = require('../scripts/rewrite_cohorts');

  // Pronoun "tarafından" passive calque, "Bunun"/"Ancak" clusters, TOC calque
  const sTaraf = score('1', 0, 'Masachika onun tarafından çağrıldı.');
  assert(sTaraf.score >= 2, 'Pronoun tarafından passive must be penalized');

  const sCluster = score('1', 0, 'Bunun sebebi belliydi. Ancak kimse konuşmadı. Bunun üzerine sustu.');
  assert(sCluster.score >= 2, 'Bunun/Ancak cluster must be penalized');

  const sToc = score('1', 0, 'Ben senin tarafından bir zorba olarak adlandırılmak istemiyorum');
  assert(sToc.score >= 2, 'TOC passive calque must be penalized');

  // Candidate guardrail checks (negation, numbers, parens, glossary)
  const badNeg = validateCandidate({
    vol: '4',
    key: '14.0',
    enText: 'She smiled warmly at her older brother across the bright room.',
    origTr: 'Aydınlık odanın karşısından ağabeyine sıcak bir tebessümle gülümsedi.',
    candidateTr: 'Aydınlık odanın karşısından ağabeyine hiç gülümsemedi.',
  });
  assert.strictEqual(badNeg.ok, false, 'Negation flip must be rejected');

  const badNum = validateCandidate({
    vol: '4',
    key: '14.0',
    enText: '3 girls stood quietly in front of the school gate.',
    origTr: 'Okul kapısının önünde 3 kız sessizce duruyordu.',
    candidateTr: 'Okul kapısının önünde beş kız sessizce duruyordu.',
  });
  assert.strictEqual(badNum.ok, false, 'Number mismatch must be rejected');

  // Strict CLI zero-tolerance checks for -yyor, lowercase starts, detached suffixes, unbalanced parens, glossary typos
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  const cases = [
    { label: '-yyor verb', patch: ' Orada bulunuyyor.', expectText: '-yyor' },
    { label: 'lowercase start', patch: '. ancak kimse gelmedi.', expectText: 'küçük harfle başlayan cümle' },
    { label: 'detached suffix', patch: ' “otaku” nin sesi duyuldu.', expectText: 'ayrık tırnak eki' },
    { label: 'unbalanced parenthesis', patch: ' (Bu parantez kapanmadı.', expectText: 'dengesiz parantez' },
    { label: 'glossary typo', patch: ' Merhaba Kuzye-kun dedi.', expectText: 'sözlük/özel ad hatası' },
  ];

  for (const c of cases) {
    try {
      const data = JSON.parse(orig);
      data['14'][0] += c.patch;
      fs.writeFileSync(v4Path, JSON.stringify(data));
      const res = runCLI(['--volume', '4', '--strict'], false);
      assert.strictEqual(res.code, 1, `${c.label} should fail strict CLI`);
      assert(res.out.includes(c.expectText), `Diagnostics for ${c.label} should include "${c.expectText}", got:\n${res.out}`);
    } finally {
      fs.writeFileSync(v4Path, orig);
    }
  }
  console.log('  ✓ Calque scoring, candidate guardrails, and strict zero-tolerance gates verified');
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
  testPostProcessorRepairs();
  testCalqueScoringAndStrictZeroToleranceGates();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
