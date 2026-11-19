// Automated verification for unified data/volumes.json manifest, server endpoints, bundle output, and CI matrix
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildBook, buildVolumesSummary, loadVolumes, server } = require('../server');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'data', 'volumes.json');

function fetchJson(port, reqPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: reqPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve({ status: res.statusCode, body });
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function testManifestSchema() {
  console.log('Testing data/volumes.json schema and ordered Faz 1-5 entries...');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert(Array.isArray(manifest), 'data/volumes.json must be an ordered JSON array');

  const expectedIds = ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12'];
  assert.deepStrictEqual(
    manifest.map((v) => v.id),
    expectedIds,
    'Manifest must contain ordered entries 4 through 12'
  );

  const requiredFields = [
    'id',
    'label',
    'subtitle',
    'dataDir',
    'imgPrefix',
    'chaptersFile',
    'patchesFile',
    'maxAvgStrict',
    'status',
    'statusNote',
    'enabled',
  ];

  for (const entry of manifest) {
    for (const field of requiredFields) {
      assert(
        Object.prototype.hasOwnProperty.call(entry, field),
        `Volume ${entry.id} missing required field: ${field}`
      );
    }
    assert(entry.imgPrefix.startsWith('/pages'), `Volume ${entry.id} imgPrefix must start with /pages`);
  }

  const v12 = manifest.find((v) => v.id === '12');
  assert.strictEqual(v12.status, 'partial', 'Volume 12 must have partial status');
  assert(v12.statusNote.length > 0, 'Volume 12 must include a Turkish statusNote');
  console.log('  ✓ Manifest schema and 11 ordered entries verified');
}

function testBuildBookAndSummary() {
  console.log('Testing buildBook metadata and buildVolumesSummary...');
  const active = loadVolumes();
  assert(active['4'] && active['4.5'], 'Volumes 4 and 4.5 should be enabled');

  const b4 = buildBook(active['4']);
  assert.strictEqual(b4.id, '4');
  assert.strictEqual(b4.status, 'complete');
  assert.strictEqual(typeof b4.statusNote, 'string');

  // Verify partial volume metadata propagation
  const bPartial = buildBook({
    ...active['4'],
    id: '12',
    label: 'Cilt 12',
    status: 'partial',
    statusNote: 'Devam ediyor',
  });
  assert.strictEqual(bPartial.id, '12');
  assert.strictEqual(bPartial.status, 'partial');
  assert.strictEqual(bPartial.statusNote, 'Devam ediyor');

  const summary = buildVolumesSummary();
  assert.strictEqual(summary.length, 2);
  assert.strictEqual(summary[0].id, '4');
  assert(summary[0].chapterCount > 0 && summary[0].total > 0);
  assert.strictEqual(summary[1].id, '4.5');
  assert(summary[1].chapterCount > 0 && summary[1].total > 0);
  console.log('  ✓ buildBook and buildVolumesSummary verified');
}

async function testServerApiEndpoints() {
  console.log('Testing /api/volumes and /api/book HTTP endpoints...');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const volsRes = await fetchJson(port, '/api/volumes');
    assert.strictEqual(volsRes.status, 200);
    assert(Array.isArray(volsRes.body) && volsRes.body.length >= 2);
    assert.strictEqual(volsRes.body[0].id, '4');
    assert.strictEqual(volsRes.body[1].id, '4.5');

    const bookRes = await fetchJson(port, '/api/book?v=4.5');
    assert.strictEqual(bookRes.status, 200);
    assert.strictEqual(bookRes.body.id, '4.5');
    assert.strictEqual(bookRes.body.volume, 'Cilt 4.5');
    assert.strictEqual(bookRes.body.status, 'complete');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('  ✓ /api/volumes and /api/book endpoints verified');
}

function testBundleAndWorkflows() {
  console.log('Testing bundle output, retired qc.yml, and dynamic qc-matrix.yml...');
  const bundleHead = fs.readFileSync(path.join(ROOT, 'public', 'bundle.js'), 'utf8').slice(0, 2000);
  assert(bundleHead.includes('window.ALYA_VOLUMES='), 'public/bundle.js must define window.ALYA_VOLUMES');

  assert(!fs.existsSync(path.join(ROOT, '.github', 'workflows', 'qc.yml')), 'Duplicate qc.yml must be deleted');

  const matrixYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'qc-matrix.yml'), 'utf8');
  assert(matrixYml.includes('fromJSON('), 'qc-matrix.yml must derive volume matrix via fromJSON');
  assert(!matrixYml.includes("['4', '4.5']"), 'qc-matrix.yml must not hardcode volume array');

  const patchV4 = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'patch.js'), '--volume', '4', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert(patchV4.includes('✓'), 'patch.js --volume 4 --dry-run must succeed');

  const patchV45 = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'patch.js'), '--volume', '4.5', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert(patchV45.includes('✓'), 'patch.js --volume 4.5 --dry-run must succeed');

  const filesToCheck = [
    'server.js',
    'public/index.html',
    'public/style.css',
    'public/app.js',
    'public/sw.js',
    'scripts/build_bundle.js',
    'scripts/patch.js',
    'scripts/qc/cli.js',
    'scripts/qc/sent_align.js',
    'scripts/qc/bt_score.js',
    'scripts/qc/fidelity.js',
    '.github/workflows/qc-matrix.yml',
  ];
  for (const rel of filesToCheck) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert(!/\['4',\s*'4\.5'\]/.test(content), `${rel} must not hardcode ['4', '4.5']`);
    assert(!/vol\s*===\s*['"]4(?:\.5)?['"]\s*\?/.test(content), `${rel} must not contain binary volume path ternaries`);
    assert(!/pages45/.test(content), `${rel} must not hardcode pages45`);
  }
  console.log('  ✓ Bundle, CI workflows, patch volume resolution, and zero-hardcoding checks verified');
}

async function run() {
  console.log('=== Starting Unified Volume Manifest Tests ===\n');
  testManifestSchema();
  testBuildBookAndSummary();
  await testServerApiEndpoints();
  testBundleAndWorkflows();
  console.log('\n=== All Volume Manifest Tests Passed! ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
