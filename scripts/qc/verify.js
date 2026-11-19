// 5 geçişin sonucunu ölçer
const fs = require('fs');
const path = require('path');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc6_typography');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
// Yalnızca İngilizce kısaltma (TN:) kusur sayılır; Türkçe "ÇN:" notları meşrudur.
const TN_RE = /(?<!\p{L})TN\s*:/gu;
const CN_RE = /(?<!\p{L})ÇN\s*:/gu;
const YYOR_RE = /\p{L}yyor/giu;
const CORNER_QUOTE_RE = /[『』「」]/g;
const CYRILLIC_RE = /\p{Script=Cyrillic}+/gu;
const URL_CLEAN_RE = /https?:\s*\/\/(?:[^\s)]|\.\s+(?:com|gg|me|org|net|xyz))+|\b[\w-]+\s*\.\s*(?:com|gg|me|org|net|xyz)(?:\/[^\s)]*)?/giu;
const GLOSSARY_PATH = path.join(__dirname, '..', '..', 'data', 'glossary.json');

function escapeRegExpUnicode(s) {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function loadGlossaryTypos() {
  if (!fs.existsSync(GLOSSARY_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8'));
    return Object.entries(raw)
      .filter(([from, to]) => !from.startsWith('_') && typeof to === 'string' && from !== to)
      .map(([from, to]) => ({
        from,
        to,
        re: new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExpUnicode(from) + '(?![\\p{L}\\p{N}])', 'gu'),
      }));
  } catch {
    return [];
  }
}

function hasUnbalancedDelim(str, open, close) {
  let depth = 0;
  let prev = '';
  for (const ch of str) {
    if (ch === open) {
      depth++;
      if (depth > 1) return true;
    } else if (ch === close) {
      if (prev === open) return true;
      depth--;
      if (depth < 0) return true;
    }
    prev = ch;
  }
  return depth !== 0;
}

function hasInvertedCurlyQuotes(t) {
  if (/[“”]{2,}/u.test(t)) return true;
  if (/“(?=$|[\s,.;:)\]}])/u.test(t)) return true;
  if (/[\p{L}\p{N}.!?,;:~…\]}」』]“/u.test(t)) return true;
  if (/(?:^|[\s(\[{])”/u.test(t)) return true;
  // Kapanış tırnağından hemen sonra boşluksuz harf geliyorsa yalnızca geçerli bitişik Türkçe eklerine izin ver
  const afterClose = [...t.matchAll(/”([\p{L}\p{N}]+)/gu)];
  const validAttached = /^(?:nınki|ninki|nunki|nünki|ınki|inki|unki|ünki|kiler|kileri|kilere|kilerden|ki|nın|nin|nun|nün|ın|in|un|ün|yı|yi|yu|yü|nı|ni|nu|nü|ndan|nden|dan|den|tan|ten|ndaki|ndeki|daki|deki|nda|nde|da|de|ta|te|dı|di|du|dü|tı|ti|tu|tü|ydı|ydi|ydu|ydü|ymış|ymiş|ymuş|ymüş|mış|miş|muş|müş|yla|yle|la|le|ca|ce|ça|çe|ları|leri|ların|lerin|lara|lere|lardan|lerden|lık|lik|luk|lük|a|e|ı|i|u|ü|na|ya|ye)$/u;
  for (const m of afterClose) {
    if (!validAttached.test(m[1])) return true;
  }
  return false;
}

function isCrossPageContinuation(bookData, sortedPages, pageIndex, paraIndex) {
  if (paraIndex !== 0 || pageIndex <= 0) return false;
  const prevArr = bookData[sortedPages[pageIndex - 1]] || [];
  if (!Array.isArray(prevArr) || prevArr.length === 0) return false;
  const prevLast = String(prevArr[prevArr.length - 1] || '').trim();
  if (!prevLast) return false;
  return !/[.!?][”’)\]}]*$/u.test(prevLast);
}

