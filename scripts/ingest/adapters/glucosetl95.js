// Cilt 9.5 (Behind the Scenes) adaptörü:
//  1) GlucoseTL Anubis SHA-256 PoW (difficulty=4) çözümü (behind-the-scenes ve behind-the-scenes/illustrations)
//  2) Google Drive üzerinden 7 illüstrasyon + 16 kısa hikâye PNG klasörünün çekilmesi
//  3) Çok kipli görsel LLM API (OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY) veya yerel Tesseract OCR ile metne döküm
//  4) ~1.400 karakter/sayfa sentetik sayfalama -> data95/source.json, data95/chapters.json ve public/pages95/*.webp
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { fetchWithAnubis } = require('../lib/anubis');
const { listDriveFolder, downloadDriveBuffer } = require('../lib/gdrive');
const { ensureDir, readCacheJson, writeCacheJson } = require('../lib/cache');
const { isFullPageIllustration, writeWebp, getImageDimensions } = require('../lib/webp');
const { paginateSections } = require('../lib/paginate');

const execFileAsync = promisify(execFile);

const TOC_URL = 'https://glucosetl.xyz/translations/roshidere/behind-the-scenes';
const ILLUST_URL = 'https://glucosetl.xyz/translations/roshidere/behind-the-scenes/illustrations';

// Doğrulanmış GlucoseTL V9.5 Google Drive klasör haritası (RSC ayrıştırmasıyla çapraz doğrulanır)
const DEFAULT_V95_ILLUST_FOLDER = '1JibvE6vLzXsCJ0wbugkLO83jjKrY-_U3';
const DEFAULT_V95_STORIES = [
  { slug: 'new-ss-1', folderId: '1pjQH08jjZixtPtruApeshqSF2Hki5eOH', label: 'Kısa Hikâye 1', enTitle: "Right, Let's Go to a Cat Café" },
  { slug: 'new-ss-2', folderId: '1XapYwheFcaBceg77QI1AAIfDL2b0z7lz', label: 'Kısa Hikâye 2', enTitle: "Right, Let's Go to the Pool" },
  { slug: 'bookwalker-exclusive-ss', folderId: '1ABKCRNyrOPgFjqTnzImBboSGaPcTecux', label: 'Kısa Hikâye 3', enTitle: "I'll Make Myself More Huggable If It Ain't Enough" },
  { slug: 'fair-bonus-ss-1', folderId: '1H2vXhRvWH3GYxoellWH5rs78gqCjqCtR', label: 'Kısa Hikâye 4', enTitle: 'Animate Store Clerk Dreams of Being a Normie Otaku' },
  { slug: 'fair-bonus-ss-2', folderId: '1dF8ueomztHTh_yAkUPrQGEB49seEIPcP', label: 'Kısa Hikâye 5', enTitle: "Alya's First Word Imposter Game" },
  { slug: 'fair-bonus-ss-3', folderId: '158SqQSICKZnfX5IjA0L58PJf0IdKQxXw', label: 'Kısa Hikâye 6', enTitle: "A Man's Dream" },
  { slug: 'volume-7-bonus-short-story-1', folderId: '1-BPZwXQmHYNeTw-0DjzxSQ7AaVfJj3Q3', label: 'Kısa Hikâye 7', enTitle: "The Maid's Seen It All" },
  { slug: 'volume-7-bonus-short-story-2', folderId: '1HqkJEeyC_isE4lvtO3E2ALWcURjTA8wR', label: 'Kısa Hikâye 8', enTitle: 'The Donna Bulldozes Through the Competition' },
  { slug: 'volume-7-bonus-short-story-3', folderId: '1TTrhjX2iAEMkudenW2rI2ZJy1tg3sKkY', label: 'Kısa Hikâye 9', enTitle: 'Bunny Panic!!!' },
  { slug: 'volume-6-bonus-short-story-1', folderId: '1r2aZ-OjSpX2VkhsAf7GYiOh4eP_kyUUV', label: 'Kısa Hikâye 10', enTitle: 'A Friendly (?) Compatibility Reading Threesome' },
  { slug: 'volume-6-bonus-short-story-2', folderId: '1RniAKNB0z8PuIKNwSXE7sCQi4zxToMRE', label: 'Kısa Hikâye 11', enTitle: "Sensei~, Prez and Vice Prez Keep Acting Like They're in Some Rom-Com at Every Opportunity~!" },
  { slug: 'volume-6-bonus-short-story-3', folderId: '1xNK7NEfCQ4_oPq_l5bfvSyI6OpbUBUwt', label: 'Kısa Hikâye 12', enTitle: 'Is This a Bodybuilding Club, or Something?' },
  { slug: 'volume-5-bonus-short-story-1', folderId: '1pnhZSsaP-dzn4Rih8MK4iJ1aJkyRu-pM', label: 'Kısa Hikâye 13', enTitle: "Note: Masachika Ain't Good at Appraisals" },
  { slug: 'volume-5-bonus-short-story-2', folderId: '15APIamF2c-MYs4xPU_2qgbc_0hj-lSb5', label: 'Kısa Hikâye 14', enTitle: 'Looks Like Yuki-chan and Ayano-chan Have Returned to Their Childish Innocence' },
  { slug: 'volume-5-bonus-short-story-3', folderId: '1ZCGWzqlFm_Ul0nVdn_lqCAiqARCWTvad', label: 'Kısa Hikâye 15', enTitle: "Sensei~, Prez and Vice Prez Keep Acting Like They're in Some Rom-Com Even in Front of Someone Injured~!" },
  { slug: 'volume-5-bonus-short-story-4', folderId: '1-Iq0EnoVg_ego48F4t1JESVXTSk5BU3z', label: 'Kısa Hikâye 16', enTitle: "Club Activities Aren't Meant to Be Tribal" },
];

