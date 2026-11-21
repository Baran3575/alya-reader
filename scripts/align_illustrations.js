#!/usr/bin/env node
// Cilt 5, 6 ve 7 (veya scan/ dizini bulunan herhangi bir cilt) için sahne illüstrasyonlarını
// referans PDF taramalarıyla (public/pages<vol>/scan/*.webp) algısal özet / piksel korelasyonu
// üzerinden doğrulamalı olarak hizalar.
//
// Kullanım:
//   node scripts/align_illustrations.js [--volume 5,6,7] [--dry-run] [--verify-only]

const fs = require('fs');
const path = require('path');
const { ROOT, VOLUMES } = require('./lib/volumes');
const { writeWebp } = require('./ingest/lib/webp');
const {
  forEachDecodedWebpSync,
  rgbToGray,
  resizeGrayBilinear,
  cropGray,
  nvecFromGray,
  corr,
  cropNonwhiteBandGray,
  imageStats,
  slideMatch,
  cropScanLetterboxToWebp,
} = require('./lib/webp_pixels');

const DEFAULT_VOLS = ['5', '6', '7'];

function parseArgs(argv) {
  let vols = [...DEFAULT_VOLS];
  const dryRun = argv.includes('--dry-run') || argv.includes('--dry');
  const verifyOnly = argv.includes('--verify-only');

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--volume' || a === '--vol' || a === '-v') && argv[i + 1]) {
      vols = String(argv[i + 1])
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith('--volume=') || a.startsWith('--vol=')) {
      vols = a
        .split('=')[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { vols, dryRun, verifyOnly };
}

function analyzeVolumeImages(volDir, decodeOptions = {}) {
  const scanDir = path.join(volDir, 'scan');
  const scanFiles = fs
    .readdirSync(scanDir)
    .filter((f) => f.endsWith('.webp'))
    .sort()
    .map((f) => path.join(scanDir, f));
  const cleanFiles = fs
    .readdirSync(volDir)
    .filter((f) => f.endsWith('.webp'))
    .sort()
    .map((f) => path.join(volDir, f));

  const scans = new Map();
  forEachDecodedWebpSync(
    scanFiles,
    (sf, frame) => {
      const sno = Number(path.basename(sf).split('.')[0]);
      const { width, height, rgb } = frame;
      const gray = rgbToGray(rgb, width, height);
      const { sat, white, grayMid, osc } = imageStats(rgb, gray, width, height);
      const isSceneArt = Boolean(white < 0.7 && grayMid > 0.22 && osc < 7.0);
      const isCand = Boolean(isSceneArt || sno <= 14 || osc < 8.5 || white < 0.75);
      let vFull = null;
      let vCrop = null;
      let g64 = null;
      if (isCand) {
        vFull = nvecFromGray(gray, width, height);
        const cropped = cropNonwhiteBandGray(gray, width, height);
        vCrop = nvecFromGray(cropped.gray, cropped.width, cropped.height);
        g64 = resizeGrayBilinear(gray, width, height, 64, 96);
      }
      scans.set(sno, {
        pdfPage: sno,
        size: [width, height],
        sat,
        white,
        gray_mid: grayMid,
        osc,
        vFull,
        vCrop,
        g64,
        isSceneArt,
        isCand,
      });
    },
    decodeOptions
  );

  const cleans = new Map();
  forEachDecodedWebpSync(
    cleanFiles,
    (cf, frame) => {
      const pno = Number(path.basename(cf).split('.')[0]);
      const { width, height, rgb } = frame;
      const gray = rgbToGray(rgb, width, height);
      const { sat, white, grayMid, osc } = imageStats(rgb, gray, width, height);
      const cropped = cropNonwhiteBandGray(gray, width, height);
      // Kapak kopyası karşılaştırması için yalnızca dikey renkli adayların gri kanalını tut
      const keepPortraitGray = width < height && sat >= 3.0 ? gray : null;
      cleans.set(pno, {
        page: pno,
        size: [width, height],
        sat,
        white,
        gray_mid: grayMid,
        osc,
        vFull: nvecFromGray(gray, width, height),
        vCrop: nvecFromGray(cropped.gray, cropped.width, cropped.height),
        portraitGray: keepPortraitGray,
      });
    },
    decodeOptions
  );

  // Dikey renkli ön çizimler arasında kapak varyantı ikizlerini bul
  const cleanKeys = [...cleans.keys()].sort((a, b) => a - b);
  const coverDups = {};
  for (let i = 0; i < cleanKeys.length; i++) {
    const p1 = cleanKeys[i];
    const c1 = cleans.get(p1);
    if (!c1.portraitGray) continue;
    const [w1, h1] = c1.size;
    const sub1Rect = cropGray(
      c1.portraitGray,
      w1,
      Math.floor(w1 * 0.18),
      Math.floor(h1 * 0.25),
      Math.floor(w1 * 0.82),
      Math.floor(h1 * 0.85)
    );
    const sub1 = nvecFromGray(sub1Rect.gray, sub1Rect.width, sub1Rect.height);

    for (let j = i + 1; j < cleanKeys.length; j++) {
      const p2 = cleanKeys[j];
      const c2 = cleans.get(p2);
      if (!c2.portraitGray) continue;
      const [w2, h2] = c2.size;
      let bestSub = corr(c1.vFull, c2.vFull);
      for (const dx of [0, 30, 60]) {
        for (const dy of [0, 25, 50]) {
          const x0 = Math.min(w2 - 32, dx + Math.floor(w2 * 0.12));
          const y0 = Math.min(h2 - 32, dy + Math.floor(h2 * 0.22));
          const x1 = Math.min(w2, x0 + Math.floor(w2 * 0.72));
          const y1 = Math.min(h2, y0 + Math.floor(h2 * 0.64));
          if (x1 - x0 > 64 && y1 - y0 > 64) {
            const sub2 = cropGray(c2.portraitGray, w2, x0, y0, x1, y1);
            const sc = corr(sub1, nvecFromGray(sub2.gray, sub2.width, sub2.height));
            if (sc > bestSub) bestSub = sc;
          }
        }
      }
      if (bestSub >= 0.56) {
        if (!coverDups[String(p1)]) coverDups[String(p1)] = [];
        coverDups[String(p1)].push([p2, Number(bestSub.toFixed(4))]);
      }
    }
  }

  const cleanOut = {};
  for (const pno of cleanKeys) {
    const c = cleans.get(pno);
    const matches = [];
    for (const [sno, s] of scans.entries()) {
      if (!s.isCand) continue;
      const sc = slideMatch(c.size, s.size, s.g64, c.vFull, c.vCrop, s.vFull, s.vCrop);
      matches.push([sc, sno]);
    }
    matches.sort((a, b) => b[0] - a[0]);
    cleanOut[String(pno)] = {
      page: pno,
      size: c.size,
      sat: c.sat,
      white: c.white,
      gray_mid: c.gray_mid,
      osc: c.osc,
      bestScan: matches.length ? matches[0][1] : null,
      bestCorr: matches.length ? Number(matches[0][0].toFixed(4)) : 0,
      top3: matches.slice(0, 3).map(([sc, sno]) => [sno, Number(sc.toFixed(4))]),
    };
  }

  const scanOut = {};
  for (const [sno, s] of [...scans.entries()].sort((a, b) => a[0] - b[0])) {
    scanOut[String(sno)] = {
      pdfPage: sno,
      size: s.size,
      sat: s.sat,
      white: s.white,
      gray_mid: s.gray_mid,
      osc: s.osc,
      isSceneArt: s.isSceneArt,
    };
  }

  return { scans: scanOut, cleans: cleanOut, coverDups };
}

function renderCleanFromScan(scanFile, outFile) {
  try {
    cropScanLetterboxToWebp(scanFile, outFile, { quality: 82 });
  } catch {
    const buf = fs.readFileSync(scanFile);
    writeWebp(buf, outFile);
  }
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function selectFrontIllustrations(frontPool, slotCount, coverDups) {
  if (frontPool.length <= slotCount) return frontPool;

  // Kapak kopyalarını (örn. yazısız kapak / şeritli kapak varyantlarını) yalnızca yuva sayısı aşıldığında ele
  const dupDropSet = new Set();
  for (const [pPrimary, dups] of Object.entries(coverDups || {})) {
    const primaryExists = frontPool.some((x) => x.origPage === Number(pPrimary));
    if (!primaryExists) continue;
    for (const [dupPage] of dups) {
      if (frontPool.length - dupDropSet.size > slotCount) {
        dupDropSet.add(Number(dupPage));
      }
    }
  }

  const filtered = frontPool.filter((x) => !dupDropSet.has(x.origPage));
  return filtered.slice(0, slotCount);
}

function alignVolume(volKey, { dryRun = false, verifyOnly = false } = {}) {
  const cfg = VOLUMES[volKey];
  if (!cfg) throw new Error(`Bilinmeyen cilt: ${volKey}`);

  const volImgDir = path.join(ROOT, cfg.imgDir);
  const scanDir = path.join(volImgDir, 'scan');
  const scanMapFile = path.join(ROOT, cfg.dataDir, 'scan_map.json');

  if (!fs.existsSync(scanDir) || !fs.existsSync(scanMapFile)) {
    throw new Error(`Cilt ${volKey} için scan/ dizini veya scan_map.json bulunamadı.`);
  }

  const source = JSON.parse(fs.readFileSync(cfg.sourceFile, 'utf8'));
  const tr = JSON.parse(fs.readFileSync(cfg.finalFile, 'utf8'));
  const chaptersMeta = JSON.parse(fs.readFileSync(cfg.titlesFile, 'utf8'));
  const scanMapObj = JSON.parse(fs.readFileSync(scanMapFile, 'utf8'));
  const scanMap = [...scanMapObj.map];
  const scanCount = scanMapObj.count || Object.keys(fs.readdirSync(scanDir)).length;

  const analysis = analyzeVolumeImages(volImgDir);
  const scans = analysis.scans;
  const cleans = analysis.cleans;

  // İlk hikâye bölümü (Prolog / Bölüm 1) başlangıç sayfası ve PDF karşılığı
  const firstStoryChapter =
    (chaptersMeta.chapters || []).find((c) => c.label !== 'İllüstrasyonlar' && (c.startPage || c.page) > 1) ||
    (chaptersMeta.chapters || [])[1];
  const firstBodyPage = firstStoryChapter ? firstStoryChapter.startPage || firstStoryChapter.page : 5;
  const firstBodyPdf = scanMap[firstBodyPage - 1];

  // Disk üzerindeki tüm mevcut temiz .webp baytlarını belleğe al
  const origBuffers = new Map();
  for (const key of Object.keys(cleans)) {
    const pno = Number(key);
    origBuffers.set(pno, fs.readFileSync(path.join(volImgDir, `${pad3(pno)}.webp`)));
  }

  // PDF gövdesindeki tüm gerçek sahne illüstrasyonu sayfaları
  const bodyScenePdfList = Object.values(scans)
    .filter((s) => s.pdfPage >= firstBodyPdf && s.isSceneArt)
    .map((s) => s.pdfPage)
    .sort((a, b) => a - b);
  const bodyScenePdfSet = new Set(bodyScenePdfList);

  // Mevcut temiz .webp görsellerini: (1) gövde sahne çizimi, (2) ön renkli/kuchie çizim, (3) elenecek iç başlık sayfası olarak ayır
  const cleanByBodyPdf = new Map();
  const frontCandidates = [];
  const droppedNonArt = [];

  for (const info of Object.values(cleans).sort((a, b) => a.page - b.page)) {
    const buf = origBuffers.get(info.page);
    if (info.bestCorr >= 0.88 && bodyScenePdfSet.has(info.bestScan)) {
      const prev = cleanByBodyPdf.get(info.bestScan);
      if (!prev || info.bestCorr > prev.corr) {
        cleanByBodyPdf.set(info.bestScan, {
          origPage: info.page,
          pdfPage: info.bestScan,
          corr: info.bestCorr,
          buffer: buf,
        });
      }
      continue;
    }

    // Ön kısımdaki salt metin / iç başlık logosu sayfalarını (beyaz > %90 ve renksiz) sahne çizimi sayma
    const matchedFrontScan = info.bestCorr >= 0.88 && info.bestScan < firstBodyPdf ? info.bestScan : null;
    if (info.white > 0.90 && info.sat < 0.5) {
      droppedNonArt.push({ origPage: info.page, reason: `iç başlık/boş sayfa (PDF s.${info.bestScan})` });
      continue;
    }

    if (info.page < firstBodyPage || matchedFrontScan !== null || info.sat >= 5.0) {
      frontCandidates.push({
        origPage: info.page,
        matchedScan: matchedFrontScan,
        corr: info.bestCorr,
        sat: info.sat,
        buffer: buf,
      });
    } else {
      droppedNonArt.push({ origPage: info.page, reason: `eşleşmeyen görsel (en yakın PDF s.${info.bestScan}, corr=${info.bestCorr})` });
    }
  }

  // Ön İllüstrasyonlar bölümündeki mevcut boş yuvalar
  const frontEmptySlots = source
    .filter((p) => p.page < firstBodyPage && !String(p.text || '').trim())
    .map((p) => p.page);
  const chosenFront = selectFrontIllustrations(frontCandidates, frontEmptySlots.length, analysis.coverDups);

  // Hikâye gövdesini (firstBodyPage..son) düzyazı çapaları ve aralarındaki boş yuva gruplarına ayır
  const prosePages = [];
  for (let i = firstBodyPage - 1; i < source.length; i++) {
    const p = source[i];
    if (String(p.text || '').trim().length > 0) {
      prosePages.push({ idx: i, page: p.page, pdf: scanMap[i] });
    }
  }

  // Her boşluğu [afterProseIdx, beforeProseIdx] olarak tanımla
  const gaps = [];
  for (let g = 0; g < prosePages.length; g++) {
    const curProse = prosePages[g];
    const nextProse = prosePages[g + 1] || null;
    const startIdx = curProse.idx + 1;
    const endIdx = nextProse ? nextProse.idx - 1 : source.length - 1;
    const emptyIdxs = [];
    for (let k = startIdx; k <= endIdx; k++) emptyIdxs.push(k);

    const loPdf = curProse.pdf;
    const hiPdf = nextProse ? nextProse.pdf : scanCount + 1;
    const illPdfs = bodyScenePdfList.filter((pg) => pg > loPdf && pg < hiPdf);
    gaps.push({
      afterPage: curProse.page,
      loPdf,
      hiPdf,
      insertAfterIdx: endIdx,
      emptyIdxs,
      illPdfs,
    });
  }

  // Ayrıca ilk gövde sayfasından hemen önce boşluk kalmışsa (normalde olmaz) kontrol et
  // Şimdi yeni sayfa dizisini (newEntries) oluştur; yalnızca gerçek PDF görsel konumunda boş yuva eksikse ekle
  const insertSpecsByAfterIdx = new Map();
  for (const gap of gaps) {
    if (gap.illPdfs.length > gap.emptyIdxs.length) {
      const missingPdfs = gap.illPdfs.slice(gap.emptyIdxs.length);
      insertSpecsByAfterIdx.set(gap.insertAfterIdx, {
        existingEmptyIdxs: gap.emptyIdxs,
        existingIllPdfs: gap.illPdfs.slice(0, gap.emptyIdxs.length),
        missingPdfs,
      });
    }
  }

  // Mevcut boş yuvaların PDF ataması veya kaldırılması
  const slotTargetPdf = new Map(); // oldIdx -> pdfPage | null (null = boş ayırıcı, .webp kaldırılır)
  const slotScanFallback = new Map(); // oldIdx -> scan_map değeri

  // Ön yuvalar: mevcut ön çizimlerin tamamı zaten geçerli ön yuvalardaysa (örn. temizlenmiş künye sayfası
  // boş bırakılmışsa: C6 s.6 boş + 007.webp, C7 s.5 boş + 006.webp) mevcut yuva numaralarını koru.
  const frontEmptySet = new Set(frontEmptySlots);
  const chosenOrigPages = new Set(chosenFront.map((f) => f.origPage));
  const preserveExistingFrontSlots =
    chosenFront.length < frontEmptySlots.length &&
    chosenOrigPages.size === chosenFront.length &&
    chosenFront.every((f) => frontEmptySet.has(f.origPage));

  if (preserveExistingFrontSlots) {
    const byOrigPage = new Map(chosenFront.map((f) => [f.origPage, f]));
    for (const pno of frontEmptySlots) {
      const idx = pno - 1;
      const item = byOrigPage.get(pno) || null;
      if (item) {
        slotTargetPdf.set(idx, { kind: 'front', frontItem: item });
        if (item.matchedScan) {
          slotScanFallback.set(idx, item.matchedScan);
        }
      } else {
        slotTargetPdf.set(idx, null);
      }
    }
  } else {
    frontEmptySlots.forEach((pno, k) => {
      const idx = pno - 1;
      const item = chosenFront[k] || null;
      if (item) {
        slotTargetPdf.set(idx, { kind: 'front', frontItem: item });
        if (item.matchedScan) {
          slotScanFallback.set(idx, item.matchedScan);
        }
      } else {
        slotTargetPdf.set(idx, null);
      }
    });
  }

  // Gövde boşlukları
  for (const gap of gaps) {
    const { emptyIdxs, illPdfs, loPdf, hiPdf } = gap;
    if (emptyIdxs.length === 0) continue;

    if (illPdfs.length === 0) {
      emptyIdxs.forEach((idx, pos) => {
        slotTargetPdf.set(idx, null);
        slotScanFallback.set(idx, Math.min(hiPdf - 1, loPdf + 1 + pos));
      });
    } else if (emptyIdxs.length === illPdfs.length) {
      emptyIdxs.forEach((idx, pos) => {
        slotTargetPdf.set(idx, { kind: 'body', pdfPage: illPdfs[pos] });
        slotScanFallback.set(idx, illPdfs[pos]);
      });
    } else if (emptyIdxs.length > illPdfs.length) {
      // Birden fazla ardışık boş yuva varsa (örn. 1 boş sayfa + 1 illüstrasyon), PDF ofsetine göre en yakın yuvayı seç
      const span = Math.max(1, hiPdf - loPdf - 1);
      const usedSlots = new Set();
      for (const pdfPg of illPdfs) {
        const rel = Math.min(emptyIdxs.length - 1, Math.max(0, Math.round(((pdfPg - (loPdf + 1)) / Math.max(1, span - 1)) * (emptyIdxs.length - 1))));
        let chosenSlot = emptyIdxs[rel];
        if (usedSlots.has(chosenSlot)) {
          chosenSlot = emptyIdxs.find((s) => !usedSlots.has(s));
        }
        usedSlots.add(chosenSlot);
        slotTargetPdf.set(chosenSlot, { kind: 'body', pdfPage: pdfPg });
        slotScanFallback.set(chosenSlot, pdfPg);
      }
      emptyIdxs.forEach((idx, pos) => {
        if (!usedSlots.has(idx)) {
          slotTargetPdf.set(idx, null);
          slotScanFallback.set(idx, Math.min(hiPdf - 1, loPdf + 1 + pos));
        }
      });
    } else {
      // emptyIdxs.length < illPdfs.length (ilk kısım mevcut yuvalara, kalanlar insertSpecsByAfterIdx ile eklenecek)
      emptyIdxs.forEach((idx, pos) => {
        slotTargetPdf.set(idx, { kind: 'body', pdfPage: illPdfs[pos] });
        slotScanFallback.set(idx, illPdfs[pos]);
      });
    }
  }

  // Nihai sayfa listesini inşa et
  const finalRecords = [];
  const oldPageToNewPage = new Map();

  for (let i = 0; i < source.length; i++) {
    const orig = source[i];
    const newPageNo = finalRecords.length + 1;
    oldPageToNewPage.set(orig.page, newPageNo);

    const trArr = Array.isArray(tr[String(orig.page)]) ? tr[String(orig.page)] : [];
    const target = slotTargetPdf.has(i) ? slotTargetPdf.get(i) : undefined;
    const updatedScan = slotScanFallback.has(i) ? slotScanFallback.get(i) : scanMap[i];

    finalRecords.push({
      page: newPageNo,
      origPage: orig.page,
      text: orig.text,
      thumb: orig.thumb || '',
      pending: orig.pending,
      tr: trArr,
      scanPdf: updatedScan,
      artSpec: target, // undefined (prose), null (boş ayırıcı), veya { kind: 'front'|'body', ... }
    });

    const ins = insertSpecsByAfterIdx.get(i);
    if (ins) {
      for (const missingPdf of ins.missingPdfs) {
        const insPageNo = finalRecords.length + 1;
        finalRecords.push({
          page: insPageNo,
          origPage: null,
          text: '',
          thumb: '',
          pending: undefined,
          tr: [],
          scanPdf: missingPdf,
          artSpec: { kind: 'body', pdfPage: missingPdf, inserted: true },
        });
      }
    }
  }

  // scan_map monotonluğunu garanti altına al (ön sayfalar hariç gövdede geri gidiş olmasın)
  for (let i = 1; i < finalRecords.length; i++) {
    if (finalRecords[i].scanPdf < finalRecords[i - 1].scanPdf) {
      finalRecords[i].scanPdf = finalRecords[i - 1].scanPdf;
    }
  }

  // İstatistikleri ve değişiklik özetini hazırla
  const insertedPages = finalRecords.filter((r) => r.origPage === null).map((r) => ({ page: r.page, pdf: r.scanPdf }));
  const removedSeparators = finalRecords
    .filter((r) => r.artSpec === null && r.origPage && origBuffers.has(r.origPage))
    .map((r) => r.page);
  const bodyArtAssignments = finalRecords
    .filter((r) => r.artSpec && r.artSpec.kind === 'body')
    .map((r) => {
      const pdfPg = r.artSpec.pdfPage;
      const cleanMatch = cleanByBodyPdf.get(pdfPg);
      return {
        page: r.page,
        pdfPage: pdfPg,
        fromOrigPage: cleanMatch ? cleanMatch.origPage : null,
        corr: cleanMatch ? cleanMatch.corr : null,
        generatedFromScan: !cleanMatch,
      };
    });

  const misalignedBefore = bodyArtAssignments.filter((a) => a.fromOrigPage !== a.page || a.generatedFromScan);

  if (verifyOnly) {
    return {
      vol: volKey,
      ok: misalignedBefore.length === 0 && removedSeparators.length === 0 && insertedPages.length === 0,
      misalignedBefore,
      removedSeparators,
      insertedPages,
      bodyArtAssignments,
    };
  }

  console.log(`\n=== Cilt ${volKey} İllüstrasyon Hizalama Özeti ===`);
  console.log(
    `  Ön çizimler (İllüstrasyonlar): ${chosenFront.length}/${frontEmptySlots.length} yuva ` +
      `[${chosenFront.map((f, idx) => `${pad3(frontEmptySlots[idx])}<-eski ${pad3(f.origPage)}`).join(', ')}]`
  );
  if (droppedNonArt.length) {
    console.log(
      `  Ayıklanan başlık/fazla görseller: ${droppedNonArt.map((d) => `${pad3(d.origPage)}.webp (${d.reason})`).join(', ')}`
    );
  }
  if (removedSeparators.length) {
    console.log(`  Boş bölüm ayırıcılarından kaldırılan yanlış .webp yuvaları: ${removedSeparators.map(pad3).join(', ')}`);
  }
  if (insertedPages.length) {
    console.log(
      `  Eksik PDF görsel konumuna eklenen yeni boş yuvalar: ${insertedPages.map((x) => `s.${x.page} (PDF s.${x.pdf})`).join(', ')}`
    );
  }
  for (const b of bodyArtAssignments) {
    const srcDesc = b.generatedFromScan
      ? `scan/${pad3(b.pdfPage)}.webp kaynağından üretildi`
      : `eski ${pad3(b.fromOrigPage)}.webp (corr=${b.corr})`;
    console.log(`  Gövde s.${pad3(b.page)} <-> PDF s.${pad3(b.pdfPage)} : ${srcDesc}`);
  }

  if (dryRun) {
    console.log(`  [dry-run] Cilt ${volKey} için disk değişikliği yazılmadı.`);
    return { vol: volKey, dryRun: true, bodyArtAssignments, removedSeparators, insertedPages };
  }

  // 1) WebP dosyalarını güncelle: önce mevcut kök *.webp dosyalarını temizle, sonra doğru yuvalara yaz
  for (const f of fs.readdirSync(volImgDir)) {
    if (f.endsWith('.webp')) {
      fs.unlinkSync(path.join(volImgDir, f));
    }
  }

  for (const r of finalRecords) {
    if (!r.artSpec) continue;
    const outWebp = path.join(volImgDir, `${pad3(r.page)}.webp`);
    if (r.artSpec.kind === 'front') {
      fs.writeFileSync(outWebp, r.artSpec.frontItem.buffer);
    } else if (r.artSpec.kind === 'body') {
      const match = cleanByBodyPdf.get(r.artSpec.pdfPage);
      if (match) {
        fs.writeFileSync(outWebp, match.buffer);
      } else {
        const scanFile = path.join(scanDir, `${pad3(r.artSpec.pdfPage)}.webp`);
        renderCleanFromScan(scanFile, outWebp);
      }
    }
  }

  // 2) Veri dosyalarını yalnızca sayfa ekleme veya scan_map değişikliği varsa minimal farkla yaz
  const newSource = finalRecords.map((r) => {
    const item = {
      page: r.page,
      img: `${cfg.imgPrefix}${pad3(r.page)}.webp`,
      thumb: r.thumb,
      text: r.text,
    };
    if (r.pending) item.pending = true;
    return item;
  });

  const newScanMapObj = {
    map: finalRecords.map((r) => r.scanPdf),
    dir: scanMapObj.dir || 'scan',
    count: scanCount,
  };

  if (JSON.stringify(source) !== JSON.stringify(newSource)) {
    fs.writeFileSync(cfg.sourceFile, JSON.stringify(newSource, null, 2) + '\n');
  }

  if (JSON.stringify(scanMapObj) !== JSON.stringify(newScanMapObj)) {
    fs.writeFileSync(scanMapFile, JSON.stringify(newScanMapObj));
  }

  // paragraphs_final.json: metin içeriklerine dokunmadan yalnızca yeni eklenen boş yuva anahtarlarını senkronla
  const newTr = {};
  for (const r of finalRecords) {
    newTr[String(r.page)] = r.tr;
  }
  if (JSON.stringify(tr) !== JSON.stringify(newTr)) {
    fs.writeFileSync(cfg.finalFile, JSON.stringify(newTr, null, 2) + '\n');
  }

  // chapters.json: sayfa kayması olduysa startPage ve titles anahtarlarını güncelle
  const newTitles = {};
  for (const [k, v] of Object.entries(chaptersMeta.titles || {})) {
    const mapped = oldPageToNewPage.get(Number(k)) || Number(k);
    newTitles[String(mapped)] = v;
  }
  const newChapters = (chaptersMeta.chapters || []).map((c) => {
    const origStart = c.startPage || c.page;
    const mappedStart = oldPageToNewPage.get(origStart) || origStart;
    return {
      ...c,
      ...(c.startPage !== undefined ? { startPage: mappedStart } : { page: mappedStart }),
    };
  });
  const newChaptersMeta = { ...chaptersMeta, titles: newTitles, chapters: newChapters };
  if (JSON.stringify(chaptersMeta) !== JSON.stringify(newChaptersMeta)) {
    fs.writeFileSync(cfg.titlesFile, JSON.stringify(newChaptersMeta, null, 2) + '\n');
  }

  // data/quality/v<vol>.json ve scripts/tn_notes.json: gövdeye yeni görsel yuvası eklendiğinde kayan sayfa anahtarlarını
  // hizala ve hiçbir anahtarın boş illüstrasyon (art) sayfasına düşmemesini garanti et.
  const bodyArtPageSet = new Set(
    finalRecords.filter((r) => r.artSpec && r.artSpec.kind === 'body' && !String(r.text || '').trim()).map((r) => r.page)
  );
  const shiftAwayFromArtSlot = (pageNum) => {
    let target = oldPageToNewPage.get(pageNum) || pageNum;
    while (bodyArtPageSet.has(target) && target < finalRecords.length) {
      target++;
    }
    return target;
  };

  const hasPageShift = [...oldPageToNewPage.entries()].some(([origP, newP]) => origP !== newP);
  const qFile = path.join(ROOT, 'data', 'quality', `v${volKey}.json`);
  if (fs.existsSync(qFile)) {
    const qObj = JSON.parse(fs.readFileSync(qFile, 'utf8'));
    const newQ = {};
    for (const [k, v] of Object.entries(qObj)) {
      const mapped = hasPageShift || bodyArtPageSet.has(Number(k)) ? shiftAwayFromArtSlot(Number(k)) : Number(k);
      newQ[String(mapped)] = v;
    }
    if (JSON.stringify(qObj) !== JSON.stringify(newQ)) {
      fs.writeFileSync(qFile, JSON.stringify(newQ, null, 2) + '\n');
    }
  }

  const tnFile = path.join(ROOT, 'scripts', 'tn_notes.json');
  if (fs.existsSync(tnFile)) {
    const tnAll = JSON.parse(fs.readFileSync(tnFile, 'utf8'));
    if (tnAll[volKey] && typeof tnAll[volKey] === 'object') {
      const newVolTn = {};
      for (const [k, v] of Object.entries(tnAll[volKey])) {
        const mapped = hasPageShift || bodyArtPageSet.has(Number(k)) ? shiftAwayFromArtSlot(Number(k)) : Number(k);
        newVolTn[String(mapped)] = v;
      }
      if (JSON.stringify(tnAll[volKey]) !== JSON.stringify(newVolTn)) {
        tnAll[volKey] = newVolTn;
        fs.writeFileSync(tnFile, JSON.stringify(tnAll, null, 2) + '\n');
      }
    }
  }

  return { vol: volKey, bodyArtAssignments, removedSeparators, insertedPages };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  let hasMismatch = false;
  for (const v of opts.vols) {
    const res = alignVolume(v, opts);
    if (opts.verifyOnly && !res.ok) {
      hasMismatch = true;
      console.error(`✗ Cilt ${v} hizalama doğrulaması başarısız:`, res.misalignedBefore);
    }
  }
  if (opts.verifyOnly && hasMismatch) process.exit(1);
}

module.exports = {
  alignVolume,
  analyzeVolumeImages,
};
