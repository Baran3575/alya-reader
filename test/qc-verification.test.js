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
    data['14'][0] += ' (TN: This is a leftover translator note.)';
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

  // Vol 4 Pages 103, 112, 118, 279 completeness (preserving existing hand-written sentences + appended omissions)
  assert.strictEqual(v4['103'].length, 13, 'Vol 4 page 103 must have 13 paragraphs');
  assert(v4['103'].join(' ').includes('Alya-san') && v4['103'].join(' ').includes('Yuki-san'), 'Vol 4 page 103 must restore Alya/Yuki dialogue');
  assert.strictEqual(v4['112'].length, 14, 'Vol 4 page 112 must have 14 paragraphs');
  assert.strictEqual(v4['118'].length, 16, 'Vol 4 page 118 must have 16 paragraphs');
  assert(v4['118'].join(' ').includes('2D') && v4['118'].join(' ').includes('Ayano'), 'Vol 4 page 118 must restore 2D joke and Ayano');
  assert.strictEqual(v4['255'].length, 12, 'Vol 4 page 255 must have all 12 paragraphs');
  assert(v4['255'].join(' ').includes('mikoshi') && v4['255'].join(' ').includes('Maria'), 'Vol 4 page 255 must restore mikoshi festival scene');
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
    data['118'].pop(); // Drop a single paragraph from page 118
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
  console.log('Testing merge.js empty { d, g } guard...');
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

    const scriptRel = 'scripts/merge.js';
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
    console.log('  ✓ merge.js fails with code 1 on empty bilingual entries');
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

