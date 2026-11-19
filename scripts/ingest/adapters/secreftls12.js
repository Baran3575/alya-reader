// Cilt 12 SecreFTLs REST API adaptörü:
//  - Uç nokta: https://secreftls.com/api/books/alya-sometimes-hides-her-feelings-in-russian-volume-12/chapters
//  - id=158 (Illustrations), id=161 (Prologue), id=162 (Chapter 1) içeriğini ~1.400 kr/sayfa olarak sayfalar
//  - id=164 (Chapter 2 - Christmas Eve with Everyone) içindeki [Translation In Progress] durumunu tespit edip
//    sahte metin uydurmadan bölümü pending: true olarak işaretler.
const fs = require('fs');
const path = require('path');
const { ensureDir, readCacheJson, writeCacheJson, readCacheBuffer, writeCacheBuffer } = require('../lib/cache');
const { isFullPageIllustration, writeWebp } = require('../lib/webp');
const { paginateSections } = require('../lib/paginate');

const SECREFTLS_V12_URL =
  'https://secreftls.com/api/books/alya-sometimes-hides-her-feelings-in-russian-volume-12/chapters';
const SECREFTLS_ORIGIN = 'https://secreftls.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function decodeHtml(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function resolveAssetUrl(rawSrc) {
  const s = decodeHtml(rawSrc).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return new URL(s, SECREFTLS_ORIGIN).toString();
}

async function downloadImageAsset(url, { refresh = false } = {}) {
  if (!refresh) {
    const cached = readCacheBuffer('secreftls-img', url);
    if (cached && cached.length) return cached;
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: SECREFTLS_ORIGIN } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeCacheBuffer('secreftls-img', url, buf);
      return buf;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw new Error(`SecreFTLs görseli indirilemedi (${url}): ${lastErr && lastErr.message}`);
}

function parseChapterHeadingMeta(chapterTitle) {
  const raw = String(chapterTitle || '').trim();
  if (/^Illustrations$/i.test(raw)) {
    return { label: 'İllüstrasyonlar', enTitle: 'Illustrations', isIllustrations: true };
  }
  const m = raw.match(/^(Prologue|Epilogue|Afterword|Interlude|Chapter\s+\d+)\s*(?:[-:—–]\s*(.*))?$/i);
  if (m) {
    const head = m[1].trim();
    const sub = (m[2] || '').trim();
    let label = head;
    if (/^Prologue$/i.test(head)) label = 'Prolog';
    else if (/^Epilogue$/i.test(head)) label = 'Epilog';
    else if (/^Afterword$/i.test(head)) label = 'Sonsöz';
    else if (/^Interlude$/i.test(head)) label = 'Ara Bölüm';
    else if (/^Chapter\s+(\d+)$/i.test(head)) label = 'Bölüm ' + head.match(/\d+/)[0];
    return { label, enTitle: sub || label, isIllustrations: false };
  }
  return { label: 'Bölüm', enTitle: raw, isIllustrations: false };
}

