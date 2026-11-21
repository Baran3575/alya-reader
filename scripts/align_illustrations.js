#!/usr/bin/env node
// Cilt 5, 6 ve 7 (veya scan/ dizini bulunan herhangi bir cilt) için sahne illüstrasyonlarını
// referans PDF taramalarıyla (public/pages<vol>/scan/*.webp) algısal özet / piksel korelasyonu
// üzerinden doğrulamalı olarak hizalar.
//
// Kullanım:
//   node scripts/align_illustrations.js [--volume 5,6,7] [--dry-run] [--verify-only]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, VOLUMES } = require('./lib/volumes');
const { writeWebp } = require('./ingest/lib/webp');

const DEFAULT_VOLS = ['5', '6', '7'];

const PY_ANALYZER = `
import glob, json, os, sys
from PIL import Image

vol_dir = sys.argv[1]
scan_dir = os.path.join(vol_dir, 'scan')

def nvec(im, size=32):
    g = im.convert('L').resize((size, size), Image.Resampling.BILINEAR)
    px = list(g.tobytes())
    mean = sum(px) / len(px)
    var = sum((x - mean) ** 2 for x in px) / len(px)
    std = (var ** 0.5) or 1.0
    return [(x - mean) / std for x in px]

def corr(a, b):
    return sum(x * y for x, y in zip(a, b)) / len(a)

def crop_nonwhite_band(im):
    small = im.resize((96, 144), Image.Resampling.BILINEAR)
    w, h = small.size
    g = small.convert('L')
    px = g.tobytes()
    ys = [y for y in range(h) if sum(1 for v in px[y * w:(y + 1) * w] if v < 245) > w * 0.08]
    xs = [x for x in range(w) if sum(1 for y in range(h) if px[y * w + x] < 245) > h * 0.05]
    if ys and xs and (ys[-1] - ys[0]) > h * 0.20 and (xs[-1] - xs[0]) > w * 0.30:
        return small.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))
    return small

def img_stats(im):
    rgb_small = im.convert('RGB').resize((64, 96), Image.Resampling.BILINEAR)
    raw = rgb_small.tobytes()
    sat = sum(max(raw[i], raw[i+1], raw[i+2]) - min(raw[i], raw[i+1], raw[i+2]) for i in range(0, len(raw), 3)) / (len(raw) // 3)

    g = im.convert('L').resize((100, 150), Image.Resampling.BILINEAR)
    gb = list(g.tobytes())
    white = sum(1 for x in gb if x > 240) / len(gb)
    gray_mid = sum(1 for x in gb if 50 < x <= 225) / len(gb)
    rows = [sum(gb[r * 100:(r + 1) * 100]) / 100.0 for r in range(150)]
    osc = sum(abs(rows[r + 1] - rows[r]) for r in range(15, 135)) / 120.0
    return round(sat, 3), round(white, 4), round(gray_mid, 4), round(osc, 3)

def slide_match(clean_size, scan_g64, vc_full, vc_crop, vs_full, vs_crop):
    best = max(corr(vc_full, vs_full), corr(vc_crop, vs_crop), corr(vc_full, vs_crop))
    cw, ch = clean_size
    sw, sh = scan_g64.size
    if cw > ch and sh > sw:
        th = round(sw * ch / cw)
        if 8 <= th <= sh:
            for y in range(0, sh - th + 1, 2):
                c = corr(vc_full, nvec(scan_g64.crop((0, y, sw, y + th))))
                if c > best:
                    best = c
    return best

scans = {}
for sf in sorted(glob.glob(os.path.join(scan_dir, '*.webp'))):
    sno = int(os.path.basename(sf).split('.')[0])
    im = Image.open(sf).convert('RGB')
    sat, white, gray_mid, osc = img_stats(im)
    is_scene_art = bool(white < 0.70 and gray_mid > 0.22 and osc < 7.0)
    is_cand = bool(is_scene_art or sno <= 14 or osc < 8.5 or white < 0.75)
    scans[sno] = {
        'g64': im.convert('L').resize((64, 96), Image.Resampling.BILINEAR) if is_cand else None,
        'size': list(im.size),
        'sat': sat,
        'white': white,
        'gray_mid': gray_mid,
        'osc': osc,
        'v_full': nvec(im) if is_cand else None,
        'v_crop': nvec(crop_nonwhite_band(im)) if is_cand else None,
        'is_scene_art': is_scene_art,
        'is_cand': is_cand,
    }

cleans = {}
for cf in sorted(glob.glob(os.path.join(vol_dir, '*.webp'))):
    pno = int(os.path.basename(cf).split('.')[0])
    im = Image.open(cf).convert('RGB')
    sat, white, gray_mid, osc = img_stats(im)
    cleans[pno] = {
        'im': im,
        'size': list(im.size),
        'sat': sat,
        'white': white,
        'gray_mid': gray_mid,
        'osc': osc,
        'v_full': nvec(im),
        'v_crop': nvec(crop_nonwhite_band(im)),
    }

# Pairwise similarity among portrait front candidates (for cover variant deduplication)
clean_keys = sorted(cleans.keys())
cover_dups = {}
for i, p1 in enumerate(clean_keys):
    c1 = cleans[p1]
    if c1['size'][0] >= c1['size'][1] or c1['sat'] < 3.0:
        continue
    im1 = c1['im']
    sub1 = nvec(im1.crop((int(im1.width * 0.18), int(im1.height * 0.25), int(im1.width * 0.82), int(im1.height * 0.85))))
    for p2 in clean_keys[i + 1:]:
        c2 = cleans[p2]
        if c2['size'][0] >= c2['size'][1] or c2['sat'] < 3.0:
            continue
        im2 = c2['im']
        best_sub = corr(c1['v_full'], c2['v_full'])
        for dx in (0, 30, 60):
            for dy in (0, 25, 50):
                x0 = min(im2.width - 32, dx + int(im2.width * 0.12))
                y0 = min(im2.height - 32, dy + int(im2.height * 0.22))
                x1 = min(im2.width, x0 + int(im2.width * 0.72))
                y1 = min(im2.height, y0 + int(im2.height * 0.64))
                if x1 - x0 > 64 and y1 - y0 > 64:
                    sc = corr(sub1, nvec(im2.crop((x0, y0, x1, y1))))
                    if sc > best_sub:
                        best_sub = sc
        if best_sub >= 0.56:
            cover_dups.setdefault(str(p1), []).append([p2, round(best_sub, 4)])

clean_out = {}
for pno, c in sorted(cleans.items()):
    matches = []
    for sno, s in scans.items():
        if not s['is_cand']:
            continue
        sc = slide_match(c['size'], s['g64'], c['v_full'], c['v_crop'], s['v_full'], s['v_crop'])
        matches.append((sc, sno))
    matches.sort(reverse=True)
    clean_out[str(pno)] = {
        'page': pno,
        'size': c['size'],
        'sat': c['sat'],
        'white': c['white'],
        'gray_mid': c['gray_mid'],
        'osc': c['osc'],
        'bestScan': matches[0][1] if matches else None,
        'bestCorr': round(matches[0][0], 4) if matches else 0,
        'top3': [[sno, round(sc, 4)] for sc, sno in matches[:3]],
    }

scan_out = {
    str(sno): {
        'pdfPage': sno,
        'size': s['size'],
        'sat': s['sat'],
        'white': s['white'],
        'gray_mid': s['gray_mid'],
        'osc': s['osc'],
        'isSceneArt': s['is_scene_art'],
    }
    for sno, s in sorted(scans.items())
}

print(json.dumps({'scans': scan_out, 'cleans': clean_out, 'coverDups': cover_dups}))
`;