function testHighWordRatioAndSevereNegationGates() {
  console.log('Testing high word-ratio bloat and severe negation divergence gates...');
  const v4Path = path.join(ROOT, 'data', 'paragraphs_final.json');
  const orig = fs.readFileSync(v4Path, 'utf8');
  try {
    // 1. High word-ratio bloat
    const bloated = JSON.parse(orig);
    bloated['103'] = bloated['103'].map((p) => `${p} ${p} ${p}`);
    fs.writeFileSync(v4Path, JSON.stringify(bloated));
    const resBloat = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resBloat.code, 1, 'High word-ratio bloat must exit with code 1');
    assert(resBloat.out.includes('yüksek kelime oranı'), 'Diagnostics must report high word ratio');

    // 2. Severe negation/meaning divergence (strip negations across a page with >=3 negative EN paragraphs)
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'source.json'), 'utf8'));
    const { hasEnNeg } = require('../scripts/qc/audit_meaning');
    const { paragraphs, stripTranslatorNotes } = require('../mt/paragraphs');
    const targetPage = src.find((p) => {
      const ep = paragraphs(p.text || '').map(stripTranslatorNotes).filter((s) => s.length > 40 && hasEnNeg(s));
      return ep.length >= 3;
    });
    assert(targetPage, 'Must find a source page with >=3 negative paragraphs');

    const negFlipped = JSON.parse(orig);
    const pk = String(targetPage.page);
    const namesKeep = ['Masachika', 'Alisa', 'Yuki', 'Ayano', 'Maria', 'Chisaki', 'Touya', 'Sayaka', 'Nonoa', 'Sarashina', 'Kuze', 'Kujou', 'Suou', 'Alya', 'Masha']
      .filter((n) => String(targetPage.text).includes(n))
      .join(' ');
    negFlipped[pk] = negFlipped[pk].map(
      (_, idx) =>
        `O gün güneşli odada ${namesKeep} birlikte oldukça sakin biçimde sohbet ederek pencereden dışarıdaki bulutları ve ağaçları dikkatle izliyordu ${idx + 1}.`
    );
    fs.writeFileSync(v4Path, JSON.stringify(negFlipped));
    const resNeg = runCLI(['--volume', '4', '--strict'], false);
    assert.strictEqual(resNeg.code, 1, 'Severe negation divergence must exit with code 1');
    assert(resNeg.out.includes('olumsuzluk/anlam sapması'), 'Diagnostics must report severe negation divergence');
    console.log('  ✓ High word-ratio bloat and severe negation divergence gates verified');
  } finally {
    fs.writeFileSync(v4Path, orig);
  }
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

  // 1. Brace-initial Russian line keeps braces and gets .dialog + .dialog-ru
  const pBrace = renderParagraph('{Denizanasından korkuyorum! Masa-kun, yardım et!}', doc);
  assert.strictEqual(pBrace.tagName, 'P');
  assert.strictEqual(pBrace.className, 'dialog dialog-ru', 'Brace-initial line must get dialog and dialog-ru');
  assert.strictEqual(pBrace.childNodes.length, 3, 'opening brace, span, closing brace');
  assert.strictEqual(pBrace.childNodes[1].tagName, 'SPAN');
  assert.strictEqual(pBrace.childNodes[1].className, 'ru-dialog');
  assert.strictEqual(pBrace.textContent, '{Denizanasından korkuyorum! Masa-kun, yardım et!}');
  assert(pBrace.textContent.includes('{') && pBrace.textContent.includes('}'), 'Braces must stay visible like the source');

  // 2. Quote-initial line with inline {…} keeps .dialog (without .dialog-ru)
  const pQuote = renderParagraph('“Geçen gün Rusça {onlara dokunabilirsin} dememiş miydin…?”', doc);
  assert.strictEqual(pQuote.className, 'dialog', 'Quote-initial line must keep standard .dialog');
  assert.strictEqual(pQuote.childNodes.length, 5, 'text, {, span, }, text');
  assert.strictEqual(pQuote.childNodes[2].tagName, 'SPAN');
  assert.strictEqual(pQuote.childNodes[2].className, 'ru-dialog');
  assert.strictEqual(pQuote.childNodes[2].textContent, 'onlara dokunabilirsin');
  assert.strictEqual(pQuote.textContent, '“Geçen gün Rusça {onlara dokunabilirsin} dememiş miydin…?”');

  // 3. Romanized tooltip data on {Sen daha güzelsin.}
  const pRoma = renderParagraph('{Sen daha güzelsin.} Bu fısıltı kayboldu.', doc);
  assert.strictEqual(pRoma.childNodes[1].dataset.ru, 'Ty krasivaya.');
  assert.strictEqual(pRoma.childNodes[1].title, 'Ty krasivaya.');

  // 4. XSS payload inside and outside {…} never invokes innerHTML or creates unexpected elements
  const xssInput = '{<img src=x onerror=alert(1)>} & <script>alert("xss")</script>';
  const pXss = renderParagraph(xssInput, doc);
  assert.strictEqual(pXss.childNodes.length, 4, '{, span, }, trailing text');
  assert.strictEqual(pXss.childNodes[1].tagName, 'SPAN');
  assert.strictEqual(pXss.childNodes[1].childNodes.length, 1);
  assert.strictEqual(pXss.childNodes[1].childNodes[0].nodeType, 3, 'Span child must be a pure TextNode');
  assert.strictEqual(pXss.childNodes[1].textContent, '<img src=x onerror=alert(1)>');
  assert.strictEqual(pXss.childNodes[3].nodeType, 3, 'Trailing content must be a pure TextNode');
  assert.strictEqual(pXss.childNodes[3].textContent, ' & <script>alert("xss")</script>');

  // 5. Unmatched '{' falls back safely to plain text via createTextNode (standalone and before valid span)
  const pUnmatched = renderParagraph('{Kapanmamış süslü parantez', doc);
  assert.strictEqual(pUnmatched.className, 'dialog dialog-ru');
  assert.strictEqual(pUnmatched.childNodes.length, 1);
  assert.strictEqual(pUnmatched.childNodes[0].nodeType, 3);
  assert.strictEqual(pUnmatched.textContent, '{Kapanmamış süslü parantez');

  const pMixedUnmatched = renderParagraph('{açık {Merhaba}', doc);
  assert.strictEqual(pMixedUnmatched.childNodes.length, 4);
  assert.strictEqual(pMixedUnmatched.childNodes[0].nodeType, 3);
  assert.strictEqual(pMixedUnmatched.childNodes[0].textContent, '{açık ');
  assert.strictEqual(pMixedUnmatched.childNodes[2].tagName, 'SPAN');
  assert.strictEqual(pMixedUnmatched.childNodes[2].textContent, 'Merhaba');

  // 6. Parenthetical (…) inner monologue keeps its words, marked as .thought
  const pThought = renderParagraph('(Ondan hiç nefret etmiyordum.)', doc);
  assert.strictEqual(pThought.className, 'thought');
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

