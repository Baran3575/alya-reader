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

    const cnData = JSON.parse(orig);
    cnData['14'][0] += ' (ÇN: Türkçe çevirmen notu meşrudur.)';
    fs.writeFileSync(v4Path, JSON.stringify(cnData));
    const cnRes = runCLI(['--volume', '4', '--strict'], true);
    assert(cnRes.out.includes('çevirmen notu            0'), 'Legitimate Turkish ÇN note must pass');
    console.log('  ✓ Translator note caught with code 1 and legitimate ÇN note allowed');
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
  console.log('Testing chunked art-*.json preservation and pruning during bundle rebuild...');
  const artPath = path.join(ROOT, 'public', 'bundle-art.js');
  const bundlePath = path.join(ROOT, 'public', 'bundle.js');
  const booksDir = path.join(ROOT, 'public', 'books');
  const beforeArt = fs.readFileSync(artPath, 'utf8');
  const beforeBundle = fs.readFileSync(bundlePath, 'utf8');
  const hadBooksDir = fs.existsSync(booksDir);
  const beforeArt4 = fs.existsSync(path.join(booksDir, 'art-4.json'))
    ? fs.readFileSync(path.join(booksDir, 'art-4.json'), 'utf8')
    : null;
  const beforeArt45 = fs.existsSync(path.join(booksDir, 'art-4.5.json'))
    ? fs.readFileSync(path.join(booksDir, 'art-4.5.json'), 'utf8')
    : null;

  try {
    const dummyUri = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const b4 = buildBook({ volKey: '4', dataDir: 'data', imgPrefix: '/pages/', volume: 'Cilt 4', artMap: { '4': { '001': dummyUri } } });
    const b45 = buildBook({ volKey: '4.5', dataDir: 'data45', imgPrefix: '/pages45/', volume: 'Cilt 4.5', artMap: { '4.5': { '001': dummyUri } } });
    const valid4 = Object.fromEntries(b4.pages.filter((p) => p.art).map((p) => [String(p.n).padStart(3, '0'), dummyUri]));
    const valid45 = Object.fromEntries(b45.pages.filter((p) => p.art).map((p) => [String(p.n).padStart(3, '0'), dummyUri]));
    assert(Object.keys(valid4).length >= 15, 'Vol 4 should have at least 15 valid illustration pages');
    assert(Object.keys(valid45).length >= 15, 'Vol 4.5 should have at least 15 valid illustration pages');

    // Seed chunked art files including misflagged art:false entry "282"
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(path.join(booksDir, 'art-4.json'), JSON.stringify({ ...valid4, '282': dummyUri }));
    fs.writeFileSync(path.join(booksDir, 'art-4.5.json'), JSON.stringify(valid45));

    // Rebuild twice without local public/pages scans: valid entries must survive both builds and "282" must be pruned
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build_bundle.js')], { cwd: ROOT, encoding: 'utf8' });
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build_bundle.js')], { cwd: ROOT, encoding: 'utf8' });

    const parsedAfter = readBundleArt(artPath);
    assert.strictEqual(Object.keys(parsedAfter['4'] || {}).length, Object.keys(valid4).length, 'All valid Vol 4 illustrations must be preserved');
    assert.strictEqual(Object.keys(parsedAfter['4.5'] || {}).length, Object.keys(valid45).length, 'All valid Vol 4.5 illustrations must be preserved');
    assert(!parsedAfter['4']['282'], 'art:false entry 282 must be pruned on rebuild');
    console.log('  ✓ Chunked art-*.json preservation across rebuilds and art:false pruning verified');
  } finally {
    fs.writeFileSync(artPath, beforeArt);
    fs.writeFileSync(bundlePath, beforeBundle);
    if (!hadBooksDir) {
      fs.rmSync(booksDir, { recursive: true, force: true });
    } else {
      if (beforeArt4 !== null) fs.writeFileSync(path.join(booksDir, 'art-4.json'), beforeArt4);
      else fs.rmSync(path.join(booksDir, 'art-4.json'), { force: true });
      if (beforeArt45 !== null) fs.writeFileSync(path.join(booksDir, 'art-4.5.json'), beforeArt45);
      else fs.rmSync(path.join(booksDir, 'art-4.5.json'), { force: true });
    }
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

  // Verify ingestion-stage frontmatter / header-footer gates in fliphtml5.js and epub11.js
  const { isCreditsOrTocPage, cleanFlipPageText } = require('../scripts/ingest/adapters/fliphtml5');
  const { isBoilerplateParagraph } = require('../scripts/ingest/adapters/epub11');
  const expectedCreditPages = {
    data5: new Set(),
    data6: new Set([6]),
    data7: new Set([5]),
    data8: new Set([6]),
    data9: new Set([7]),
    data10: new Set([6, 7, 249]),
  };
  for (const [dir, creditSet] of Object.entries(expectedCreditPages)) {
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'source.json'), 'utf8'));
    for (const pg of src) {
      if (!String(pg.text || '').trim()) continue;
      if (creditSet.has(pg.page)) {
        assert.strictEqual(isCreditsOrTocPage(pg.text), true, `${dir} p.${pg.page} fan credit/backmatter must be caught at ingest`);
        assert.strictEqual(cleanFlipPageText(pg.text), '', `${dir} p.${pg.page} cleanFlipPageText must return empty`);
      } else {
        assert.strictEqual(isCreditsOrTocPage(pg.text), false, `${dir} p.${pg.page} story page must not be false-positively dropped`);
      }
    }
  }
  const sampleProse =
    '“Good morning, Masachika-kun.” Alya greeted him from the window seat with her usual composed expression, though the tips of her silver hair caught the morning light as she quietly turned the next page of her notebook and waited for his reply in the empty classroom.';
  const sampleHeaderFooterPage = [
    'Page 14 | Alya Sometimes Hides Her Feelings in Russian',
    'Goldenagato | https://mp4directs.com',
    sampleProse,
    'Glucose Translations 14',
    '14',
  ].join('\n');
  assert.strictEqual(cleanFlipPageText(sampleHeaderFooterPage), sampleProse);
  assert.strictEqual(isBoilerplateParagraph('Do not reupload our chapters behind ad-link shorteners or ko-fi links.'), true);
  assert.strictEqual(isBoilerplateParagraph('“Good morning, Masachika-kun.”'), false);

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
  } else {
    const volFiles = fs.readdirSync(booksDir).filter((f) => f.endsWith('.json') && !f.startsWith('art-'));
    assert(volFiles.length >= 11, 'public/books must contain one chunk per volume');

    const vol4 = JSON.parse(fs.readFileSync(path.join(booksDir, 'v4.json'), 'utf8'));
    const flat4 = vol4.pages.flatMap((p) => p.tr);
    assert(flat4.some((x) => String(x).includes('{Denizanasından korkuyorum! Masa-kun, yardım et!}')), 'v4.json must contain repaired 149.4');
    assert(flat4.some((x) => String(x).includes('{Sen daha güzelsin.}')), 'v4.json must contain repaired 267.2');

    const art4Path = path.join(booksDir, 'art-4.json');
    if (fs.existsSync(art4Path)) {
      const art4 = JSON.parse(fs.readFileSync(art4Path, 'utf8'));
      assert(Object.keys(art4).length > 0 && art4['004'].startsWith('data:image/webp'), 'art-4.json must embed WebP data URIs');
    }

    for (const file of volFiles) {
      const book = JSON.parse(fs.readFileSync(path.join(booksDir, file), 'utf8'));
      for (const pg of book.pages) {
        for (const line of pg.tr) {
          assert(!/[『』「」]/.test(line), `${file} p.${pg.n} tr must not contain corner brackets`);
          assert(!/\p{Script=Cyrillic}/u.test(line), `${file} p.${pg.n} tr must not contain Cyrillic`);
        }
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
  testArtFlagDetection();
  testBundleArtPreservation();
  testFrontmatterAndFanUrlLeaks();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
