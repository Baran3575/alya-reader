// EPUB paket ayrıştırıcı: OPF omurgasını (spine), XHTML metinlerini ve tam sayfa illüstrasyonları okur
const path = require('path');
const { readZipEntries } = require('./zip');
const { isFullPageIllustration } = require('./webp');

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function resolveZipPath(baseDir, relHref) {
  const cleanHref = decodeURIComponent(String(relHref || '').split('#')[0].split('?')[0]);
  return path.posix.normalize(baseDir ? path.posix.join(baseDir, cleanHref) : cleanHref).replace(/^\/+/, '');
}

function parseAttributes(tagText) {
  const attrs = {};
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagText)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] !== undefined ? m[2] : m[3]);
  }
  return attrs;
}

function parseEpubPackage(epubBuffer) {
  const entries = readZipEntries(epubBuffer);

  // 1) META-INF/container.xml üzerinden OPF yolunu bul
  let opfPath = '';
  const containerEntry = entries.get('META-INF/container.xml');
  if (containerEntry) {
    const containerXml = containerEntry.getData().toString('utf8');
    const m = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (m) opfPath = m[1];
  }
  if (!opfPath) {
    for (const k of entries.keys()) {
      if (k.toLowerCase().endsWith('.opf')) {
        opfPath = k;
        break;
      }
    }
  }
  if (!opfPath || !entries.has(opfPath)) {
    throw new Error('EPUB içinde OPF manifest dosyası bulunamadı.');
  }

  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath);
  const opfXml = entries.get(opfPath).getData().toString('utf8');

  // 2) Manifest öğelerini oku
  const manifest = new Map();
  const itemRe = /<item\b([^>]*?)\/?>/gi;
  let m;
  while ((m = itemRe.exec(opfXml)) !== null) {
    const attrs = parseAttributes(m[1]);
    if (attrs.id && attrs.href) {
      manifest.set(attrs.id, {
        id: attrs.id,
        href: attrs.href,
        zipPath: resolveZipPath(opfDir, attrs.href),
        mediaType: attrs['media-type'] || '',
        properties: attrs.properties || '',
      });
    }
  }

  // 3) Spine sırasını oku
  const spineIds = [];
  const itemrefRe = /<itemref\b([^>]*?)\/?>/gi;
  while ((m = itemrefRe.exec(opfXml)) !== null) {
    const attrs = parseAttributes(m[1]);
    if (attrs.idref) spineIds.push(attrs.idref);
  }

  const spineDocs = [];
  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item) continue;
    const entry = entries.get(item.zipPath);
    if (!entry) continue;
    if (/xhtml|html|xml/i.test(item.mediaType) || /\.(?:xhtml|html|htm)$/i.test(item.zipPath)) {
      spineDocs.push({
        id: item.id,
        href: item.href,
        zipPath: item.zipPath,
        xhtml: entry.getData().toString('utf8'),
      });
    }
  }

  return { entries, opfPath, opfDir, manifest, spineDocs };
}

/**
 * Bir XHTML belgesindeki blokları (başlıklar, paragraflar, tam sayfa görseller) okuma sırasıyla çıkarır.
 */