function testCrossPageContinuationWordRatio() {
  console.log('Testing cross-page continuation word-ratio adjustment...');
  const { evaluateFidelity } = require(path.join(ROOT, 'scripts', 'qc', 'fidelity.js'));
  const mockSrc = [
    {
      page: 10,
      text: 'Masachika walked calmly across the courtyard with Yuki and Ayano beside him.\n"Actually, the part where a childhood',
    },
    {
      page: 11,
      text: 'friend for a very long time forcefully attacks the main character out of sheer jealousy is definitely the most moving part of all."\n"Wait, Masachika and Nonoa are walking towards our table right now!" Yuki whispered to Sayaka across the plaza.',
    },
  ];
  const mockTr = {
    '10': [
      'Masachika, yanında Yuki ve Ayano ile avluda sakince yürüdü.',
      '“Aslında uzun süreli çocukluk arkadaşının kıskançlıkla ana karaktere saldırması en dokunaklı kısımdır.”',
    ],
    '11': [
      '“Bekle, Masachika ile Nonoa şu an masamıza doğru yürüyor!” diye fısıldadı Yuki meydanın karşısından Sayaka’ya.',
    ],
  };
  const res = evaluateFidelity(mockSrc, mockTr, { volume: '4.5', minRatio: 0.55, minWordsForRatio: 15 });
  assert.strictEqual(res.droppedParaPages.length, 0, 'Cross-page carry must not flag dropped paragraph');
  assert.strictEqual(res.lowRatioPages.length, 0, 'Cross-page carry must adjust effective English word count');

  // Verify ellipsis lowercase line-wrap + inline dialogue+narration merge (like Vol 4.5 p.83)
  const mockInlineSrc = [
    {
      page: 83,
      text: '“Ah--yes!”\nAlisa accepted the offer without much thought. As a result, from now on Alisa and Ayano will undergo a long and painful training journey together, ...\nbut that’s a story for another time',
    },
  ];
  const mockInlineTr = {
    '83': [
      '“Ah— evet!” Alisa teklifi fazla düşünmeden kabul etti. Sonuç olarak bundan sonra Alisa ve Ayano birlikte uzun ve acılı bir eğitim yolculuğuna çıkacaklardı… ama o başka bir hikâye.',
    ],
  };
  const resInline = evaluateFidelity(mockInlineSrc, mockInlineTr, { volume: '4.5', minRatio: 0.55, minWordsForRatio: 15 });
  assert.strictEqual(resInline.droppedParaPages.length, 0, 'Inline quote+narration merge with intact ratio/quotes must not false-positive');

  const resDroppedQuote = evaluateFidelity(
    mockInlineSrc,
    {
      '83': [
        'Alisa teklifi fazla düşünmeden kabul etti. Sonuç olarak bundan sonra Alisa ve Ayano birlikte uzun ve acılı bir eğitim yolculuğuna çıkacaklardı… ama o başka bir hikâye.',
      ],
    },
    { volume: '4.5', minRatio: 0.55, minWordsForRatio: 15 }
  );
  assert.strictEqual(resDroppedQuote.droppedParaPages.length, 1, 'Dropping the dialogue quote must still flag dropped paragraph');
  console.log('  ✓ Cross-page continuation and inline quote+narration merge checks verified');
}

function runAll() {
  console.log('=== Starting QC CLI and Matrix Verification Tests ===\n');
  testCleanPass();
  testLiteraryRestorations();
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
  testDroppedParagraphFailsCLI();
  testLowWordRatioTruncatedPageFailsCLI();
  testMissingCharacterNameFailsCLI();
  testFabricatedPage30FailsCLI();
  testHighWordRatioAndSevereNegationGates();
  testCrossPageContinuationWordRatio();
  testMergeEmptyBilingualGuard();
  testAuditMeaningZeroSkippedPages();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
