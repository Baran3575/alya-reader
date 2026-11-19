// Cilt 11 Google Drive EPUB adaptörü:
//  - Klasör: 1X3ZC0jvE6r11PTJHx9Cf2wfuezN4NXjL -> Dosya: 14rf2EZmMiMrmg6bAvWtYOLrgw9VvZf0r
//  - 22 XHTML belgesi + gömülü kapak/renkli/siyah-beyaz görselleri okur
//  - ~1.400 karakter/sayfa sentetik sayfalama ile data11/source.json, data11/chapters.json ve public/pages11/*.webp üretir
const fs = require('fs');
const path = require('path');
const { listDriveFolder, downloadDriveBuffer } = require('../lib/gdrive');
const { parseEpubPackage, extractXhtmlFlow } = require('../lib/epub');
const { ensureDir } = require('../lib/cache');
const { writeWebp } = require('../lib/webp');
const { paginateSections } = require('../lib/paginate');

const V11_FOLDER_ID = '1X3ZC0jvE6r11PTJHx9Cf2wfuezN4NXjL';
const V11_EPUB_FILE_ID = '14rf2EZmMiMrmg6bAvWtYOLrgw9VvZf0r';

function classifyEpubHeading(rawHeading, docTitle, href) {
  const candidates = [rawHeading, docTitle].map((x) => String(x || '').trim()).filter(Boolean);
  const full = candidates[0] || '';
  const lowerHref = String(href || '').toLowerCase();

  if (/toc|nav|contents/i.test(lowerHref) || /^Table of Contents$/i.test(full)) {
    return { skipText: true, isFrontArt: false };
  }
  if (/credit|copyright|colophon|translator/i.test(lowerHref) || /^(?:Credits|About the Translators|Fan Translator['’]?s Note)$/i.test(full)) {
    return { skipText: true, isFrontArt: false };
  }
  if (/^Author['’]?s\s+Afterword$/i.test(full)) {
    return { skipText: false, isNewSection: true, label: 'Sonsöz', enTitle: 'Afterword' };
  }
  if (/cover|kuchie|illust|frontispiece/i.test(lowerHref)) {
    return { skipText: true, isFrontArt: true };
  }

  const m = full.match(
    /^(Prologue|Epilogue|Afterword|Interlude|Chapter\s+\d+|Side\s+Story(?:\s+\d+)?|(?:Bonus\s+)?Short\s+Story(?:\s+\d+)?)\b(?:\s*[:—–-]\s*(.*))?$/i
  );
  if (m) {
    const rawLabel = m[1].trim();
    const sub = (m[2] || '').trim();
    let label = rawLabel;
    if (/^Prologue$/i.test(rawLabel)) label = 'Prolog';
    else if (/^Epilogue$/i.test(rawLabel)) label = 'Epilog';
    else if (/^Afterword$/i.test(rawLabel)) label = 'Sonsöz';
    else if (/^Interlude$/i.test(rawLabel)) label = 'Ara Bölüm';
    else if (/^Chapter\s+(\d+)$/i.test(rawLabel)) label = 'Bölüm ' + rawLabel.match(/\d+/)[0];
    else if (/Short\s+Story/i.test(rawLabel)) {
      const n = rawLabel.match(/\d+/);
      label = n ? `Kısa Hikâye ${n[0]}` : 'Ek Hikâye';
    }
    return {
      skipText: false,
      isNewSection: true,
      label,
      enTitle: sub || label,
    };
  }

  return {
    skipText: false,
    isNewSection: Boolean(full),
    label: full ? 'Ek Bölüm' : '',
    enTitle: full,
  };
}

function isBoilerplateParagraph(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(?:Translated by|Proofread by|Edited by|Cover art by|Glucose Translations|join our discord|https?:\/\/)/i.test(t) && t.length < 350) {
    return true;
  }
  return false;
}

async function ingestEpub11(volCfg, opts = {}) {
  // Klasör listesini kontrol ederek EPUB dosya kimliğini doğrula
  let epubFileId = V11_EPUB_FILE_ID;
  try {
    const folderItems = await listDriveFolder(V11_FOLDER_ID, opts);
    const epubEntry = folderItems.find((x) => /\.epub$/i.test(x.name) || x.id === V11_EPUB_FILE_ID);
    if (epubEntry) epubFileId = epubEntry.id;
  } catch {}

  console.log(`  [v11] Google Drive üzerinden EPUB indiriliyor (${epubFileId})...`);
  const epubBuf = await downloadDriveBuffer(epubFileId, opts);
  const { entries, spineDocs } = parseEpubPackage(epubBuf);

  const seenImages = new Set();
  const frontArtItems = [];
  const sections = [];
  let totalRawChars = 0;

  for (let i = 0; i < spineDocs.length; i++) {
    const doc = spineDocs[i];
    const flow = extractXhtmlFlow(doc.xhtml, doc.zipPath, entries, seenImages);
    for (const it of flow.items) {
      if (it.type === 'para' || it.type === 'heading') totalRawChars += it.text.length;
    }

    const meta = classifyEpubHeading(flow.heading, flow.docTitle, doc.href);
    const artOnly = flow.items.filter((x) => x.type === 'art');
    const proseParas = flow.items.filter((x) => x.type === 'para' && !isBoilerplateParagraph(x.text));

    // Ön kısımdaki salt görsel / kredi / içindekiler belgeleri
    if (sections.length === 0 && (meta.skipText || proseParas.length === 0)) {
      for (const a of artOnly) frontArtItems.push({ type: 'art', asset: a.buffer });
      continue;
    }

    if (meta.skipText) {
      if (artOnly.length && sections.length) {
        for (const a of artOnly) {
          sections[sections.length - 1].items.push({ type: 'art', asset: a.buffer });
        }
      }
      continue;
    }

    // İlk paragraf başlığın alt başlığıysa yakala
    let enTitle = meta.enTitle;
    let startParaIdx = 0;
    if (
      proseParas.length > 1 &&
      (!enTitle || enTitle === meta.label) &&
      proseParas[0].text.length < 90 &&
      !/^[“"‘']/.test(proseParas[0].text) &&
      !/[.!?]$/.test(proseParas[0].text)
    ) {
      enTitle = proseParas[0].text;
      startParaIdx = 1;
    }

    const flowConverted = [];
    let pSeen = 0;
    for (const it of flow.items) {
      if (it.type === 'art') {
        flowConverted.push({ type: 'art', asset: it.buffer });
      } else if (it.type === 'para' && !isBoilerplateParagraph(it.text)) {
        if (pSeen >= startParaIdx) {
          flowConverted.push({ type: 'para', text: it.text });
        }
        pSeen++;
      }
    }

    if (!flowConverted.length) continue;

    // Eğer belge devam sayfasıysa (başlık yoksa) ve önceki hikâye bölümü mevcutsa ona ekle
    if (!meta.isNewSection && sections.length > 0) {
      sections[sections.length - 1].items.push(...flowConverted);
    } else {
      sections.push({
        label: meta.label || `Bölüm ${sections.length + 1}`,
        title: enTitle || meta.label || `Chapter ${sections.length + 1}`,
        enTitle: enTitle || meta.label || `Chapter ${sections.length + 1}`,
        items: flowConverted,
      });
    }
  }

  if (frontArtItems.length) {
    sections.unshift({
      label: 'İllüstrasyonlar',
      title: 'İllüstrasyonlar',
      enTitle: 'Illustrations',
      items: frontArtItems,
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

  const artCount = pages.filter((p) => !p.text).length;
  console.log(
    `✓ Cilt 11 alındı: ${spineDocs.length} XHTML (${totalRawChars} kr) -> ${pages.length} sayfa (${pages.length - artCount} metin, ${artCount} illüstrasyon, ${chaptersMeta.chapters.length} bölüm).`
  );
  return { pages, chaptersMeta, xhtmlCount: spineDocs.length, totalRawChars };
}

module.exports = {
  V11_FOLDER_ID,
  V11_EPUB_FILE_ID,
  ingestEpub11,
};