function extractXhtmlFlow(xhtml, docZipPath, entries, seenImages = new Set()) {
  const docDir = path.posix.dirname(docZipPath) === '.' ? '' : path.posix.dirname(docZipPath);

  // Başlık (<title> veya ilk <h1>/<h2>/<h3>)
  const titleMatch = xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const docTitle = titleMatch ? decodeXmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : '';

  // <head>, <style>, <script> ve dipnot aside bloklarını çıkar
  let body = xhtml
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<aside[^>]*epub:type=["']footnote["'][\s\S]*?<\/aside>/gi, '');

  // Dipnot referans linklerini (<a epub:type="noteref"...>[1]</a> veya <sup>[1]</sup>) temizle
  body = body
    .replace(/<sup[^>]*>\s*<a[^>]*>\[?\d+\]?<\/a>\s*<\/sup>/gi, '')
    .replace(/<a[^>]*epub:type=["']noteref["'][^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<a[^>]*href=["']#fn[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '');

  const items = [];
  let heading = '';

  // Görsel veya metin bloklarını sırayla yakala
  const tokenRe = /<(h[1-4]|p|div|li|blockquote|img|image)\b([^>]*)>([\s\S]*?)<\/\1>|<(img|image|hr)\b([^>]*?)\/?>/gi;
  let m;
  while ((m = tokenRe.exec(body)) !== null) {
    const tag = (m[1] || m[4] || '').toLowerCase();
    const attrStr = m[2] || m[5] || '';
    const inner = m[3] || '';

    if (tag === 'img' || tag === 'image') {
      const attrs = parseAttributes(attrStr);
      const src = attrs.src || attrs['xlink:href'] || attrs.href;
      if (!src) continue;
      const imgZipPath = resolveZipPath(docDir, src);
      if (seenImages.has(imgZipPath)) continue;
      const imgEntry = entries.get(imgZipPath);
      if (!imgEntry) continue;
      const buf = imgEntry.getData();
      if (isFullPageIllustration(buf, imgZipPath)) {
        seenImages.add(imgZipPath);
        items.push({ type: 'art', zipPath: imgZipPath, buffer: buf });
      }
      continue;
    }

    if (tag === 'hr') continue;

    // İçeride gömülü <img>/<svg><image> varsa önce görselleri yakala
    const nestedImgRe = /<(?:img|image)\b([^>]*?)\/?>/gi;
    let im;
    while ((im = nestedImgRe.exec(inner)) !== null) {
      const attrs = parseAttributes(im[1]);
      const src = attrs.src || attrs['xlink:href'] || attrs.href;
      if (!src) continue;
      const imgZipPath = resolveZipPath(docDir, src);
      if (seenImages.has(imgZipPath)) continue;
      const imgEntry = entries.get(imgZipPath);
      if (!imgEntry) continue;
      const buf = imgEntry.getData();
      if (isFullPageIllustration(buf, imgZipPath)) {
        seenImages.add(imgZipPath);
        items.push({ type: 'art', zipPath: imgZipPath, buffer: buf });
      }
    }

    // div içinde alt <p> blokları varsa dış div'i tekrar metinleştirme (çift kayıt önleme)
    if (tag === 'div' && /<(?:p|h[1-4]|div|blockquote)\b/i.test(inner)) {
      continue;
    }

    const text = decodeXmlEntities(
      inner
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (!text) continue;

    if (/^h[1-4]$/.test(tag)) {
      if (!heading) heading = text;
      else if (text !== heading) items.push({ type: 'heading', text });
      continue;
    }

    // Dipnot açıklama satırlarını ([1] ..., 1. ...) veya jenerik kredi satırlarını atla
    if (/^\[\d+\]\s*:?\s+/.test(text)) continue;
    items.push({ type: 'para', text });
  }

  return { docTitle, heading, items };
}

const STORY_HEADING_RE =
  /\b(Prologue|Epilogue|Afterword|Interlude|Chapter\s+\d+|Side\s+Story|Short\s+Story|Bonus\s+Short\s+Story|Bookwalker\s+SS|Afterword\s+SS|Anecdote)\b/i;

/**
 * Bir EPUB içinden okuma sırasındaki tüm tam sayfa illüstrasyonları ve metin komşuluğu çapalarını çıkarır (Cilt 6-10 için de kullanılır).
 */
function extractEpubIllustrationsInOrder(epubBuffer) {
  const { entries, manifest, spineDocs } = parseEpubPackage(epubBuffer);
  const seen = new Set();
  const illustrations = [];

  // Önce OPF cover-image varsa en başa al (spine'da cover XHTML yoksa kaybolmasın)
  for (const item of manifest.values()) {
    if (/cover-image/i.test(item.properties) || /^cover\.(?:jpe?g|png|webp)$/i.test(path.posix.basename(item.zipPath))) {
      // Spine ilk belgede zaten geçiyorsa orada da yakalanır ama sıralamayı garanti ederiz
      const firstSpineHasCover =
        spineDocs[0] && spineDocs[0].xhtml.includes(path.posix.basename(item.zipPath));
      if (!firstSpineHasCover && entries.has(item.zipPath)) {
        const buf = entries.get(item.zipPath).getData();
        if (isFullPageIllustration(buf, item.zipPath)) {
          seen.add(item.zipPath);
          illustrations.push({
            zipPath: item.zipPath,
            docIndex: 0,
            docHref: '',
            isBeforeStory: true,
            chapterHeading: '',
            prevAnchor: '',
            nextAnchor: '',
            orderIndex: illustrations.length,
            buffer: buf,
          });
        }
      }
    }
  }

  // Tüm spine akışını düzleştirerek her görselin hemen önceki ve sonraki hikâye metnini yakala
  const flatFlow = [];
  let storyStarted = false;
  let currentChapterHeading = '';

  spineDocs.forEach((doc, idx) => {
    const flow = extractXhtmlFlow(doc.xhtml, doc.zipPath, entries, seen);
    const candidateHead = flow.heading || flow.docTitle || '';
    const isTocOrCredits = /Table of Contents|About the Translators|Translation Notes|Copyright/i.test(candidateHead);
    if (!isTocOrCredits && STORY_HEADING_RE.test(candidateHead)) {
      storyStarted = true;
      currentChapterHeading = candidateHead;
    }

    let docParaChars = 0;
    for (const it of flow.items) {
      if (it.type === 'heading' && STORY_HEADING_RE.test(it.text)) {
        storyStarted = true;
        currentChapterHeading = it.text;
      } else if (it.type === 'para') {
        docParaChars += it.text.length;
        if (docParaChars >= 600 && !/Table of Contents|Translated by|Proofread by|All rights reserved/i.test(it.text)) {
          storyStarted = true;
        }
      }
      flatFlow.push({
        ...it,
        docIndex: idx,
        docHref: doc.href,
        storyStarted,
        chapterHeading: currentChapterHeading,
      });
    }
  });

  for (let i = 0; i < flatFlow.length; i++) {
    const it = flatFlow[i];
    if (it.type !== 'art') continue;

    let prevAnchor = '';
    for (let j = i - 1; j >= 0; j--) {
      if (flatFlow[j].type === 'para' && flatFlow[j].storyStarted && flatFlow[j].text.length >= 16) {
        prevAnchor = flatFlow[j].text;
        break;
      }
    }

    let nextAnchor = '';
    for (let j = i + 1; j < flatFlow.length; j++) {
      if (flatFlow[j].type === 'para' && flatFlow[j].storyStarted && flatFlow[j].text.length >= 16) {
        nextAnchor = flatFlow[j].text;
        break;
      }
    }

    illustrations.push({
      zipPath: it.zipPath,
      docIndex: it.docIndex,
      docHref: it.docHref,
      isBeforeStory: !it.storyStarted,
      chapterHeading: it.chapterHeading || '',
      prevAnchor,
      nextAnchor,
      orderIndex: illustrations.length,
      buffer: it.buffer,
    });
  }

  return illustrations;
}

module.exports = {
  decodeXmlEntities,
  parseEpubPackage,
  extractXhtmlFlow,
  extractEpubIllustrationsInOrder,
};
