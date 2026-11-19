// Sentetik sayfalama motoru (~1.400 karakter/sayfa), bölüm bazlı sayfa dikişi (stitching) ve illüstrasyon eşlemesi
// - Cilt 9.5, 11 ve 12 gibi sayfa numarası taşımayan kaynakları kanonik source.json ve chapters.json şemasına dönüştürür (paginateSections).
// - Cilt 4, 4.5 ve 5–10 gibi sayfa bazlı kaynaklarda sayfa geçişlerindeki bölünmüş cümle ve tırnakları bölüm sınırlarını koruyarak birleştirir (stitchChapterPages).

const NOISE = /(Goldenagato|mp4directs|jnovels|zerobooks|Download all your Favorite|Stay up to date On Light Novels)/i;
const CHAPTER_HEADING_RE =
  /^(Prologue|Epilogue|Afterword|Interlude|Chapter\s+(\d+)|Side\s+Story(?:\s+\d+)?|Short\s+Story(?:\s+\d+)?|Bonus\s+Short\s+Story(?:\s+\d+)?)\s*[:–—-]/i;

function cleanParagraphText(p) {
  return String(p || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isUsablePage(text) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const alpha = words.filter((w) => /[A-Za-zÇĞİÖŞÜçğıöşü]{3,}/.test(w)).length;
  return words.length >= 6 && alpha / words.length >= 0.4;
}

function detectChapterHeading(rawTextOrFirstPara) {
  const firstLine =
    String(rawTextOrFirstPara || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !NOISE.test(s))[0] || '';
  return CHAPTER_HEADING_RE.test(firstLine.replace(/\s+/g, ' '));
}

function paragraphs(text) {
  const rawLines = String(text || '').split('\n');
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?…"”’]$/;
  for (const rawLn of rawLines) {
    const ln = rawLn.trim();
    if (!ln) {
      if (cur.length && endPunct.test(cur[cur.length - 1])) {
        blocks.push(cur.join(' '));
        cur = [];
      }
      continue;
    }
    if (NOISE.test(ln)) continue;
    if (CHAPTER_HEADING_RE.test(ln)) {
      if (cur.length) {
        blocks.push(cur.join(' '));
        cur = [];
      }
      blocks.push(ln);
      continue;
    }
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = ln.startsWith('"') || ln.startsWith('“');
      const shortPrev = prev.length < 48 && prevEnds;
      if (prevEnds && (newDialogue || shortPrev)) {
        blocks.push(cur.join(' '));
        cur = [];
      }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));

  const out = [];
  for (const b of blocks) {
    const clean = b
      .replace(/Page\s+\d+/gi, '')
      .replace(NOISE, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) continue;
    if (clean.length <= 520) {
      out.push(clean);
      continue;
    }
    const sents = clean.split(/(?<=[.!?]["”’]?)\s+(?=[A-Z"“‘(\[『「])/g);
    if (sents.length <= 1) {
      out.push(clean);
      continue;
    }
    let buf = '';
    for (const s of sents) {
      const sep = buf ? ' ' : '';
      if ((buf + sep + s).length > 480 && buf) {
        out.push(buf.trim());
        buf = s;
      } else {
        buf += sep + s;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

function countDoubleQuotes(s) {
  return (String(s || '').match(/["“”]/g) || []).length;
}

function hasUnclosedQuote(s) {
  const opens = (String(s || '').match(/“/g) || []).length;
  const closes = (String(s || '').match(/”/g) || []).length;
  const straight = (String(s || '').match(/"/g) || []).length;
  if (opens !== closes && straight === 0) return opens > closes;
  return (opens + closes + straight) % 2 !== 0;
}

function hasUnclosedParen(last, first) {
  const o1 = (last.match(/\(/g) || []).length;
  const c1 = (last.match(/\)/g) || []).length;
  const o2 = (first.match(/\(/g) || []).length;
  const c2 = (first.match(/\)/g) || []).length;
  return o1 > c1 && c2 > o2;
}

function shouldStitchAcrossPages(last, first) {
  if (!last || !first) return false;
  if (CHAPTER_HEADING_RE.test(first)) return false;
  if (hasUnclosedParen(last, first)) return true;
  if (hasUnclosedQuote(last)) return true;
  const trimmedLast = last.trim();
  const trimmedFirst = first.trim();
  if (!/[.!?…"”’)\]}~]$/.test(trimmedLast)) return true;
  if (/^["“”'‘’)\]]*[a-z]/.test(trimmedFirst)) return true;
  return false;
}

function joinCrossPageParagraphs(last, first) {
  let a = last.trim();
  let b = first.trim();
  // Sayfa başında tekrarlanan açılış tırnağı tek konuşmayı bölüyorsa fazladan açılış tırnağını düşür
  if (hasUnclosedQuote(a) && /^["“]/.test(b) && countDoubleQuotes(a + ' ' + b) % 2 !== 0) {
    b = b.slice(1).trimStart();
  }
  // Satır sonu tirelemesi (örn. "under-" + "stand")
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) {
    return a.slice(0, -1) + b;
  }
  return (a + ' ' + b).replace(/\s+/g, ' ').trim();
}

function stitchParagraphEntries(entries) {
  let prevUsable = null;
  for (const curr of entries) {
    if (!curr.usable) continue;
    if (curr.isChapterStart) {
      prevUsable = curr;
      continue;
    }
    if (prevUsable && prevUsable.paras.length > 0 && curr.paras.length > 0) {
      const lastIdx = prevUsable.paras.length - 1;
      const last = prevUsable.paras[lastIdx];
      const first = curr.paras[0];
      if (shouldStitchAcrossPages(last, first)) {
        prevUsable.paras[lastIdx] = joinCrossPageParagraphs(last, first);
        curr.paras.shift();
      }
    }
    if (curr.paras.length > 0) {
      prevUsable = curr;
    }
  }
  return entries;
}

// Bölüm sınırlarını gözeterek sayfa geçişlerindeki yarım cümle ve tırnakları
// çeviri öncesinde birleştirir; tüm sayısal sayfa anahtarlarını korur.
function stitchChapterPages(pages) {
  const entries = pages.map((p) => {
    const key = String(p.page);
    const raw = String(p.text || '');
    const usable = !p.pending && isUsablePage(raw);
    const paras = usable ? paragraphs(raw) : [];
    const isChapterStart = usable && detectChapterHeading(raw);
    return { key, page: p.page, usable: usable && paras.length > 0, isChapterStart, paras };
  });

  stitchParagraphEntries(entries);

  const pageMap = {};
  for (const e of entries) {
    pageMap[e.key] = e.paras;
  }
  return pageMap;
}

/**
 * Bölümleri ~targetChars karakterlik sentetik sayfalara böler.
 * Her bölüm elemanı:
 *   {
 *     label: 'Prolog' | 'Bölüm 1' | 'Kısa Hikâye 1' | 'İllüstrasyonlar' | ...,
 *     title: 'Türkçe veya kaynak başlık',
 *     enTitle: 'İngilizce orijinal başlık',
 *     pending: false,
 *     statusNote: '',
 *     items: [
 *       { type: 'art', assetIndex: 0 } | { type: 'para', text: '...' }
 *     ]
 *   }
 */
function paginateSections(sections, { imgPrefix, targetChars = 1400, minProseChars = 240 } = {}) {
  const pages = [];
  const chapters = [];
  const titles = {};

  const nextPageNo = () => pages.length + 1;
  const fmtImg = (n) => `${imgPrefix}${String(n).padStart(3, '0')}.webp`;

  for (const sec of sections) {
    const secStartPage = nextPageNo();

    if (sec.pending) {
      const pNo = nextPageNo();
      pages.push({
        page: pNo,
        img: fmtImg(pNo),
        thumb: '',
        text: '',
        pending: true,
      });
      if (sec.title) titles[String(secStartPage)] = sec.title;
      chapters.push({
        label: sec.label || 'Bölüm',
        title: sec.title || sec.enTitle || '',
        enTitle: sec.enTitle || sec.title || '',
        startPage: secStartPage,
        pending: true,
        statusNote: sec.statusNote || 'Kaynak çeviri henüz tamamlanmadı ([Translation In Progress]).',
      });
      continue;
    }

    const secPagesStartIdx = pages.length;
    let paraBuf = [];
    let charCount = 0;

    const flushProse = (forceSeparate = false) => {
      if (!paraBuf.length) return;
      const joined = paraBuf.join('\n\n');
      // Bölüm içindeki son düzyazı sayfası çok kısaysa (< minProseChars) bir önceki düzyazı sayfasına ekle
      if (
        !forceSeparate &&
        joined.length < minProseChars &&
        pages.length > secPagesStartIdx &&
        pages[pages.length - 1].text &&
        pages[pages.length - 1].text.length > 0
      ) {
        pages[pages.length - 1].text += '\n\n' + joined;
      } else {
        const pNo = nextPageNo();
        pages.push({
          page: pNo,
          img: fmtImg(pNo),
          thumb: '',
          text: joined,
        });
      }
      paraBuf = [];
      charCount = 0;
    };

    for (const item of sec.items || []) {
      if (item.type === 'art') {
        flushProse();
        const pNo = nextPageNo();
        pages.push({
          page: pNo,
          img: fmtImg(pNo),
          thumb: '',
          text: '',
          _artAsset: item.asset,
        });
        continue;
      }

      const txt = cleanParagraphText(item.text);
      if (!txt) continue;

      if (charCount > 0 && charCount + txt.length + 2 > targetChars && charCount >= minProseChars) {
        flushProse(true);
      }
      paraBuf.push(txt);
      charCount += txt.length + (paraBuf.length > 1 ? 2 : 0);
    }

    flushProse(false);

    // Eğer bölümün tek bir düzyazı sayfası varsa ve 230 karakterin altındaysa (çok kısa ara not vb.)
    // okuma motorunun 'art' sanmaması için başlık satırını metin başına dahil et
    if (
      pages.length === secPagesStartIdx + 1 &&
      pages[secPagesStartIdx].text &&
      pages[secPagesStartIdx].text.length > 0 &&
      pages[secPagesStartIdx].text.length < 230
    ) {
      pages[secPagesStartIdx].text = `${sec.enTitle || sec.title || sec.label}\n\n${pages[secPagesStartIdx].text}`;
    }

    if (pages.length > secPagesStartIdx) {
      if (sec.title || sec.enTitle) {
        titles[String(secStartPage)] = sec.title || sec.enTitle;
      }
      chapters.push({
        label: sec.label || '',
        title: sec.title || sec.enTitle || '',
        enTitle: sec.enTitle || sec.title || '',
        startPage: secStartPage,
      });
    }
  }

  return { pages, chaptersMeta: { titles, chapters } };
}

module.exports = {
  NOISE,
  CHAPTER_HEADING_RE,
  cleanParagraphText,
  isUsablePage,
  detectChapterHeading,
  paragraphs,
  hasUnclosedQuote,
  hasUnclosedParen,
  shouldStitchAcrossPages,
  joinCrossPageParagraphs,
  stitchParagraphEntries,
  stitchChapterPages,
  paginateSections,
};
