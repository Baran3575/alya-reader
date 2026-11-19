// Disk önbelleği yardımcıları (.cache/ingest altında)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('../../lib/volumes');

const CACHE_ROOT = path.join(ROOT, '.cache', 'ingest');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function hashKey(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 24);
}

function cacheFilePath(namespace, key, ext = '.bin') {
  const safeKey = String(key).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) + '_' + hashKey(key) + ext;
  return path.join(ensureDir(path.join(CACHE_ROOT, namespace)), safeKey);
}

function readCacheBuffer(namespace, key, ext = '.bin') {
  const fp = cacheFilePath(namespace, key, ext);
  return fs.existsSync(fp) ? fs.readFileSync(fp) : null;
}

function writeCacheBuffer(namespace, key, buf, ext = '.bin') {
  const fp = cacheFilePath(namespace, key, ext);
  const tmp = fp + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, fp);
  return fp;
}

function readCacheJson(namespace, key) {
  const buf = readCacheBuffer(namespace, key, '.json');
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function writeCacheJson(namespace, key, data) {
  return writeCacheBuffer(namespace, key, Buffer.from(JSON.stringify(data, null, 2), 'utf8'), '.json');
}

module.exports = {
  CACHE_ROOT,
  ensureDir,
  hashKey,
  cacheFilePath,
  readCacheBuffer,
  writeCacheBuffer,
  readCacheJson,
  writeCacheJson,
};
