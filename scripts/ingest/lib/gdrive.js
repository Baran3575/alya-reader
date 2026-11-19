// Herkese açık Google Drive klasör listeleme ve dosya indirme yardımcıları
const fs = require('fs');
const path = require('path');
const { readCacheBuffer, writeCacheBuffer, readCacheJson, writeCacheJson, ensureDir } = require('./cache');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

async function listDriveFolder(folderId, { refresh = false } = {}) {
  if (!refresh) {
    const cached = readCacheJson('gdrive-folders', folderId);
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  }

  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`Google Drive klasörü okunamadı (${folderId}): HTTP ${res.status}`);
  }
  const html = await res.text();
  const entries = [];

  // flip-entry bloklarını ayrıştır
  const entryRe = /<div[^>]*class=["'][^"']*flip-entry[^"']*["'][^>]*id=["']entry-([A-Za-z0-9_-]+)["'][\s\S]*?<a[^>]*href=["']([^"']+)["'][\s\S]*?<div[^>]*class=["']flip-entry-title["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = entryRe.exec(html)) !== null) {
    const id = m[1];
    const href = decodeHtmlEntities(m[2]);
    const name = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, '').trim());
    const isFolder = /\/drive\/folders\//.test(href);
    entries.push({ id, name, type: isFolder ? 'folder' : 'file', href });
  }

  // Yedek ayrıştırıcı (embeddedfolderview şablonu değişirse)
  if (!entries.length) {
    const linkRe = /<a[^>]*href=["']https:\/\/drive\.google\.com\/(file\/d|drive\/folders)\/([A-Za-z0-9_-]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = linkRe.exec(html)) !== null) {
      const type = m[1] === 'drive/folders' ? 'folder' : 'file';
      const id = m[2];
      const titleMatch = m[3].match(/class=["']flip-entry-title["'][^>]*>([\s\S]*?)<\/div>/i);
      const name = decodeHtmlEntities((titleMatch ? titleMatch[1] : m[3]).replace(/<[^>]+>/g, '').trim());
      if (id && name) entries.push({ id, name, type });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (entries.length) writeCacheJson('gdrive-folders', folderId, entries);
  return entries;
}

async function downloadDriveBuffer(fileId, { refresh = false } = {}) {
  if (!refresh) {
    const cached = readCacheBuffer('gdrive-files', fileId);
    if (cached && cached.length > 0) return cached;
  }

  const baseUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  let res = await fetch(baseUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Google Drive dosyası indirilemedi (${fileId}): HTTP ${res.status}`);
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  let buf = Buffer.from(await res.arrayBuffer());

  // Büyük dosyalarda virüs tarama onay sayfası dönerse form parametrelerini takip et
  if (ct.includes('text/html') && buf.length < 250000) {
    const html = buf.toString('utf8');
    const actionMatch = html.match(/<form[^>]*id=["']download-form["'][^>]*action=["']([^"']+)["']/i);
    if (actionMatch) {
      const confirmUrl = new URL(decodeHtmlEntities(actionMatch[1]));
      const inputRe = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi;
      let im;
      while ((im = inputRe.exec(html)) !== null) {
        confirmUrl.searchParams.set(im[1], decodeHtmlEntities(im[2]));
      }
      res = await fetch(confirmUrl.toString(), { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`Google Drive onay indirmesi başarısız (${fileId}): HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    }
  }

  writeCacheBuffer('gdrive-files', fileId, buf);
  return buf;
}

async function downloadDriveFile(fileId, destPath, opts = {}) {
  const buf = await downloadDriveBuffer(fileId, opts);
  if (destPath) {
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, buf);
  }
  return buf;
}

module.exports = {
  listDriveFolder,
  downloadDriveBuffer,
  downloadDriveFile,
};