async function discoverGlucoseV95Manifest() {
  // Her iki Anubis korumalı uç noktayı çöz ve doğrula
  const tocRes = await fetchWithAnubis(TOC_URL);
  const illRes = await fetchWithAnubis(ILLUST_URL);
  console.log(
    `  [anubis] PoW doğrulandı: behind-the-scenes (HTTP ${tocRes.status}, PoW=${tocRes.solvedPow}) & illustrations (HTTP ${illRes.status})`
  );

  // RSC akışından driveFolderId eşlemelerini yakala
  let illustFolderId = DEFAULT_V95_ILLUST_FOLDER;
  const rscRes = await fetchWithAnubis('https://glucosetl.xyz/translations/roshidere', {
    headers: { RSC: '1' },
  }).catch(() => ({ text: '' }));

  const combinedText = `${tocRes.text}\n${illRes.text}\n${rscRes.text}`;
  const folderBySlug = new Map();
  const slugDriveRe = /"slug"\s*:\s*"([^"]+)"[^{}]{0,260}?"driveFolderId"\s*:\s*"([A-Za-z0-9_-]{20,})"/g;
  let m;
  while ((m = slugDriveRe.exec(combinedText)) !== null) {
    folderBySlug.set(m[1], m[2]);
  }
  if (folderBySlug.has('illustrations')) {
    illustFolderId = folderBySlug.get('illustrations');
  }

  const stories = DEFAULT_V95_STORIES.map((s) => ({
    ...s,
    folderId: folderBySlug.get(s.slug) || s.folderId,
  }));

  return { illustFolderId, stories };
}

async function transcribePngWithVisionLlm(pngBuf) {
  const b64 = pngBuf.toString('base64');
  const prompt =
    'Transcribe all English story text on this light novel page verbatim. Preserve paragraph breaks with blank lines. Exclude isolated page numbers at the bottom/top. Output ONLY the transcribed text.';

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        ],
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (out) return out.trim();
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/png', data: b64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const out =
        j.candidates &&
        j.candidates[0] &&
        j.candidates[0].content &&
        j.candidates[0].content.parts &&
        j.candidates[0].content.parts.map((p) => p.text || '').join('');
      if (out) return out.trim();
    }
  }

  return null;
}

