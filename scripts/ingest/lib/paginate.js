// Sentetik sayfalama motoru (~1.400 karakter/sayfa) ve illüstrasyon eşlemesi
// Cilt 9.5, 11 ve 12 gibi sayfa numarası taşımayan kaynakları kanonik source.json ve chapters.json şemasına dönüştürür.

function cleanParagraphText(p) {
  return String(p || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
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
  paginateSections,
  cleanParagraphText,
};
