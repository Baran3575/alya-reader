// Cilt 5–10 FlipHTML5 & AnyFlip metin adaptörü + GlucoseTL temiz illüstrasyon çıkarıcı
// Notlar:
//  - Fastly korumalı Scribd URL'leri ve WASM şifreli deString.js kaynakları bilinçli olarak atlanır.
//  - Katalog URL'leri (örn. fliphtml5.com/utpiy/tlew/...) otomatik olarak online.fliphtml5.com/.../search_config.js biçimine çevrilir.
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { ensureDir, readCacheBuffer, writeCacheBuffer, readCacheJson, writeCacheJson } = require('../lib/cache');
const { listDriveFolder, downloadDriveBuffer } = require('../lib/gdrive');
const { extractEpubIllustrationsInOrder } = require('../lib/epub');
const { isFullPageIllustration, writeWebp, getImageDimensions } = require('../lib/webp');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SKIPPED_SOURCES = [
  'https://www.scribd.com/document/722853252/Alya-Sometimes-Hides-Her-Feelings-in-Russian-Vol-5',
  'https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js',
];

const FLIP_VOLUME_CONFIG = {
  '5': {
    candidateUrls: [
      'https://www.scribd.com/document/722853252/Alya-Sometimes-Hides-Her-Feelings-in-Russian-Vol-5',
      'https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js',
      'https://online.fliphtml5.com/hlsms/zusi/files/search/search_config.js',
    ],
    artSource: {
      type: 'pdf_and_folder',
      pdfFileId: '1LAOE2KPOYmg61UcDyjZippwzda6L_lV4',
      colorFolderId: '1FwmzubPb9ka05R9AUd6MsLOgBtYsT-Ov',
    },
  },
  '6': {
    candidateUrls: [
      'https://online.fliphtml5.com/hlsms/mfba/files/search/search_config.js',
    ],
    artSource: {
      type: 'epub',
      epubFileId: '15Ozg5iqQjjTi8tMjrQ78HqG534cGPKWF',
    },
  },
  '7': {
    candidateUrls: [
      'https://online.fliphtml5.com/utpiy/ekus/files/search/search_config.js',
    ],
    artSource: {
      type: 'epub',
      epubFileId: '1VHENY-G-n92b9ZU0XFH4bZLTuH4FL1Cm',
    },
  },
  '8': {
    candidateUrls: [
      'https://fliphtml5.com/utpiy/tlew/Alya_Sometimes_Hides_Her_Feelings_in_Russian%2C_Vol_8/',
    ],
    artSource: {
      type: 'epub',
      epubFileId: '1oZvjYiFKKMyKAmQtRt48e8PwImKma7UR',
    },
  },
  '9': {
    candidateUrls: [
      'https://online.fliphtml5.com/utpiy/ctbm/files/search/search_config.js',
    ],
    artSource: {
      type: 'epub',
      epubFileId: '1gEmV7N_2DnO_sb4oCKm2i_MCRcqYO57f',
    },
  },
  '10': {
    candidateUrls: [
      'https://online.fliphtml5.com/dzxyw/fhfj/files/search/search_config.js',
      'https://online.anyflip.com/bryaq/rmsk/files/search/search_config.js',
    ],
    artSource: {
      type: 'epub',
      epubFileId: '1h0cdot9ApbAl4sLSjKqMW6BG1dCviECU',
    },
  },
};

function isSkippedSourceUrl(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  if (/scribd\.com\//i.test(s)) return true;
  if (/\/deString\.js(?:\?|$)/i.test(s)) return true;
  return SKIPPED_SOURCES.includes(s);
}

function normalizeFlipBookUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (isSkippedSourceUrl(s)) return null;

  const u = new URL(s);
  const host = u.hostname.toLowerCase();

  // Zaten search_config.js ise doğrudan döndür
  if (/\/files\/search\/search_config\.js$/i.test(u.pathname)) {
    if (host === 'fliphtml5.com' || host === 'www.fliphtml5.com') {
      u.hostname = 'online.fliphtml5.com';
    } else if (host === 'anyflip.com' || host === 'www.anyflip.com') {
      u.hostname = 'online.anyflip.com';
    }
    return u.toString();
  }

  // Katalog veya okuyucu URL'si: /<u1>/<u2>/...
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 2) {
    if (host.endsWith('fliphtml5.com')) {
      return `https://online.fliphtml5.com/${parts[0]}/${parts[1]}/files/search/search_config.js`;
    }
    if (host.endsWith('anyflip.com')) {
      return `https://online.anyflip.com/${parts[0]}/${parts[1]}/files/search/search_config.js`;
    }
  }
  return s;
}

function decodeEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function parseSearchConfigJs(jsSource) {
  const sandbox = { textForPages: null };
  vm.runInNewContext(jsSource, sandbox, { timeout: 2000 });
  if (!sandbox.textForPages || typeof sandbox.textForPages.length !== 'number') {
    throw new Error('search_config.js içinde textForPages dizisi bulunamadı.');
  }
  return Array.from(sandbox.textForPages, (p) => decodeEntities(String(p || '')));
}

async function fetchSearchConfigPages(url, { refresh = false } = {}) {
  const normUrl = normalizeFlipBookUrl(url);
  if (!normUrl) return null;

  if (!refresh) {
    const cached = readCacheJson('search-config', normUrl);
    if (cached && Array.isArray(cached)) return { url: normUrl, pages: cached };
  }

  const res = await fetch(normUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`search_config.js indirilemedi (${normUrl}): HTTP ${res.status}`);
  }
  const jsText = await res.text();
  const pages = parseSearchConfigJs(jsText);
  writeCacheJson('search-config', normUrl, pages);
  return { url: normUrl, pages };
}

function isCreditsOrTocPage(rawText) {
  const t = String(rawText || '').trim();
  if (!t) return true;
  if (/Table of Contents/i.test(t)) return true;
  if (/Glucose Translations/i.test(t) && t.length < 700) return true;
  if (/(?:Translated by|Proofread by|Edited by|Cover art by|All rights reserved|KADOKAWA CORPORATION)/i.test(t) && t.length < 900) {
    return true;
  }
  if (/join\s+our\s+discord|ko-fi\.com|glucosetl\.xyz|wordpress\.com/i.test(t) && t.length < 700) {
    return true;
  }
  return false;
}