function cleanOcrText(rawText) {
  let t = String(rawText || '')
    .replace(/\r/g, '')
    .replace(/\f/g, '')
    .replace(/(?:\.{2,}|…)2(?=["”’\s]|$)/g, '…?')
    // OCR'da tek başına zamir "I" yerine çıkan "|" işaretini onar
    .replace(/\|(?=(?:['’](?:m|ve|ll|d|re))\b)/g, 'I')
    .replace(/(^|[\s“"‘(\[])\|(?=[\s’',.!?;:—–-]|$)/gm, '$1I')
    .replace(/\|n\b/g, 'In')
    .replace(/\|t\b/g, 'It')
    .replace(/\|f\b/g, 'If');

  const rawLines = t.split('\n');
  const paragraphs = [];
  let cur = [];

  const flush = () => {
    if (!cur.length) return;
    // Satır sonu tirelemesini birleştir
    let merged = '';
    for (const part of cur) {
      if (!merged) {
        merged = part;
      } else if (/[a-z]-$/.test(merged) && /^[a-z]/.test(part)) {
        merged = merged.slice(0, -1) + part;
      } else {
        merged += ' ' + part;
      }
    }
    merged = merged.replace(/\s+/g, ' ').trim();
    if (merged) paragraphs.push(merged);
    cur = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i].trim();
    if (!ln) {
      flush();
      continue;
    }
    // Üst/alt tekil sayfa numarası
    if (/^(?:Page\s+)?\d{1,3}$/i.test(ln)) continue;
    // Yeni diyalog satırı açılıyorsa ve önceki satır cümle sonu noktalama taşıyorsa yeni paragraf başlat
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      const prevEnds = /[.!?"”’…)~]$/.test(prev);
      const startsQuote = /^["“‘']/.test(ln);
      if (prevEnds && (startsQuote || prev.length < 52)) {
        flush();
      }
    }
    cur.push(ln);
  }
  flush();

  return paragraphs;
}

async function transcribePng(fileId, fileName, pngBuf, { refresh = false, ocrOnly = false } = {}) {
  if (!refresh) {
    const cached = readCacheJson('v95-transcripts', fileId);
    if (cached && Array.isArray(cached.paragraphs)) return cached;
  }

  let visionText = null;
  if (!ocrOnly && (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)) {
    try {
      visionText = await transcribePngWithVisionLlm(pngBuf);
    } catch {}
  }

  if (visionText) {
    const paragraphs = visionText
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const out = { method: 'vision-llm', fileName, paragraphs };
    writeCacheJson('v95-transcripts', fileId, out);
    return out;
  }

  // Çok büyük boyuttaki (> 950 KB) veya adında illust/cover geçen dosyalar illüstrasyondur
  if (pngBuf.length > 950000 || /illust|insert|cover|kuchie/i.test(fileName)) {
    const out = { method: 'art-fastpath', fileName, paragraphs: [] };
    writeCacheJson('v95-transcripts', fileId, out);
    return out;
  }

  // Yerel Tesseract OCR geri dönüşü (1050px ön-ölçekleme + OMP_THREAD_LIMIT=1 + 12sn zaman aşımı)
  const rand = Math.random().toString(36).slice(2);
  const tmpRaw = path.join(os.tmpdir(), `alya_ocr_raw_${process.pid}_${fileId}_${rand}.png`);
  const tmpScaled = path.join(os.tmpdir(), `alya_ocr_scaled_${process.pid}_${fileId}_${rand}.webp`);
  try {
    fs.writeFileSync(tmpRaw, pngBuf);
    const dim = getImageDimensions(pngBuf);
    let ocrInput = tmpRaw;
    if (dim && dim.width > 1100) {
      await execFileAsync('cwebp', ['-quiet', '-q', '88', '-resize', '1050', '0', tmpRaw, '-o', tmpScaled], {
        timeout: 8000,
      });
      ocrInput = tmpScaled;
    }
    const { stdout } = await execFileAsync('tesseract', [ocrInput, 'stdout', '-l', 'eng', '--psm', '6'], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 12000,
      killSignal: 'SIGKILL',
      env: { ...process.env, OMP_THREAD_LIMIT: '1' },
    });
    const paragraphs = cleanOcrText(stdout);
    const out = { method: 'tesseract-ocr', fileName, paragraphs };
    writeCacheJson('v95-transcripts', fileId, out);
    return out;
  } catch {
    const out = { method: 'tesseract-timeout-art', fileName, paragraphs: [] };
    writeCacheJson('v95-transcripts', fileId, out);
    return out;
  } finally {
    try {
      if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
      if (fs.existsSync(tmpScaled)) fs.unlinkSync(tmpScaled);
    } catch {}
  }
}

async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = idx++;
      if (current >= items.length) break;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeCrossPageParagraphs(pageBlocks, storyTitle) {
  const allParas = [];
  for (let pIdx = 0; pIdx < pageBlocks.length; pIdx++) {
    const block = pageBlocks[pIdx];
    if (block.isIllustration) {
      allParas.push({ type: 'art', asset: block.buffer });
      continue;
    }

    for (let i = 0; i < block.paragraphs.length; i++) {
      let p = block.paragraphs[i];
      // İlk sayfanın en üstündeki tekrar eden bölüm başlığı satırını temizle
      if (pIdx === 0 && i <= 1) {
        const normP = p.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normT = storyTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
          /^(?:new\s+ss|fair\s+bonus|bookwalker|volume\s+\d+\s+bonus|bonus\s+short\s+story)/i.test(p) ||
          (normT.length > 8 && (normP === normT || normT.includes(normP)))
        ) {
          continue;
        }
      }

      // Önceki sayfanın son paragrafı cümle ortasında kesildiyse birleştir
      const prevItem = allParas[allParas.length - 1];
      if (
        i === 0 &&
        prevItem &&
        prevItem.type === 'para' &&
        !/[.!?"”’…)~—]$/.test(prevItem.text) &&
        /^[a-z0-9,;:]/.test(p)
      ) {
        prevItem.text = `${prevItem.text} ${p}`.replace(/\s+/g, ' ').trim();
      } else {
        allParas.push({ type: 'para', text: p });
      }
    }
  }
  return allParas;
}

async function ingestGlucose95(volCfg, opts = {}) {
  const { illustFolderId, stories } = await discoverGlucoseV95Manifest();
  const sections = [];

  // 1) İllüstrasyonlar
  const illustEntries = await listDriveFolder(illustFolderId, opts);
  const illustFiles = illustEntries.filter((e) => e.type === 'file' && /\.(?:png|jpe?g|webp)$/i.test(e.name));
  const illustItems = [];
  for (const f of illustFiles) {
    const buf = await downloadDriveBuffer(f.id, opts);
    if (isFullPageIllustration(buf, f.name)) {
      illustItems.push({ type: 'art', asset: buf });
    }
  }
  if (illustItems.length) {
    sections.push({
      label: 'İllüstrasyonlar',
      title: 'İllüstrasyonlar',
      enTitle: 'Illustrations',
      items: illustItems,
    });
  }
  console.log(`  [v9.5] ${illustItems.length} renkli/kapak illüstrasyonu hazırlandı.`);

  // 2) 16 kısa hikâyeyi sırayla indir ve metne dök
  for (let sIdx = 0; sIdx < stories.length; sIdx++) {
    const story = stories[sIdx];
    const entries = await listDriveFolder(story.folderId, opts);
    const pngFiles = entries.filter((e) => e.type === 'file' && /\.(?:png|jpe?g|webp)$/i.test(e.name));

    const pageBlocks = await mapConcurrent(pngFiles, 6, async (file) => {
      const buf = await downloadDriveBuffer(file.id, opts);
      const tr = await transcribePng(file.id, file.name, buf, opts);
      const alphaCount = (tr.paragraphs.join(' ').match(/[A-Za-z]/g) || []).length;
      if (alphaCount < 25 && isFullPageIllustration(buf, file.name)) {
        return { isIllustration: true, buffer: buf, paragraphs: [] };
      }
      return { isIllustration: false, buffer: null, paragraphs: tr.paragraphs };
    });

    const items = mergeCrossPageParagraphs(pageBlocks, story.enTitle);
    const charTotal = items
      .filter((x) => x.type === 'para')
      .reduce((acc, x) => acc + x.text.length, 0);
    console.log(
      `  [v9.5] (${sIdx + 1}/${stories.length}) ${story.slug}: ${pngFiles.length} PNG -> ${charTotal} karakter`
    );

    sections.push({
      label: story.label,
      title: story.enTitle,
      enTitle: story.enTitle,
      items,
    });
  }

  // 3) ~1.400 karakter/sayfa sentetik sayfalama ve WebP yazımı
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
    `✓ Cilt 9.5 alındı: ${pages.length} sentetik sayfa (${pages.length - artCount} metin, ${artCount} illüstrasyon, ${chaptersMeta.chapters.length} bölüm).`
  );
  return { pages, chaptersMeta };
}

module.exports = {
  TOC_URL,
  ILLUST_URL,
  DEFAULT_V95_STORIES,
  discoverGlucoseV95Manifest,
  cleanOcrText,
  ingestGlucose95,
};
