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

function testNaturalizeUnicodeBoundariesAndNotes() {
  console.log('Testing naturalize.js Unicode boundaries, note stripping, and URL safety...');
  const { naturalize } = require('../scripts/naturalize');

  assert.strictEqual(naturalize('şayet gelirse haber ver.'), 'Eğer gelirse haber ver.');
  assert.strictEqual(naturalize('Bunu şayet kabul ederse sevinirim.'), 'Bunu eğer kabul ederse sevinirim.');
  assert.strictEqual(naturalize('Şayet doğruysa şaşırırım.'), 'Eğer doğruysa şaşırırım.');
  // Substring inside a longer word must NOT be replaced
  assert.strictEqual(naturalize('Bu inşayet kelimesi bozulmamalı.'), 'Bu inşayet kelimesi bozulmamalı.');

  // Translator notes must be stripped completely, never turned into banned "(ÇN:"
  const stripped = naturalize('Merhaba dünya. (TN: This is a translator note.) Devam ediyor. (ÇN: Eski not)');
  assert(!stripped.includes('ÇN:'), `Must not contain ÇN:, got: ${stripped}`);
  assert(!stripped.includes('TN:'), `Must not contain TN:, got: ${stripped}`);
  assert.strictEqual(stripped, 'Merhaba dünya. Devam ediyor.');

  // URLs must not get spaces injected after colons/dots
  const withUrl = naturalize('Adres: https://glucosetl.wordpress.com/test ve discord.gg/roshidere buradadır.');
  assert(withUrl.includes('https://glucosetl.wordpress.com/test'), `URL corrupted: ${withUrl}`);
  assert(withUrl.includes('discord.gg/roshidere'), `Discord URL corrupted: ${withUrl}`);
  console.log('  ✓ naturalize.js Unicode boundaries and note stripping verified');
}

function testQc10StartsApostropheSafety() {
  console.log('Testing qc10_starts.js apostrophe guard against O’nin / O’nın...');
  const { fixRepeatedStarts } = require('../scripts/qc/qc10_starts');

  const input = {
    '1': [
      'Yuki hızla odaya girdi.',
      'Yuki’nin gözleri parladı.',
      "Yuki'nin sesi titredi.",
      'Yuki masaya oturdu.',
      'Yuki gülümsedi.',
      'Alisa kapıyı açtı.',
      'Alisa’nın yüzü kızardı.',
    ],
  };
  fixRepeatedStarts(input);
  assert.strictEqual(input['1'][1], 'Yuki’nin gözleri parladı.', 'Curly possessive Yuki’nin must not become O’nin');
  assert.strictEqual(input['1'][2], "Yuki'nin sesi titredi.", "Straight possessive Yuki'nin must not become O'nin");
  assert.strictEqual(input['1'][3], 'Yuki masaya oturdu.');
  assert.strictEqual(input['1'][4], 'O gülümsedi.', 'Consecutive nominative Yuki should simplify to O');
  assert.strictEqual(input['1'][6], 'Alisa’nın yüzü kızardı.', 'Possessive Alisa’nın must not become O’nın');

  const { diversify } = require('../scripts/qc/qc3_repetition');
  const diversified = diversify('Ardından yürüdü, ardından durdu ve Alisa’nın ardından içeri girdi, kısa bir sessizliğin ardından konuştu.');
  assert(!/Alisa’nın sonra|sessizliğin sonra/u.test(diversified), `Genitive + sonra produced: ${diversified}`);
  console.log('  ✓ qc10_starts.js apostrophe safety and qc3_repetition.js genitive guard verified');
}