function countLowercaseStarts(t, opts = {}) {
  const clean = t.replace(URL_CLEAN_RE, 'URL');
  let n = 0;
  if (!opts.allowInitialLower && /^[“"‘'(\[{]*[a-zçğıöşü]/u.test(clean)) n++;
  const afterStop = clean.match(
    /(?:(?<!\d)(?<!(?<!\p{L})(?:vb|vs|bkz|örn|ör|dr|prof|sn|yy|Vb|Vs|Bkz|Örn|Ör|Dr|Prof|Sn))\.|[!?])\s+[“"‘'(\[{]*[a-zçğıöşü]/gu
  );
  if (afterStop) n += afterStop.length;
  return n;
}

function runVerify(filePath) {
  const FILE = filePath ? path.resolve(filePath) : (process.env.ALYA_TR_FILE ? path.resolve(process.env.ALYA_TR_FILE) : path.join(__dirname, '..', '..', 'data', 'paragraphs_final.json'));
  const f = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const sortedPages = Object.keys(f).sort((a, b) => Number(a) - Number(b));
  const paras = [];
  sortedPages.forEach((p, pi) => {
    (f[p] || []).forEach((t, i) => {
      paras.push({ p, i, t, allowInitialLower: isCrossPageContinuation(f, sortedPages, pi, i) });
    });
  });

  const count = (re) => paras.reduce((a, x) => a + (x.t.match(re) || []).length, 0);
  // Türkçe harfler için Unicode sınır: \b "ı, ş, ğ" yanında çalışmaz
  const W = (s, flags = 'g') => new RegExp('(?<!\\p{L})' + s + '(?!\\p{L})', 'u' + flags);
  const countW = (s, flags = 'g') => count(W(s, flags));
  const rows = [];
  const row = (label, n, note = '') => rows.push([label, n, note]);

  row('1. noktalama', count(/\.{2,}/g), 'çift nokta');
  row('  ', count(/\s+[,.;:!?]/g), 'noktalama öncesi boşluk');
  row('  ', count(/[!?]\./g), '"?." kalıbı');
  row('  ', count(/["']/g), 'düz tırnak');
  let unbalQ = 0;
  let unbalP = 0;
  let unbalB = 0;
  let unbalS = 0;
  let invQ = 0;
  let detachedSuf = 0;
  let lowerStarts = 0;
  for (const x of paras) {
    if ((x.t.match(/[“”]/g) || []).length % 2) unbalQ++;
    if ((x.t.match(/\(/g) || []).length !== (x.t.match(/\)/g) || []).length) unbalP++;
    if (hasUnbalancedDelim(x.t, '{', '}')) unbalB++;
    if (hasUnbalancedDelim(x.t, '[', ']')) unbalS++;
    if (hasInvertedCurlyQuotes(x.t)) invQ++;
    detachedSuf += (x.t.match(DETACHED_QUOTE_SUFFIX_RE) || []).length;
    lowerStarts += countLowercaseStarts(x.t, { allowInitialLower: x.allowInitialLower });
  }
  row('  ', unbalQ, 'tek sayıda tırnak (sayfa bölünmesi olabilir)');
  row('  ', unbalP, 'dengesiz parantez');
  row('  ', unbalB, 'dengesiz süslü parantez');
  row('  ', unbalS, 'dengesiz köşeli parantez');
  row('  ', invQ, 'ters kıvrık tırnak');
  row('  ', detachedSuf, 'ayrık tırnak eki');
  row('  ', lowerStarts, 'küçük harfle başlayan cümle');
  row('  ', count(CORNER_QUOTE_RE), 'Japonca köşe tırnağı');
  row('  ', count(CYRILLIC_RE), 'Kiril kalıntısı');
  row('  ', paras.filter((x) => !x.t.trim()).length, 'boş paragraf');

  row('2. doğal ifade', countW('Ancak'), '"Ancak"');
  row('  ', countW('Ayrıca'), '"Ayrıca"');
  row('  ', countW('söz konusu'), '"söz konusu"');
  row('  ', countW('diye söyledi'), '"diye söyledi"');

  row('3. tekrar', countW('ardından', 'gi'), '"ardından"');
  row('  ', countW('bir şekilde', 'gi'), '"bir şekilde"');
  let worst = 0;
  let worstWord = '';
  for (const x of paras) {
    const ws = (x.t.toLocaleLowerCase('tr').match(/[\p{L}]{4,}/gu) || []);
    const m = new Map();
    for (const w of ws) m.set(w, (m.get(w) || 0) + 1);
    for (const [w, c] of m) if (c > worst) { worst = c; worstWord = w; }
  }
  row('  ', worst, 'tek paragrafta en çok yinelenen kelime: ' + worstWord);

  row('4. fiil/zarf', count(/maktadır|mektedir/g), '"-maktadır"');
  row('  ', count(/mıştır|miştir/g), '"-mıştır"');
  row('  ', countW('değildir'), '"değildir"');
  row('  ', countW('olmuştur'), '"olmuştur"');
  row('  ', countW('bulunmaktadır'), '"bulunmaktadır"');
  row('  ', count(YYOR_RE), '-yyor fiil hatası');

  const glossaryTypos = loadGlossaryTypos();
  let typoHits = 0;
  for (const x of paras) {
    for (const g of glossaryTypos) {
      const m = x.t.match(g.re);
      if (m) typoHits += m.length;
    }
  }
  row('5. gramer', count(W('(herşey|birşey|hiçbirşey|herkez|yanlız|bir çok)', 'gi')), 'bitişik/imla hatası');
  row('  ', typoHits, 'sözlük/özel ad hatası');
  row('  ', count(W('([\\p{L}]{3,})\\s+\\1', 'gi')), 'ikiz kelime');

  const countEnResidue = paras.reduce((a, x) => {
    const clean = x.t.replace(/https?:\s*\/\/[^\n]+/gi, '');
    return a + (clean.match(EN_RESIDUE_RE) || []).length;
  }, 0);
  row('6. yasaklı', countEnResidue, 'İngilizce kalıntı');
  row('  ', count(TN_RE), 'çevirmen notu');
  row('  ', count(CN_RE), 'çevirmen notu (ÇN)');

  return { rows, paras, pageCount: Object.keys(f).length };
}

if (require.main === module) {
  const { rows, paras, pageCount } = runVerify();
  for (const [label, n, note] of rows) console.log(String(n).padStart(6), (label + ' ' + note).padEnd(60));
  console.log('\nparagraf:', paras.length, '| sayfa:', pageCount);
}

module.exports = {
  runVerify,
  hasUnbalancedDelim,
  hasInvertedCurlyQuotes,
  countLowercaseStarts,
  isCrossPageContinuation,
  loadGlossaryTypos,
};