const PY_CLEAN_FROM_SCAN = `
import sys
from PIL import Image

scan_path, out_path = sys.argv[1], sys.argv[2]
im = Image.open(scan_path).convert('RGB')
w, h = im.size
g = im.convert('L')
px = g.tobytes()

# Yatay çift sayfa çizim dikey PDF sayfasına yerleştirilmişse beyaz letterbox bantlarını kırp
ys = [y for y in range(h) if sum(1 for v in px[y * w:(y + 1) * w] if v < 244) > w * 0.10]
if ys and (ys[-1] - ys[0] + 1) < h * 0.72 and (ys[-1] - ys[0] + 1) > h * 0.35:
    im = im.crop((0, ys[0], w, ys[-1] + 1))

im.save(out_path, 'WEBP', quality=82, method=4)
`;

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

function analyzeVolumeImages(volDir) {
  const stdout = execFileSync('python3', ['-c', PY_ANALYZER, volDir], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function renderCleanFromScan(scanFile, outFile) {
  try {
    execFileSync('python3', ['-c', PY_CLEAN_FROM_SCAN, scanFile, outFile], { stdio: 'pipe' });
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

  // Ön yuvalar
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

  // data/quality/v<vol>.json ve scripts/tn_notes.json: gövdeye yeni görsel yuvası eklendiğinde kayan sayfa anahtarlarını hizala
  const hasPageShift = [...oldPageToNewPage.entries()].some(([origP, newP]) => origP !== newP);
  if (hasPageShift) {
    const qFile = path.join(ROOT, 'data', 'quality', `v${volKey}.json`);
    if (fs.existsSync(qFile)) {
      const qObj = JSON.parse(fs.readFileSync(qFile, 'utf8'));
      const newQ = {};
      for (const [k, v] of Object.entries(qObj)) {
        const mapped = oldPageToNewPage.get(Number(k));
        newQ[mapped ? String(mapped) : k] = v;
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
          const mapped = oldPageToNewPage.get(Number(k));
          newVolTn[mapped ? String(mapped) : k] = v;
        }
        if (JSON.stringify(tnAll[volKey]) !== JSON.stringify(newVolTn)) {
          tnAll[volKey] = newVolTn;
          fs.writeFileSync(tnFile, JSON.stringify(tnAll, null, 2) + '\n');
        }
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
