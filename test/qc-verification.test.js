// Automated verification of QC CLI, Schema, and Regression Gating
const { execFileSync, spawnSync } = require('child_process');
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

  // 2. Keep uppercase letters after stops in naturalize.js while preserving ordinals (2. cildinin)
  const nat = naturalize('“Hadi ama! İstemeden bakışlarım kaydı.” Bunun nedeni neydi? İstemeden 2. cildinin kapağına baktı.');
  assert(!/[!?]\s+[a-zçğıöşü]/u.test(nat), `Expected uppercase after stops, got: ${nat}`);
  assert(nat.includes('2. cildinin'), `Expected ordinal lowercase noun preserved, got: ${nat}`);

  // 3. No "O" pronoun injection in qc10_starts.js; repairs legacy O’nin
  const starts = processPageStarts([
    'Alisa pencereden dışarı baktı.',
    'Alisa ardından sessizce iç çekti.',
    'O’nin sesi titriyordu.',
  ]);
  assert.strictEqual(starts.paragraphs[1], 'Alisa ardından sessizce iç çekti.');
  assert.strictEqual(starts.paragraphs[2], 'Onun sesi titriyordu.');

  // 4. Context-aware curly quotes & detached suffixes (converting corner quotes, preserving chorus quotes and standalone ” ne / ” ya da)
  assert.strictEqual(
    orientCurlyQuotes('「Soryaa~! “ “Evet, klişe,” diye geçirdi.'),
    '“Soryaa~!” “Evet, klişe,” diye geçirdi.'
  );
  assert.strictEqual(
    orientCurlyQuotes('“Sadece 『Acı verici görünüyor 』 diye düşünüyordum.”'),
    '“Sadece ‘Acı verici görünüyor’ diye düşünüyordum.”'
  );
  assert.strictEqual(
    orientCurlyQuotes('“”“ Affedersiniz.””'),
    '“Affedersiniz.”'
  );
  assert.strictEqual(
    orientCurlyQuotes('“”Bu süper mazoşist olmakla aynı şey değil mi?“”'),
    '“Bu süper mazoşist olmakla aynı şey değil mi?”'
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

  // audit_meaning.js stateless negation + number checks across consecutive lines
  const { auditMeaning } = require('../scripts/qc/audit_meaning');
  const meaningRows = auditMeaning(
    [
      {
        page: 1,
        text: [
          'She did not say anything while walking down the quiet corridor.',
          'He never looked back as he stepped out into the pouring rain.',
          'They waited 15 minutes in front of the station entrance.',
        ].join('\n'),
      },
    ],
    {
      '1': [
        'Sessiz koridorda yürürken hiçbir şey söylemedi.',
        'Sağanak yağmurun altına adım atarken arkasına asla bakmadı.',
        'İstasyon girişinin önünde yirmi dakika beklediler.',
      ],
    }
  );
  assert.strictEqual(meaningRows.length, 1, 'Consecutive valid negations must not false-positive; only missing 15 should flag');
  assert.strictEqual(meaningRows[0].type, 'number');

  // qc9_variety.js case-government check (genitive -> peşinden, ablative -> sonra)
  const tmpVarFile = path.join(ROOT, 'data', '_tmp_qc9_test.json');
  try {
    fs.writeFileSync(
      tmpVarFile,
      JSON.stringify({ '1': ['Sessizliğin ardından konuştu. Yemekten ardından kalktı. Selamlaşmanın ardından ayrıldı.'] })
    );
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/qc/qc9_variety.js')], {
      cwd: ROOT,
      env: { ...process.env, ALYA_TR_FILE: tmpVarFile },
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0);
    const outVar = JSON.parse(fs.readFileSync(tmpVarFile, 'utf8'))['1'][0];
    assert(!/nın sonra|nin sonra/u.test(outVar), `Genitive + sonra must never be generated: ${outVar}`);
    assert(outVar.includes('peşinden'), `Genitive + ardından should alternate to peşinden: ${outVar}`);
  } finally {
    if (fs.existsSync(tmpVarFile)) fs.unlinkSync(tmpVarFile);
  }

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

  // 7. Bundle and bundle-art integrity check
  const artStat = fs.statSync(path.join(ROOT, 'public', 'bundle-art.js'));
  assert(artStat.size > 1000000, 'public/bundle-art.js must retain embedded WebP data URIs');
  const bundleContent = fs.readFileSync(path.join(ROOT, 'public', 'bundle.js'), 'utf8');
  assert(bundleContent.includes('{Denizanasından korkuyorum! Masa-kun, yardım et!}'), 'bundle.js must contain repaired 149.4');
  assert(bundleContent.includes('{Sen daha güzelsin.}'), 'bundle.js must contain repaired 267.2');
  const bundleMatch = bundleContent.match(/window\.ALYA_BUNDLE=(\{.*\});/);
  assert(bundleMatch, 'bundle.js must define window.ALYA_BUNDLE');
  const bundleJson = JSON.parse(bundleMatch[1]);
  for (const [volKey, book] of Object.entries(bundleJson.vols)) {
    for (const pg of book.pages) {
      for (const line of pg.tr) {
        assert(!/[『』「」]/.test(line), `bundle.js Vol ${volKey} p.${pg.n} tr must not contain corner brackets`);
        assert(!/\p{Script=Cyrillic}/u.test(line), `bundle.js Vol ${volKey} p.${pg.n} tr must not contain Cyrillic`);
      }
    }
  }

  console.log('  ✓ Safe {…} DOM spans, tooltip metadata, unmatched brace fallback, bundle integrity, and XSS resistance verified');
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

function runAll() {
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
  testPostProcessorRepairs();
  testCalqueScoringAndStrictZeroToleranceGates();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