function cleanFlipPageText(rawText) {
  if (isCreditsOrTocPage(rawText)) return '';
  const lines = String(rawText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const cleaned = [];
  for (let i = 0; i < lines.length; i++) {
    let ln = lines[i];
    // Sayfa üst/alt numarası
    if (/^(?:Page\s+)?\d{1,3}$/i.test(ln) && (i === 0 || i === lines.length - 1)) continue;
    // Sayfa altı dipnot tanımları: [1] ..., * ..., veya 1 or if translated literally...
    if (/^\[\d+\]\s*:?\s+/.test(ln)) continue;
    if (/^(?:TN|T\/N|TL\s*Note)\s*:/i.test(ln)) continue;
    if (/^\*+\s+/.test(ln) && i >= lines.length - 3) continue;
    if (/^(?:\d+\s+)?(?:or\s+if\s+translated\s+literally|lit\.|literally\s*,|in\s+japanese\s*,)/i.test(ln) && i >= lines.length - 3) {
      continue;
    }
    // Satır içi dipnot imlerini ([1], [2]) temizle
    ln = ln.replace(/\[\d+\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
    if (ln) cleaned.push(ln);
  }

  return cleaned.join('\n').trim();
}

const CHAPTER_START_RE =
  /^(Prologue|Epilogue|Afterword|Interlude|Chapter\s+\d+|Side\s+Story(?:\s+\d+)?|Short\s+Story(?:\s+\d+)?|Bonus\s+Short\s+Story(?:\s+\d+)?)\b(?:\s*[:—–-]\s*(.*))?$/i;

function looksLikeWrappedTitleContinuation(line2, line3) {
  if (!line2 || !line3) return false;
  if (/[.!?…”"]$/.test(line2)) return false;
  if (/^[“"‘'—]/.test(line3)) return false;
  const words3 = line3.split(/\s+/).filter(Boolean);
  if (words3.length === 0 || words3.length > 6 || line3.length > 44) return false;
  // Başlık devamı genelde büyük harfle başlar veya kısa tamamlayıcı kelimelerdir; tam cümle değildir
  if (/\b(?:he|she|they|was|were|had|said|asked|looked|walked|thought)\b/i.test(line3) && line3.endsWith('.')) {
    return false;
  }
  return true;
}

function detectPageHeading(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const m = lines[0].match(CHAPTER_START_RE);
  if (!m) return null;

  const rawLabel = m[1].trim();
  const isAfterword = /^Afterword$/i.test(rawLabel);
  let subtitle = (m[2] || '').trim();
  let consumedLines = 1;

  // Afterword (Sonsöz) alt başlık taşımaz; 2. satır doğrudan yazarın ilk cümlesidir
  if (
    !isAfterword &&
    !subtitle &&
    lines.length >= 2 &&
    lines[1].length < 85 &&
    !/^[“"‘']/.test(lines[1]) &&
    !/[.]$/.test(lines[1])
  ) {
    subtitle = lines[1];
    consumedLines = 2;
    if (lines.length >= 3 && looksLikeWrappedTitleContinuation(lines[1], lines[2])) {
      subtitle = `${lines[1]} ${lines[2]}`.replace(/\s+/g, ' ').trim();
      consumedLines = 3;
    }
  }

  let trLabel = rawLabel;
  if (/^Prologue$/i.test(rawLabel)) trLabel = 'Prolog';
  else if (/^Epilogue$/i.test(rawLabel)) trLabel = 'Epilog';
  else if (isAfterword) trLabel = 'Sonsöz';
  else if (/^Interlude$/i.test(rawLabel)) trLabel = 'Ara Bölüm';
  else if (/^Chapter\s+(\d+)$/i.test(rawLabel)) trLabel = 'Bölüm ' + rawLabel.match(/\d+/)[0];
  else if (/^(?:Bonus\s+)?Short\s+Story(?:\s+(\d+))?$/i.test(rawLabel)) {
    const n = rawLabel.match(/\d+/);
    trLabel = n ? `Kısa Hikâye ${n[0]}` : 'Ek Hikâye';
  } else if (/^Side\s+Story(?:\s+(\d+))?$/i.test(rawLabel)) {
    const n = rawLabel.match(/\d+/);
    trLabel = n ? `Yan Hikâye ${n[0]}` : 'Yan Hikâye';
  }

  return {
    enLabel: rawLabel,
    label: trLabel,
    enTitle: isAfterword ? 'Afterword' : subtitle || trLabel,
    consumedLines,
  };
}

function stripLeadingHeadingFromPageText(text, headingInfo) {
  if (!headingInfo) return text;
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return text;
  const count = headingInfo.consumedLines || 1;
  return lines.slice(count).join('\n').trim();
}

function isNonMaskPdfImage(buf) {
  if (!isFullPageIllustration(buf)) return false;
  // Tek renkli (bembeyaz/simsiyah) PDF alfa maskelerini ele: PNG boyutu çok küçükse (< 12KB) atla
  if (buf.length < 12000) return false;
  return true;
}

async function extractVol5PdfIllustrations(pdfFileId, colorFolderId) {
  const cachedCount = readCacheJson('vol5-ills-meta', pdfFileId);
  if (cachedCount && Array.isArray(cachedCount)) {
    const bufs = cachedCount.map((k) => readCacheBuffer('vol5-ills', k));
    if (bufs.every(Boolean)) return bufs;
  }

  // 1) Renkli illüstrasyon klasörü (kapak + renkli sayfalar)
  const colorEntries = await listDriveFolder(colorFolderId);
  const colorBufs = [];
  for (const entry of colorEntries.filter((e) => e.type === 'file' && /\.(?:png|jpe?g|webp)$/i.test(e.name))) {
    const b = await downloadDriveBuffer(entry.id);
    if (isFullPageIllustration(b, entry.name)) colorBufs.push(b);
  }

  // 2) PDF içinden gömülü görselleri çıkar (siyah-beyaz iç illüstrasyonlar dahil)
  const pdfBuf = await downloadDriveBuffer(pdfFileId);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alya_v5_pdf_'));
  const pdfIllustrations = [];
  try {
    const pdfPath = path.join(tmpDir, 'vol5.pdf');
    fs.writeFileSync(pdfPath, pdfBuf);
    execFileSync('pdfimages', ['-png', '-p', pdfPath, path.join(tmpDir, 'img')]);
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith('img-') && f.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // Sayfa başına en büyük gerçek görseli tut (alfa maskesi ikizlerini ele)
    const byPdfPage = new Map();
    for (const f of files) {
      // img-<page>-<idx>.png
      const m = f.match(/^img-(\d+)-(\d+)\.png$/);
      const pg = m ? Number(m[1]) : files.indexOf(f);
      const b = fs.readFileSync(path.join(tmpDir, f));
      if (!isNonMaskPdfImage(b)) continue;
      // Son sayfalardaki grup/Discord reklam kartını atla
      if (pg > 280 && b.length < 90000) continue;
      const prev = byPdfPage.get(pg);
      if (!prev || b.length > prev.buf.length) {
        byPdfPage.set(pg, { pg, buf: b });
      }
    }

    const orderedPdf = [...byPdfPage.values()].sort((a, b) => a.pg - b.pg);
    for (const item of orderedPdf) pdfIllustrations.push(item);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Ön kısım (pg <= 12) için yüksek çözünürlüklü renkli klasör görselleri varsa kullan,
  // orta/arka kısım (pg > 12) için PDF'teki siyah-beyaz illüstrasyonları ekle
  const midPdfBufs = pdfIllustrations.filter((x) => x.pg > 12).map((x) => x.buf);
  const frontPdfBufs = pdfIllustrations.filter((x) => x.pg <= 12).map((x) => x.buf);
  const finalFront = colorBufs.length >= 4 ? colorBufs : frontPdfBufs;
  const combined = [
    ...finalFront.map((buf) => ({ isFront: true, buffer: buf })),
    ...midPdfBufs.map((buf) => ({ isFront: false, buffer: buf })),
  ];

  const keys = combined.map((item, idx) => {
    const key = `${item.isFront ? 'front' : 'mid'}_${String(idx).padStart(2, '0')}`;
    writeCacheBuffer('vol5-ills', key, item.buffer);
    return key;
  });
  writeCacheJson('vol5-ills-meta', pdfFileId, keys);
  return combined;
}

async function extractCleanIllustrations(volKey, artSource) {
  if (artSource.type === 'pdf_and_folder') {
    const raw = await extractVol5PdfIllustrations(artSource.pdfFileId, artSource.colorFolderId);
    return raw.map((x) =>
      Buffer.isBuffer(x) ? { isFront: false, buffer: x } : x
    );
  }

  const epubBuf = await downloadDriveBuffer(artSource.epubFileId);
  const ills = extractEpubIllustrationsInOrder(epubBuf);
  return ills.map((it) => {
    const lower = `${it.zipPath} ${it.docHref || ''}`.toLowerCase();
    const isFront =
      it.docIndex <= 6 &&
      (/cover|kuchie|color|illust|front|insert0[0-4]|p00[1-7]/i.test(lower) || it.docIndex <= 4);
    return { isFront, buffer: it.buffer, zipPath: it.zipPath };
  });
}

async function ingestFlipVolume(volCfg, opts = {}) {
  const cfg = FLIP_VOLUME_CONFIG[volCfg.key];
  if (!cfg) throw new Error(`FlipHTML5 yapılandırması bulunamadı: Cilt ${volCfg.key}`);

  const validResults = [];
  for (const rawUrl of cfg.candidateUrls) {
    if (isSkippedSourceUrl(rawUrl)) {
      console.log(`  [atlandı] Korumalı/şifreli kaynak devre dışı: ${rawUrl}`);
      continue;
    }
    const normUrl = normalizeFlipBookUrl(rawUrl);
    try {
      const res = await fetchSearchConfigPages(normUrl, opts);
      if (res && res.pages && res.pages.length) {
        console.log(`  [ok] Metin dizini yüklendi (${res.pages.length} sayfa): ${res.url}`);
        validResults.push(res);
      }
    } catch (err) {
      console.warn(`  [uyarı] ${normUrl} okunamadı: ${err.message}`);
    }
  }

  if (!validResults.length) {
    throw new Error(`Cilt ${volCfg.key} için hiçbir geçerli FlipHTML5/AnyFlip metin kaynağı indirilemedi.`);
  }

  // Cilt 10 gibi hem FlipHTML5 hem AnyFlip aynası varsa boş sayfaları yedek kaynaktan tamamla
  const primaryPages = [...validResults[0].pages];
  if (validResults.length > 1) {
    const backupPages = validResults[1].pages;
    const len = Math.min(primaryPages.length, backupPages.length);
    for (let i = 0; i < len; i++) {
      if (!primaryPages[i].trim() && backupPages[i].trim()) {
        primaryPages[i] = backupPages[i];
      }
    }
  }

  // Temiz illüstrasyonları çıkar
  console.log(`  [görsel] GlucoseTL arşivinden temiz illüstrasyonlar çıkarılıyor (Cilt ${volCfg.key})...`);
  const illustrations = await extractCleanIllustrations(volCfg.key, cfg.artSource);
  let frontIlls = illustrations.filter((x) => x.isFront);
  let midIlls = illustrations.filter((x) => !x.isFront);
  if (!frontIlls.length && illustrations.length >= 4) {
    frontIlls = illustrations.slice(0, 4);
    midIlls = illustrations.slice(4);
  }

  // Metin sayfalarını temizle ve ilk gerçek hikâye sayfasını bul
  const cleanedPages = primaryPages.map((raw) => cleanFlipPageText(raw));
  let firstStoryIdx = cleanedPages.findIndex((t) => Boolean(detectPageHeading(t)) || t.length >= 260);
  if (firstStoryIdx < 0) firstStoryIdx = 0;

  // Son gerçek hikâye sayfasını bul (sondaki boş/reklam sayfalarını kırp)
  let lastStoryIdx = cleanedPages.length - 1;
  while (lastStoryIdx > firstStoryIdx && cleanedPages[lastStoryIdx].length === 0) {
    lastStoryIdx--;
  }

  // Hikâye gövdesindeki aday illüstrasyon boşluklarını tespit et
  const bodyItems = [];
  for (let i = firstStoryIdx; i <= lastStoryIdx; i++) {
    const txt = cleanedPages[i];
    const heading = detectPageHeading(txt);
    if (!txt) {
      bodyItems.push({ kind: 'empty', srcIdx: i });
    } else {
      bodyItems.push({ kind: 'prose', srcIdx: i, text: txt, heading });
    }
  }

  // Kısa düzyazı parçalarını (< 230 kr) aynı bölümdeki komşu düzyazı sayfasıyla birleştir
  // (Başlık taşıyan sayfalar kendi bölümünü başlatır; çok kısaysa bir sonraki düzyazıyla birleşir)
  for (let i = 0; i < bodyItems.length; i++) {
    const it = bodyItems[i];
    if (it.kind !== 'prose' || it.text.length >= 230) continue;

    if (!it.heading) {
      // Kendinden önceki düzyazı sayfasını bul (arada bölüm başlığı yoksa)
      let prevProse = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (bodyItems[j].kind === 'prose') {
          prevProse = j;
          break;
        }
      }
      if (prevProse >= 0) {
        bodyItems[prevProse].text = bodyItems[prevProse].text + '\n\n' + it.text;
        it.kind = 'merged';
        continue;
      }
    }

    // Yoksa kendinden sonraki başlık taşımayan ilk düzyazı sayfasıyla birleştir
    for (let j = i + 1; j < bodyItems.length; j++) {
      if (bodyItems[j].kind === 'prose' && !bodyItems[j].heading) {
        it.text = it.text + '\n\n' + bodyItems[j].text;
        bodyItems[j].kind = 'merged';
        if (it.text.length >= 230) break;
      } else if (bodyItems[j].kind === 'prose' && bodyItems[j].heading) {
        break;
      }
    }
  }

  const activeBody = bodyItems.filter((x) => x.kind !== 'merged');
  const emptyIndices = activeBody
    .map((x, idx) => (x.kind === 'empty' ? idx : -1))
    .filter((idx) => idx >= 0);

  // Boş sayfaları midIlls ile eşleştir: bölüm ortasındaki boşluklara öncelik ver
  const assignedArt = new Map();
  if (midIlls.length <= emptyIndices.length) {
    const scored = emptyIndices.map((idx) => {
      const next = activeBody[idx + 1];
      const beforeNewChapter = next && next.kind === 'prose' && Boolean(next.heading);
      return { idx, priority: beforeNewChapter ? 1 : 0 };
    });
    // Önceliği yüksek (0 = bölüm içi) olanları seç, sonra okuma sırasına diz
    scored.sort((a, b) => a.priority - b.priority || a.idx - b.idx);
    const chosen = scored.slice(0, midIlls.length).sort((a, b) => a.idx - b.idx);
    chosen.forEach((slot, k) => {
      assignedArt.set(slot.idx, midIlls[k].buffer);
    });
  } else {
    emptyIndices.forEach((idx, k) => {
      assignedArt.set(idx, midIlls[k].buffer);
    });
  }

  // Nihai kanonik sayfaları ve bölüm tablosunu oluştur
  const imgOutDir = path.join(path.dirname(volCfg.sourceFile), '..', volCfg.imgDir);
  ensureDir(imgOutDir);
  // Eski artık görselleri temizle
  for (const f of fs.readdirSync(imgOutDir)) {
    if (f.endsWith('.webp')) fs.unlinkSync(path.join(imgOutDir, f));
  }

  const finalPages = [];
  const chapters = [];
  const titles = {};

  const pushArtPage = (buf) => {
    const pNo = finalPages.length + 1;
    const fileName = `${String(pNo).padStart(3, '0')}.webp`;
    writeWebp(buf, path.join(imgOutDir, fileName));
    finalPages.push({
      page: pNo,
      img: `${volCfg.imgPrefix}${fileName}`,
      thumb: '',
      text: '',
    });
    return pNo;
  };

  if (frontIlls.length > 0) {
    const startP = finalPages.length + 1;
    for (const ill of frontIlls) pushArtPage(ill.buffer);
    titles[String(startP)] = 'İllüstrasyonlar';
    chapters.push({
      label: 'İllüstrasyonlar',
      title: 'İllüstrasyonlar',
      enTitle: 'Illustrations',
      startPage: startP,
    });
  }

  activeBody.forEach((item, idx) => {
    if (item.kind === 'empty') {
      const artBuf = assignedArt.get(idx);
      if (artBuf) pushArtPage(artBuf);
      return;
    }

    const pNo = finalPages.length + 1;
    const fileName = `${String(pNo).padStart(3, '0')}.webp`;
    let pageText = item.text;

    if (item.heading) {
      const stripped = stripLeadingHeadingFromPageText(pageText, item.heading);
      if (stripped.length >= 230) {
        pageText = stripped;
      }
      titles[String(pNo)] = item.heading.enTitle;
      chapters.push({
        label: item.heading.label,
        title: item.heading.enTitle,
        enTitle: item.heading.enTitle,
        startPage: pNo,
      });
    }

    finalPages.push({
      page: pNo,
      img: `${volCfg.imgPrefix}${fileName}`,
      thumb: '',
      text: pageText,
    });
  });

  // Eğer midIlls içinde boş yuvadan fazla görsel kaldıysa sona ekle
  if (midIlls.length > emptyIndices.length) {
    for (let k = emptyIndices.length; k < midIlls.length; k++) {
      pushArtPage(midIlls[k].buffer);
    }
  }

  ensureDir(path.dirname(volCfg.sourceFile));
  fs.writeFileSync(volCfg.sourceFile, JSON.stringify(finalPages, null, 2));
  fs.writeFileSync(volCfg.titlesFile, JSON.stringify({ titles, chapters }, null, 2));

  const artCount = finalPages.filter((p) => !p.text).length;
  console.log(
    `✓ Cilt ${volCfg.key} alındı: ${finalPages.length} sayfa (${finalPages.length - artCount} metin, ${artCount} temiz WebP illüstrasyon, ${chapters.length} bölüm).`
  );
  return { pages: finalPages, chapters };
}

module.exports = {
  SKIPPED_SOURCES,
  FLIP_VOLUME_CONFIG,
  isSkippedSourceUrl,
  normalizeFlipBookUrl,
  parseSearchConfigJs,
  ingestFlipVolume,
};