function testQc1PunctuationQuoteSuffixesAndSpacing() {
  console.log('Testing qc1_punctuation.js and norm_typo.js quote suffixes and curly typography...');
  const { fixPunctuation } = require('../scripts/qc/qc1_punctuation');
  const { normalizeText } = require('../scripts/norm_typo');
  const { polish } = require('../scripts/merge');

  assert.strictEqual(
    polish(`Masachika 'otaku' dedi ve ”ters“ tırnağı düzeltti.`),
    'Masachika ‘otaku’ dedi ve “ters” tırnağı düzeltti.'
  );

  assert.strictEqual(
    fixPunctuation('Gizli otakular “otaku hobileri” nin önemli olduğunu düşünür.'),
    'Gizli otakular “otaku hobileri”nin önemli olduğunu düşünür.'
  );
  assert.strictEqual(
    normalizeText('Sonra "o adam" a baktı ve "Cehennem" den çıktı.'),
    'Sonra “o adam”a baktı ve “Cehennem”den çıktı.'
  );
  // Standalone words ("ne", "de", "da") after quotes must remain separate
  assert.strictEqual(
    fixPunctuation('Chisaki, onun “ciddiyetinin” ne anlama geldiğini düşündü.'),
    'Chisaki, onun “ciddiyetinin” ne anlama geldiğini düşündü.'
  );
  // Closing quote followed by capitalized narration gets space, opening quote does not
  assert.strictEqual(
    fixPunctuation('“Merhaba.”Masachika el salladı.'),
    '“Merhaba.” Masachika el salladı.'
  );
  // Bare domains and URLs must not get stray spaces after dots
  assert.strictEqual(
    fixPunctuation('Lütfen lightnovelreader.me veya discord.gg/roshidere adresine bakın.'),
    'Lütfen lightnovelreader.me veya discord.gg/roshidere adresine bakın.'
  );

  const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'glossary.json'), 'utf8'));
  assert(!JSON.stringify(glossary).includes("'"), 'data/glossary.json must use curly apostrophes');
  console.log('  ✓ Closing-quote suffixes, spacing, and curly typography verified');
}

function testQualityScoreCalibration() {
  console.log('Testing quality.js calibrated scoring (no double-counting on -lı/-li/-lu/-lü bir şekilde)...');
  const { score } = require('../scripts/qc/quality');

  const plain = score('Bunu bir şekilde hallettik.');
  assert.strictEqual(plain.score, 2, `Expected 2 for plain "bir şekilde", got ${plain.score} (${plain.notes})`);

  for (const sample of [
    'Alisa kararlı bir şekilde cevap verdi.',
    'Ayano dikkatli bir şekilde dinledi.',
    'Maria mutlu bir şekilde gülümsedi.',
    'Masachika üzüntülü bir şekilde iç çekti.',
  ]) {
    const res = score(sample);
    assert.strictEqual(res.score, 3, `Expected 3 (no 2+3=5 double count) for "${sample}", got ${res.score} (${res.notes})`);
  }
  console.log('  ✓ quality.js calibrated penalties verified');
}

