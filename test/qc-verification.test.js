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

function testMultiVolumeDiscoveryAndPatches() {
  console.log('Testing shared volumes.json registry, dynamic volume discovery, and per-volume patches...');
  const os = require('os');
  const vm = require('vm');
  const {
    getVolumeIds,
    getActiveVolumeIds,
    getVolume,
  } = require('../scripts/volumes');
  const { buildBook } = require('../server');
  const { buildBundles } = require('../scripts/build_bundle');

  // 1. All 11 volumes registered in volumes.json
  const allIds = getVolumeIds(ROOT);
  const expectedIds = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];
  assert.deepStrictEqual(allIds, expectedIds, 'volumes.json must register volumes 4 through 12 in order');
  assert.deepStrictEqual(getActiveVolumeIds(ROOT), expectedIds, 'All 11 volumes in repo should be active');

  // 2. Dynamic discovery in isolated temp root when adding data5/ and data95/
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alya-vols-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'volumes.json'), path.join(tmpRoot, 'volumes.json'));
    for (const dir of ['data', 'data5', 'data95']) {
      fs.mkdirSync(path.join(tmpRoot, dir), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRoot, dir, 'source.json'),
        JSON.stringify([
          { page: 1, text: 'Cover' },
          { page: 2, text: 'Prologue\nMasachika walked quietly into the council room today.' },
          { page: 3, text: 'Chapter 1: New Term\nAlisa looked over her notes carefully at her desk.' },
        ])
      );
      fs.writeFileSync(
        path.join(tmpRoot, dir, 'paragraphs_final.json'),
        JSON.stringify({
          '2': ['Önsöz', 'Masachika bugün öğrenci konseyi odasına sessizce girdi.'],
          '3': ['Alisa masasında notlarını dikkatle inceledi.'],
        })
      );
    }

    assert.deepStrictEqual(
      getActiveVolumeIds(tmpRoot),
      ['4', '5', '9.5'],
      'Adding source.json + paragraphs_final.json must automatically activate volumes'
    );

    // Build bundles in tmpRoot and verify manifest + chunks + zero p.en
    const built = buildBundles(tmpRoot);
    assert.deepStrictEqual(built.manifest.order, ['4', '5', '9.5']);
    for (const slug of ['4', '5', '9-5']) {
      const chunkFile = path.join(tmpRoot, 'public', 'bundles', `vol-${slug}.json`);
      assert(fs.existsSync(chunkFile), `Expected chunk vol-${slug}.json`);
      const chunk = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
      assert(chunk.pages.every((p) => !('en' in p)), `Chunk vol-${slug}.json must omit p.en`);
    }

    // Verify CLI discovers all 3 active volumes automatically
    const cliRes = runCLI(['--root', tmpRoot, '--strict'], true);
    assert(cliRes.out.includes('Cilt 4') && cliRes.out.includes('Cilt 5') && cliRes.out.includes('Cilt 9.5'));

    // Verify per-volume patches (valid vs regressing patch in data95/patches.json)
    const v95Cfg = getVolume('9.5', tmpRoot);
    fs.writeFileSync(
      v95Cfg.absPatchesFile,
      JSON.stringify({ '3.0': 'Alisa masasında ders notlarını dikkatle gözden geçirdi.' })
    );
    const patchDryOk = execFileSync(
      process.execPath,
      [PATCH_SCRIPT, '--root', tmpRoot, '--volume', '9.5', '--dry-run'],
      { cwd: ROOT, encoding: 'utf8' }
    );
    assert(patchDryOk.includes('Cilt 9.5 önizleme başarılı'), 'Valid per-volume patch should pass dry-run');

    fs.writeFileSync(
      v95Cfg.absPatchesFile,
      JSON.stringify({ '3.0': '"Düz tırnak ve that kelimesi" (ÇN: hata)' })
    );
    const badPatchCli = runCLI(['--root', tmpRoot, '--volume', '9.5', '--strict'], false);
    assert.strictEqual(badPatchCli.code, 1, 'Invalid per-volume patch in data95/patches.json must fail QC CLI');

    // Verify patch.js --dry-run succeeds cleanly when a volume has no patches.json
    const noPatchDry = execFileSync(
      process.execPath,
      [PATCH_SCRIPT, '--root', tmpRoot, '--volume', '5', '--dry-run'],
      { cwd: ROOT, encoding: 'utf8' }
    );
    assert(noPatchDry.includes('atlandı'), 'Missing optional per-volume patches.json should skip cleanly in dry-run');

    // 3. Heading detection with and without punctuation separators + p.en stripping
    const syntheticBook = buildBook({
      rootDir: tmpRoot,
      dataDir: 'data95',
      volume: 'Cilt 9.5',
      source: [
        { page: 1, text: '' },
        { page: 2, text: 'Prologue' },
        { page: 3, text: 'Chapter 1: Morning Tea\nMasachika sipped his tea quietly at his desk.' },
        { page: 4, text: 'Interlude: Rainy Window\nRain tapped softly against the classroom windowpane.' },
        { page: 5, text: 'Interlude Quiet Corridor\nFootsteps echoed down the empty school hallway.' },
        { page: 6, text: 'Side Story: Library Duty\nYuki smiled mischievously from across the table.' },
        { page: 7, text: 'Bonus SS Secret Notebook\nAlisa hid her notebook behind her back.' },
        { page: 8, text: 'Anecdote - Rooftop Breeze\nMaria hummed a gentle melody under the sky.' },
        { page: 9, text: 'Epilogue\nThe sun dipped below the horizon at last.' },
        { page: 10, text: 'Afterword\nThank you very much for picking up this volume.' },
        { page: 11, text: 'Afterword: Author Notes\nSee you again in the next volume soon.' },
      ],
      tr: {
        '2': ['Önsöz', 'Kısa giriş paragrafı.'],
        '3': ['Masachika masasında çayını sessizce yudumladı.'],
        '4': ['Yağmur sınıf penceresine usulca vuruyordu.'],
        '5': ['Boş okul koridorunda ayak sesleri yankılandı.'],
        '6': ['Yuki masanın karşısından muzipçe gülümsedi.'],
        '7': ['Alisa defterini arkasında sakladı.'],
        '8': ['Maria gökyüzünün altında yumuşak bir ezgi mırıldandı.'],
        '9': ['Güneş nihayet ufkun altına indi.'],
        '10': ['Bu cildi okuduğunuz için çok teşekkür ederim.'],
        '11': ['Bir sonraki ciltte görüşmek üzere.'],
      },
      titles: {},
    });

    assert(syntheticBook.pages.every((p) => !('en' in p)), 'buildBook() must strip p.en by default');
    const byPage = Object.fromEntries(syntheticBook.chapters.map((c) => [c.page, c]));
    assert.strictEqual(byPage[2].label, 'Önsöz');
    assert.strictEqual(byPage[3].label, 'Bölüm 1');
    assert.strictEqual(byPage[4].label, 'Ara Bölüm');
    assert.strictEqual(byPage[5].label, 'Ara Bölüm');
    assert.strictEqual(byPage[6].label, 'Ek Hikâye');
    assert.strictEqual(byPage[7].label, 'Ek Hikâye');
    assert.strictEqual(byPage[8].label, 'Ek Hikâye');
    assert.strictEqual(byPage[9].label, 'Sonsöz');
    assert.strictEqual(byPage[10].label, 'Sonsöz');
    assert.strictEqual(byPage[11].label, 'Sonsöz');

    // 4. Verify production bundles & standalone WebP art exist and omit p.en
    buildBundles(ROOT);
    const prodManifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'public', 'bundles', 'manifest.json'), 'utf8')
    );
    assert.deepStrictEqual(prodManifest.order, expectedIds);
    for (const id of prodManifest.order) {
      const m = prodManifest.volumes[id];
      const chunk = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', m.file), 'utf8'));
      assert(chunk.pages.every((p) => !('en' in p)), `Production ${m.file} must have zero p.en keys`);
      const artDir = path.join(ROOT, 'public', 'art', `vol-${m.slug}`);
      const webps = fs.readdirSync(artDir).filter((f) => f.endsWith('.webp'));
      assert(webps.length > 0, `Expected standalone .webp files in public/art/vol-${m.slug}/`);
    }

    // 5. Verify app.js purges legacy alya4:book* keys and keeps localStorage < 2048 bytes across 11 volumes
    const appSource = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    assert(!appSource.includes("'book:' +"), 'app.js must not write book:<v> to localStorage');
    assert(!appSource.includes("'bookver:' +"), 'app.js must not write bookver:<v> to localStorage');

    const store = new Map([
      ['alya4:book:4', 'x'.repeat(500000)],
      ['alya4:bookver:4', '"deadbeef"'],
      ['alya4:book:4.5', 'y'.repeat(500000)],
      ['alya4:vol', '"4"'],
      ['alya4:mode', '"text"'],
      ['alya4:theme', '"dark"'],
      ['alya4:size', '1.06'],
      ['alya4:page', '14'],
    ]);
    for (const v of expectedIds) {
      store.set(`alya4:page:${v}`, '42');
      store.set(`alya4:max:${v}`, '120');
    }
    const mockLS = {
      get length() {
        return store.size;
      },
      key(i) {
        return Array.from(store.keys())[i] || null;
      },
      getItem(k) {
        return store.has(k) ? store.get(k) : null;
      },
      setItem(k, v) {
        store.set(k, String(v));
      },
      removeItem(k) {
        store.delete(k);
      },
    };

    const elStub = () => ({
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      children: [],
      addEventListener() {},
      setAttribute() {},
      append() {},
      appendChild() {},
      querySelector: () => ({ removeAttribute() {}, setAttribute() {} }),
      querySelectorAll: () => [],
      contains: () => false,
      hidden: true,
      innerHTML: '',
      textContent: '',
      value: '4',
    });

    const elements = new Map();
    const getEl = (id) => {
      if (!elements.has(id)) elements.set(id, elStub());
      return elements.get(id);
    };

    const elevenManifest = {
      defaultVolume: '4',
      order: expectedIds,
      volumes: Object.fromEntries(
        expectedIds.map((id) => [
          id,
          { id, slug: id.replace(/\./g, '-'), label: `Cilt ${id}`, hash: 'abc123def456' },
        ])
      ),
    };

    const sandbox = {
      localStorage: mockLS,
      navigator: { onLine: true },
      location: { protocol: 'http:' },
      requestAnimationFrame: (fn) => fn(),
      Image: function () {},
      window: {
        matchMedia: () => ({ matches: false }),
        addEventListener() {},
        scrollTo() {},
        scrollY: 0,
        innerHeight: 800,
      },
      document: {
        getElementById: getEl,
        querySelector: () => ({ setAttribute() {} }),
        createElement: () => elStub(),
        createDocumentFragment: () => elStub(),
        createTextNode: (s) => ({ nodeType: 3, textContent: String(s) }),
        addEventListener() {},
        documentElement: { dataset: {}, style: { setProperty() {} } },
        body: { style: {} },
        title: '',
      },
      fetch: async (url) => {
        if (String(url).includes('manifest.json')) {
          return { ok: true, status: 200, json: async () => elevenManifest };
        }
        return { ok: true, status: 200, json: async () => syntheticBook };
      },
    };
    vm.runInNewContext(appSource, sandbox);

    const remainingKeys = Array.from(store.keys());
    assert(
      !remainingKeys.some((k) => k.startsWith('alya4:book')),
      'Legacy alya4:book* keys must be purged on startup'
    );
    assert.strictEqual(store.get('alya4:page:4'), '42', 'Existing reading progress must be preserved');
    const totalBytes = remainingKeys.reduce(
      (sum, k) => sum + Buffer.byteLength(k, 'utf8') + Buffer.byteLength(store.get(k), 'utf8'),
      0
    );
    assert(totalBytes < 2048, `Expected localStorage < 2048 bytes across 11 volumes, got ${totalBytes}`);
    console.log(`  ✓ Multi-volume discovery, headings, p.en stripping, patches & localStorage (${totalBytes} B < 2048 B) verified`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
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

  // 7. Manifest + tembel yüklenen cilt parçaları ve ikili WebP bütünlüğü
  const manifestPath = path.join(ROOT, 'public', 'bundles', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'public/bundles/manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.volumes['4'] && manifest.volumes['4'].total > 0, 'manifest must list Cilt 4');
  assert(manifest.volumes['12'] && manifest.volumes['12'].total > 0, 'manifest must list Cilt 12');
  assert(!manifest.volumes['4'].pages, 'manifest must not embed full page data');

  const bundlesDir = path.join(ROOT, 'public', 'bundles');
  const volFiles = fs
    .readdirSync(bundlesDir)
    .filter((f) => f.startsWith('vol-') && f.endsWith('.json'));
  assert(volFiles.length >= 11, 'public/bundles must contain one chunk per volume');

  const vol4 = JSON.parse(fs.readFileSync(path.join(bundlesDir, 'vol-4.json'), 'utf8'));
  const flat4 = vol4.pages.flatMap((p) => p.tr);
  assert(
    flat4.some((x) => String(x).includes('{Denizanasından korkuyorum! Masa-kun, yardım et!}')),
    'vol-4.json must contain repaired 149.4'
  );
  assert(
    flat4.some((x) => String(x).includes('{Sen daha güzelsin.}')),
    'vol-4.json must contain repaired 267.2'
  );

  const art4File = path.join(ROOT, 'public', 'art', 'vol-4', '004.webp');
  assert(fs.existsSync(art4File) && fs.statSync(art4File).size > 0, 'public/art/vol-4/004.webp must exist as binary WebP');

  for (const file of volFiles) {
    const book = JSON.parse(fs.readFileSync(path.join(bundlesDir, file), 'utf8'));
    for (const pg of book.pages) {
      assert(!('en' in pg), `${file} p.${pg.n} must omit p.en`);
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
  testMultiVolumeDiscoveryAndPatches();
  console.log('\n=== All Verification Tests Passed Successfully! ===');
}

runAll();