function isTranslationInProgress(bodyHtml) {
  const plain = decodeHtml(String(bodyHtml || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (/\[\s*Translation\s+In\s+Progress\s*\]/i.test(plain)) return true;
  if (/Translation\s+In\s+Progress/i.test(plain) && plain.length < 240) return true;
  return false;
}

async function parseSecreftlsBodyFlow(chapter, opts = {}) {
  let html = String(chapter.body || '');

  // Satır içi dipnot balonlarını, sup dipnot numaralarını ve alt dipnot listelerini temizle
  html = html
    .replace(/<section[^>]*class=["'][^"']*footnotes[^"']*["'][\s\S]*?<\/section>/gi, '')
    .replace(/<div[^>]*class=["'][^"']*footnote[^"']*["'][\s\S]*?<\/div>/gi, '')
    .replace(/<span[^>]*class=["'][^"']*footnote[^"']*["'][\s\S]*?<\/span>/gi, '')
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<a[^>]*href=["']#fn[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '');

  const items = [];
  const seenUrls = new Set();

  // Eğer chapter.images dizisinde doğrudan URL/nesne varsa ve body'de yoksa yakala
  const pushImgUrl = async (rawSrc) => {
    const u = resolveAssetUrl(rawSrc);
    if (!u || seenUrls.has(u)) return;
    seenUrls.add(u);
    try {
      const buf = await downloadImageAsset(u, opts);
      if (isFullPageIllustration(buf, u)) {
        items.push({ type: 'art', asset: buf });
      }
    } catch (err) {
      console.warn(`  [uyarı] Görsel atlandı (${u}): ${err.message}`);
    }
  };

  const blockRe = /<(p|h[1-4]|blockquote|li|figure|img)\b([^>]*)>([\s\S]*?)<\/\1>|<(img)\b([^>]*?)\/?>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const tag = (m[1] || m[4] || '').toLowerCase();
    const attrStr = m[2] || m[5] || '';
    const inner = m[3] || '';

    if (tag === 'img') {
      const srcM = attrStr.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      if (srcM) await pushImgUrl(srcM[1]);
      continue;
    }

    // Blok içindeki <img> etiketlerini sırayla yakala
    const imgRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let im;
    while ((im = imgRe.exec(inner)) !== null) {
      await pushImgUrl(im[1]);
    }

    if (tag === 'figure' || /^h[1-4]$/.test(tag)) continue;

    const text = decodeHtml(
      inner
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\[\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (!text) continue;
    if (/^(?:Illustrations|Prologue|Chapter\s+\d+)\b/i.test(text) && text.length < 90 && items.length === 0) {
      continue;
    }
    items.push({ type: 'para', text });
  }

  if (Array.isArray(chapter.images)) {
    for (const img of chapter.images) {
      const u = typeof img === 'string' ? img : img && (img.url || img.src || img.image_url || img.path);
      if (u) await pushImgUrl(u);
    }
  }

  return items;
}

async function fetchSecreftlsChapters({ refresh = false } = {}) {
  if (!refresh) {
    const cached = readCacheJson('secreftls', 'vol12-chapters');
    if (cached && Array.isArray(cached)) return cached;
  }
  const res = await fetch(SECREFTLS_V12_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`SecreFTLs API hatası: HTTP ${res.status}`);
  }
  const payload = await res.json();
  const chapters = Array.isArray(payload) ? payload : payload.data || payload.chapters || [];
  if (!Array.isArray(chapters) || !chapters.length) {
    throw new Error('SecreFTLs API boş bölüm listesi döndürdü.');
  }
  writeCacheJson('secreftls', 'vol12-chapters', chapters);
  return chapters;
}

async function ingestSecreftls12(volCfg, opts = {}) {
  const apiChapters = await fetchSecreftlsChapters(opts);
  const sections = [];

  for (const ch of apiChapters) {
    const meta = parseChapterHeadingMeta(ch.chapter_title || ch.title || '');

    if (isTranslationInProgress(ch.body)) {
      console.log(
        `  [v12] Beklemede tespit edildi (id=${ch.id}): "${ch.chapter_title}" -> [Translation In Progress]`
      );
      sections.push({
        id: ch.id,
        label: meta.label,
        title: meta.enTitle,
        enTitle: meta.enTitle,
        pending: true,
        statusNote: 'Kaynak çeviri henüz tamamlanmadı ([Translation In Progress]).',
        items: [],
      });
      continue;
    }

    const items = await parseSecreftlsBodyFlow(ch, opts);
    if (!items.length) continue;

    const proseChars = items
      .filter((x) => x.type === 'para')
      .reduce((a, x) => a + x.text.length, 0);
    const artItems = items.filter((x) => x.type === 'art').length;
    console.log(
      `  [v12] Bölüm okundu (id=${ch.id}): "${ch.chapter_title}" -> ${proseChars} kr, ${artItems} görsel`
    );

    sections.push({
      id: ch.id,
      label: meta.label,
      title: meta.isIllustrations ? 'İllüstrasyonlar' : meta.enTitle,
      enTitle: meta.enTitle,
      pending: false,
      items,
    });
  }

  const { pages, chaptersMeta } = paginateSections(sections, {
    imgPrefix: volCfg.imgPrefix,
    targetChars: 1400,
    minProseChars: 240,
  });

  const imgOutDir = path.join(path.dirname(volCfg.sourceFile), '..', volCfg.imgDir);
  ensureDir(imgOutDir);
  for (const f of fs.readdirSync(imgOutDir)) {
    if (f.endsWith('.webp')) fs.unlinkSync(path.join(imgOutDir, f));
  }

  for (const p of pages) {
    if (p._artAsset) {
      const fileName = `${String(p.page).padStart(3, '0')}.webp`;
      writeWebp(p._artAsset, path.join(imgOutDir, fileName));
      delete p._artAsset;
    }
  }

  ensureDir(path.dirname(volCfg.sourceFile));
  fs.writeFileSync(volCfg.sourceFile, JSON.stringify(pages, null, 2));
  fs.writeFileSync(volCfg.titlesFile, JSON.stringify(chaptersMeta, null, 2));

  const artCount = pages.filter((p) => !p.text && !p.pending).length;
  const pendingCount = chaptersMeta.chapters.filter((c) => c.pending).length;
  console.log(
    `✓ Cilt 12 alındı: ${pages.length} sayfa (${artCount} illüstrasyon, ${chaptersMeta.chapters.length} bölüm, ${pendingCount} beklemede).`
  );
  return { pages, chaptersMeta };
}

module.exports = {
  SECREFTLS_V12_URL,
  isTranslationInProgress,
  parseChapterHeadingMeta,
  ingestSecreftls12,
};