async function testChapterStitchingAndDeepL456FatalStop() {
  console.log('Testing paginate.js + translate3.js chapter cross-page stitching and DeepL HTTP 456 fatal stop...');
  const os = require('os');
  const paginate = require('../scripts/ingest/lib/paginate');
  const { stitchChapterPages, runTranslate } = require('../scripts/translate3');
  const { resolveVolume } = require('../scripts/lib/volumes');
  assert.strictEqual(typeof paginate.stitchChapterPages, 'function', 'paginate.js must own stitchChapterPages');
  assert.strictEqual(paginate.stitchChapterPages, stitchChapterPages, 'translate3.js must re-export paginate.stitchChapterPages');
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts45')), 'scripts45/ directory must remain retired');
  assert.strictEqual(resolveVolume('4.5').dataDir, 'data45', 'Unified pipeline must resolve Volume 4.5');

  const samplePages = [
    {
      page: 10,
      text: 'Chapter 1: Test Start Of Story\n\nMasachika walked down the long hallway and looked at the',
    },
    {
      page: 11,
      text: 'locked wooden door right in front of him.\n\n“Wait a second, isn’t this room',
    },
    {
      page: 12,
      text: 'supposed to be open every single day?”\n\nAlisa shrugged calmly beside the window.',
    },
    {
      page: 13,
      text: 'Chapter 2: Next Chapter Begins Here\n\nthis lowercase start must not merge across chapter boundary.',
    },
  ];

  const stitched = stitchChapterPages(samplePages);
  assert.deepStrictEqual(Object.keys(stitched), ['10', '11', '12', '13'], 'Must preserve numeric string page keys');
  assert.strictEqual(
    stitched['10'][1],
    'Masachika walked down the long hallway and looked at the locked wooden door right in front of him.',
    'Cross-page split sentence must stitch onto initiating page'
  );
  assert.strictEqual(
    stitched['11'][0],
    '“Wait a second, isn’t this room supposed to be open every single day?”',
    'Cross-page split quote must stitch onto initiating page'
  );
  assert.strictEqual(stitched['12'].length, 1, 'Continuation fragment removed from page 12 while preserving remaining paras');
  assert.strictEqual(stitched['13'].length, 2, 'Chapter boundary must prevent stitching across chapters');

  // DeepL HTTP 456 quota error must immediately abort without saving Google fallback
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-tr-test-'));
  const tmpSrc = path.join(tmpDir, 'source.json');
  const tmpOut = path.join(tmpDir, 'bilingual.json');
  fs.writeFileSync(tmpSrc, JSON.stringify(samplePages));

  let googleCalls = 0;
  try {
    await assert.rejects(
      async () => {
        await runTranslate({
          srcFile: tmpSrc,
          outFile: tmpOut,
          deeplKey: 'mock-key',
          batchSize: 2,
          batchDelayMs: 0,
          retryDelayMs: 0,
          silent: true,
          fetchImpl: async (url) => {
            if (String(url).includes('deepl')) {
              return { ok: false, status: 456, json: async () => ({}) };
            }
            googleCalls++;
            return { ok: true, status: 200, json: async () => ['Merhaba', 'Dünya'] };
          },
        });
      },
      (err) => err && err.status === 456,
      'Must reject immediately with HTTP 456 error'
    );
    assert.strictEqual(googleCalls, 0, 'Must not fall back to Google Translate after DeepL 456');
    const saved = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    assert.deepStrictEqual(saved, {}, 'Failed 456 batch must never be saved with Google fallback');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('  ✓ Chapter stitching and DeepL HTTP 456 fatal stop verified');
}

function testStrictZeroSplitQuotesAndVolumeQualityGates() {
  console.log('Testing zero KNOWN_PAGE_SPLIT_QUOTES, <0.12 mean penalty, <0.5% flagged, and 5-phase gating...');
  const { KNOWN_PAGE_SPLIT_QUOTES, VOLUMES, checkPhasePrerequisites } = require('../scripts/qc/cli');
  const { evaluateData } = require('../scripts/qc/quality');
  const { DETACHED_QUOTE_SUFFIX_RE } = require('../scripts/qc/qc1_punctuation');
  const { PHASES } = require('../scripts/lib/volumes');

  assert.strictEqual(KNOWN_PAGE_SPLIT_QUOTES['4'].size, 0, 'Vol 4 KNOWN_PAGE_SPLIT_QUOTES must be empty');
  assert.strictEqual(KNOWN_PAGE_SPLIT_QUOTES['4.5'].size, 0, 'Vol 4.5 KNOWN_PAGE_SPLIT_QUOTES must be empty');
  assert.strictEqual(VOLUMES['4'].maxAvgStrict, 0.12);
  assert.strictEqual(VOLUMES['4.5'].maxAvgStrict, 0.12);
  assert.deepStrictEqual(Object.keys(PHASES), ['1', '2', '3', '4', '5']);
  assert.deepStrictEqual(checkPhasePrerequisites(2, ROOT), [], 'Faz 1 prerequisites should pass for Faz 2');

  const detachedCheckRe = new RegExp(DETACHED_QUOTE_SUFFIX_RE.source, 'u');
  for (const [label, relPath] of [['Vol 4', 'data/paragraphs_final.json'], ['Vol 4.5', 'data45/paragraphs_final.json']]) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
    const qc = evaluateData(data);
    assert(qc.avg < 0.12, `${label} avg penalty ${qc.avg} must be < 0.12`);
    assert(qc.flagged / qc.total < 0.005, `${label} flagged share ${qc.flagged}/${qc.total} must be < 0.5%`);

    for (const [pg, arr] of Object.entries(data)) {
      if (arr.length > 0) {
        assert(!/^\p{Ll}/u.test(arr[0].trim()), `${label} page ${pg}.0 starts lowercase: ${arr[0]}`);
      }
      arr.forEach((t, idx) => {
        assert(!/\bO['’]n[ıi]n\b/u.test(t), `${label} ${pg}.${idx} has O’nin/O’nın: ${t}`);
        assert(!detachedCheckRe.test(t), `${label} ${pg}.${idx} has detached quote suffix: ${t}`);
      });
    }
  }
  console.log('  ✓ Zero split-quote exceptions, <0.12 avg, <0.5% flagged, and corpus cleanliness verified');
}

function createMockDocument() {
  function makeNode(nodeType, tagName, text) {
    const node = {
      nodeType,
      tagName: tagName || null,
      className: '',
      title: '',
      dataset: {},
      childNodes: [],
      appendChild(child) {
        this.childNodes.push(child);
        return child;
      },
      get textContent() {
        if (this.nodeType === 3) return text;
        return this.childNodes.map((c) => c.textContent).join('');
      },
      set innerHTML(_v) {
        throw new Error('Unsafe innerHTML assignment is forbidden in renderParagraph');
      },
    };
    return node;
  }
  return {
    createElement(tag) {
      return makeNode(1, String(tag).toUpperCase(), '');
    },
    createTextNode(str) {
      return makeNode(3, '#text', String(str));
    },
  };
}

function testRussianDialogueDomRendering() {
  console.log('Testing safe {…} Russian dialogue DOM rendering and XSS safety...');
  const { renderParagraph } = require(path.join(ROOT, 'public', 'app.js'));
  const doc = createMockDocument();

  // 1. Brace-initial Russian line strips braces and gets .dialog + .dialog-ru
  const pBrace = renderParagraph('{Denizanasından korkuyorum! Masa-kun, yardım et!}', doc);
  assert.strictEqual(pBrace.tagName, 'P');
  assert.strictEqual(pBrace.className, 'dialog dialog-ru', 'Brace-initial line must get dialog and dialog-ru');
  assert.strictEqual(pBrace.childNodes.length, 1);
  assert.strictEqual(pBrace.childNodes[0].tagName, 'SPAN');
  assert.strictEqual(pBrace.childNodes[0].className, 'ru-dialog');
  assert.strictEqual(pBrace.textContent, 'Denizanasından korkuyorum! Masa-kun, yardım et!');
  assert(!pBrace.textContent.includes('{') && !pBrace.textContent.includes('}'), 'Raw braces must be stripped');

  // 2. Quote-initial line with inline {…} keeps .dialog (without .dialog-ru)
  const pQuote = renderParagraph('“Geçen gün Rusça {onlara dokunabilirsin} dememiş miydin…?”', doc);
  assert.strictEqual(pQuote.className, 'dialog', 'Quote-initial line must keep standard .dialog');
  assert.strictEqual(pQuote.childNodes.length, 3);
  assert.strictEqual(pQuote.childNodes[1].tagName, 'SPAN');
  assert.strictEqual(pQuote.childNodes[1].className, 'ru-dialog');
  assert.strictEqual(pQuote.childNodes[1].textContent, 'onlara dokunabilirsin');

  // 3. Romanized tooltip data on {Sen daha güzelsin.}
  const pRoma = renderParagraph('{Sen daha güzelsin.} Bu fısıltı kayboldu.', doc);
  assert.strictEqual(pRoma.childNodes[0].dataset.ru, 'Ty krasivaya.');
  assert.strictEqual(pRoma.childNodes[0].title, 'Ty krasivaya.');

  // 4. XSS payload inside and outside {…} never invokes innerHTML or creates unexpected elements
  const xssInput = '{<img src=x onerror=alert(1)>} & <script>alert("xss")</script>';
  const pXss = renderParagraph(xssInput, doc);
  assert.strictEqual(pXss.childNodes.length, 2);
  assert.strictEqual(pXss.childNodes[0].tagName, 'SPAN');
  assert.strictEqual(pXss.childNodes[0].childNodes.length, 1);
  assert.strictEqual(pXss.childNodes[0].childNodes[0].nodeType, 3, 'Span child must be a pure TextNode');
  assert.strictEqual(pXss.childNodes[0].textContent, '<img src=x onerror=alert(1)>');
  assert.strictEqual(pXss.childNodes[1].nodeType, 3, 'Trailing content must be a pure TextNode');
  assert.strictEqual(pXss.childNodes[1].textContent, ' & <script>alert("xss")</script>');

  // 5. Unmatched '{' falls back safely to plain text via createTextNode (standalone and before valid span)
  const pUnmatched = renderParagraph('{Kapanmamış süslü parantez', doc);
  assert.strictEqual(pUnmatched.className, 'dialog dialog-ru');
  assert.strictEqual(pUnmatched.childNodes.length, 1);
  assert.strictEqual(pUnmatched.childNodes[0].nodeType, 3);
  assert.strictEqual(pUnmatched.textContent, '{Kapanmamış süslü parantez');

  const pMixedUnmatched = renderParagraph('{açık {Merhaba}', doc);
  assert.strictEqual(pMixedUnmatched.childNodes.length, 2);
  assert.strictEqual(pMixedUnmatched.childNodes[0].nodeType, 3);
  assert.strictEqual(pMixedUnmatched.childNodes[0].textContent, '{açık ');
  assert.strictEqual(pMixedUnmatched.childNodes[1].tagName, 'SPAN');
  assert.strictEqual(pMixedUnmatched.childNodes[1].textContent, 'Merhaba');

  // 6. Parenthetical (…) inner monologue remains untouched plain text
  const pThought = renderParagraph('(Ondan hiç nefret etmiyordum.)', doc);
  assert.strictEqual(pThought.className, '');
  assert.strictEqual(pThought.childNodes.length, 1);
  assert.strictEqual(pThought.childNodes[0].nodeType, 3);
  assert.strictEqual(pThought.textContent, '(Ondan hiç nefret etmiyordum.)');

  // 7. Manifest + cilt parçaları bütünlüğü
  const bundleContent = fs.readFileSync(path.join(ROOT, 'public', 'bundle.js'), 'utf8');
  const manifestMatch = bundleContent.match(/window\.ALYA_BUNDLE=(\{.*\});/);
  assert(manifestMatch, 'bundle.js must define window.ALYA_BUNDLE manifest');
  const manifest = JSON.parse(manifestMatch[1]);
  assert(manifest.vols['4'] && manifest.vols['4'].total > 0, 'manifest must list Cilt 4');
  assert(manifest.vols['12'] && manifest.vols['12'].total > 0, 'manifest must list Cilt 12');
  assert(!manifest.vols['4'].pages, 'manifest must not embed full page data');

  const booksDir = path.join(ROOT, 'public', 'books');
  if (!fs.existsSync(booksDir)) {
    console.log('  (books/ yok — parça denetimi atlandı, npm run build:bundle ile üretilir)');
  }
  const volFiles = fs.existsSync(booksDir)
    ? fs.readdirSync(booksDir).filter((f) => f.endsWith('.json') && !f.startsWith('art-'))
    : [];
  if (fs.existsSync(booksDir)) assert(volFiles.length >= 11, 'public/books must contain one chunk per volume');

  const vol4 = JSON.parse(fs.readFileSync(path.join(booksDir, 'v4.json'), 'utf8'));
  const flat4 = vol4.pages.flatMap((p) => p.tr);
  assert(flat4.some((x) => String(x).includes('{Denizanasından korkuyorum! Masa-kun, yardım et!}')), 'v4.json must contain repaired 149.4');
  assert(flat4.some((x) => String(x).includes('{Sen daha güzelsin.}')), 'v4.json must contain repaired 267.2');

  const art4 = JSON.parse(fs.readFileSync(path.join(booksDir, 'art-4.json'), 'utf8'));
  assert(Object.keys(art4).length > 0 && art4['004'].startsWith('data:image/webp'), 'art-4.json must embed WebP data URIs');

  for (const file of volFiles) {
    const book = JSON.parse(fs.readFileSync(path.join(booksDir, file), 'utf8'));
    for (const pg of book.pages) {
      for (const line of pg.tr) {
        assert(!/[『』「」]/.test(line), `${file} p.${pg.n} tr must not contain corner brackets`);
        assert(!/\p{Script=Cyrillic}/u.test(line), `${file} p.${pg.n} tr must not contain Cyrillic`);
      }
    }
  }

  console.log('  ✓ Safe {…} DOM spans, tooltip metadata, unmatched brace fallback, volume chunk integrity, and XSS resistance verified');
}

function testIntentionalUnbalancedDelimiters() {
  console.log('Testing unbalanced {…} and […] delimiter checks in CLI and patch validator...');
  const { validatePatches } = require(PATCH_SCRIPT);
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const baseData = JSON.parse(orig);

    // 1. Unbalanced {…}
    const dBrace = JSON.parse(orig);
    dBrace['14'][0] += ' {Kapanmamış Rusça cümle';
    fs.writeFileSync(v4Path, JSON.stringify(dBrace));
    const resBrace = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resBrace.code, 1);
    assert(resBrace.out.includes('dengesiz süslü parantez'), 'Must report unbalanced curly brace');

    // 2. Unbalanced […]
    const dBracket = JSON.parse(orig);
    dBracket['14'][0] += ' [Kapanmamış köşeli parantez';
    fs.writeFileSync(v4Path, JSON.stringify(dBracket));
    const resBracket = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resBracket.code, 1);
    assert(resBracket.out.includes('dengesiz köşeli parantez'), 'Must report unbalanced square bracket');

    // 3. Patch validation rejects unbalanced {…} and […] and reversed delimiters
    assert.strictEqual(validatePatches({ '14.0': '{Açık kaldı' }, baseData).ok, false);
    assert.strictEqual(validatePatches({ '14.0': '}Ters süslü{' }, baseData).ok, false);
    assert.strictEqual(validatePatches({ '14.0': '[Açık köşeli' }, baseData).ok, false);
    assert.strictEqual(validatePatches({ '14.0': ']Ters köşeli[' }, baseData).ok, false);

    console.log('  ✓ Unbalanced {…} and […] delimiters caught with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

function testIntentionalCornerQuotesAndCyrillic() {
  console.log('Testing leaked 『』「」 corner brackets and Cyrillic checks...');
  const { validatePatches } = require(PATCH_SCRIPT);
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    const baseData = JSON.parse(orig);

    // 1. Leaked Japanese corner brackets 『…』
    const dCorner = JSON.parse(orig);
    dCorner['14'][0] += ' 『Japonca tırnak sızıntısı』';
    fs.writeFileSync(v4Path, JSON.stringify(dCorner));
    const resCorner = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resCorner.code, 1);
    assert(resCorner.out.includes('Japonca köşe tırnağı'), 'Must report leaked corner brackets');

    // 2. Leaked Cyrillic characters
    const dCyr = JSON.parse(orig);
    dCyr['14'][0] += ' “Ты красивая.”';
    fs.writeFileSync(v4Path, JSON.stringify(dCyr));
    const resCyr = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resCyr.code, 1);
    assert(resCyr.out.includes('Kiril kalıntısı'), 'Must report Cyrillic residue');

    // 3. Patch validation rejects 『』「」 and Cyrillic
    assert.strictEqual(validatePatches({ '14.0': '『Test』' }, baseData).ok, false);
    assert.strictEqual(validatePatches({ '14.0': '「Test」' }, baseData).ok, false);
    assert.strictEqual(validatePatches({ '14.0': '“Привет”' }, baseData).ok, false);

    console.log('  ✓ Leaked 『』「」 and Cyrillic text caught with code 1');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
}

async function runAll() {
  console.log('=== Starting QC CLI and Matrix Verification Tests ===\n');
  testCleanPass();
  testRussianDialogueDomRendering();
  testTurkishDotlessCharacters();
  testIntentionalEnglishResidue();
  testIntentionalUnclosedQuote();
  testIntentionalTranslatorNote();
  testIntentionalUnbalancedDelimiters();
  testIntentionalCornerQuotesAndCyrillic();
  testPatchValidationAndRegression();
  testScoreRegressionGate();
  testSchemaValidation();
  testNaturalizeUnicodeBoundariesAndNotes();
  testQc10StartsApostropheSafety();
  testQc1PunctuationQuoteSuffixesAndSpacing();
  testQualityScoreCalibration();
  await testChapterStitchingAndDeepL456FatalStop();
  testStrictZeroSplitQuotesAndVolumeQualityGates();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
