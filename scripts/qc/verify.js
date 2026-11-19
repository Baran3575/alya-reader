// 5 geçişin sonucunu ölçer
const fs = require('fs');
const path = require('path');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;
const ALLOWED_BRACE_NAMES_RE = /^(?:Masaa*chika|Mashachika|Chika|Kuze|Alya|Alisa|Masha|Maria|Yuki|Ayano|Sayaka|Chisaki|Touya|Nonoa|Sarashina|Kujou|Kimishima|Suou|Shuou|Saa|Onii|Uwaa*h|Nee)(?:-(?:kun|chan|san|sama|senpai))?$/i;
const BRACE_EN_ORTHO_RE = /[qwx]|ch|sh|th|wh|ph|gh|ck|wr|kn|oo|ee|ea|oa|ou|ow|aw|ew|tion|sion|ness|ment|able|ible|ight|ould|ing$|ed$/i;
const BRACE_EN_WORDS = new Set([
  'overwrite', 'please', 'sorry', 'never', 'really', 'great', 'cool', 'promise',
  'because', 'look', 'take', 'hold', 'stop', 'help', 'just', 'only', 'same',
  'mean', 'feel', 'want', 'need', 'make', 'married', 'marriage', 'couple',
  'partner', 'partners', 'responsibility', 'regret', 'weird', 'boobs', 'heart',
  'edge', 'body', 'mole', 'alone', 'again', 'forever', 'gladly', 'accept',
  'offer', 'free', 'yes', 'are', 'can', 'not', 'don', 'did', 'let', 'see',
  'say', 'tell', 'give', 'come', 'back', 'here', 'more', 'less', 'very',
  'much', 'well', 'still', 'even', 'also', 'into', 'over', 'under', 'after',
  'before', 'until', 'always', 'maybe', 'perhaps', 'actually', 'fact',
  'specific', 'specifically',
]);

function hasUnbalancedBraces(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') {
      if (depth > 0) return true;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) return true;
      depth--;
    }
  }
  return depth !== 0;
}

function findDuplicateGlossesInText(text) {
  const re = /[“"]([^“”"]+)[”"]\s*\[([^\[\]]+)\]/gu;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!/\p{Script=Cyrillic}/u.test(m[1])) {
      hits.push(m[0]);
    }
  }
  return hits;
}

function findBraceEnglishInText(text) {
  const spanRe = /\{([^{}]+)\}/g;
  const wordRe = /(?<!\p{L})[A-Z][a-z]{2,}(?:-(?:kun|chan|san|sama|senpai))?(?!\p{L})/gu;
  const hits = [];
  let sm;
  while ((sm = spanRe.exec(text)) !== null) {
    const span = sm[1];
    let wm;
    wordRe.lastIndex = 0;
    while ((wm = wordRe.exec(span)) !== null) {
      const w = wm[0];
      if (ALLOWED_BRACE_NAMES_RE.test(w)) continue;
      if (BRACE_EN_ORTHO_RE.test(w) || BRACE_EN_WORDS.has(w.toLowerCase())) {
        hits.push(w);
      }
    }
  }
  return hits;
}

function runVerify(filePath) {
  const FILE = filePath ? path.resolve(filePath) : (process.env.ALYA_TR_FILE ? path.resolve(process.env.ALYA_TR_FILE) : path.join(__dirname, '..', '..', 'data', 'paragraphs_final.json'));
  const f = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const paras = [];
  for (const [p, arr] of Object.entries(f)) arr.forEach((t, i) => paras.push({ p, i, t }));

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
  let dupGloss = 0;
  let braceEn = 0;
  for (const x of paras) {
    if ((x.t.match(/[“”]/g) || []).length % 2) unbalQ++;
    if ((x.t.match(/\(/g) || []).length !== (x.t.match(/\)/g) || []).length) unbalP++;
    if (hasUnbalancedBraces(x.t)) unbalB++;
    dupGloss += findDuplicateGlossesInText(x.t).length;
    braceEn += findBraceEnglishInText(x.t).length;
  }
  row('  ', unbalQ, 'tek sayıda tırnak (sayfa bölünmesi olabilir)');
  row('  ', unbalP, 'dengesiz parantez');
  row('  ', unbalB, 'dengesiz süslü parantez');
  row('  ', dupGloss, 'yinelenen köşeli açıklama');
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

  row('5. gramer', count(W('(herşey|birşey|herkez|yanlız|bir çok)', 'gi')), 'bitişik/imla hatası');
  row('  ', count(W('([\\p{L}]{3,})\\s+\\1', 'gi')), 'ikiz kelime');

  const countEnResidue = paras.reduce((a, x) => {
    const clean = x.t.replace(/https?:\s*\/\/[^\n]+/gi, '');
    return a + (clean.match(EN_RESIDUE_RE) || []).length;
  }, 0);
  row('6. yasaklı', countEnResidue, 'İngilizce kalıntı');
  row('  ', braceEn, 'süslü parantezde İngilizce');
  row('  ', count(TN_RE), 'çevirmen notu');

  return { rows, paras, pageCount: Object.keys(f).length };
}

if (require.main === module) {
  const { rows, paras, pageCount } = runVerify();
  for (const [label, n, note] of rows) console.log(String(n).padStart(6), (label + ' ' + note).padEnd(60));
  console.log('\nparagraf:', paras.length, '| sayfa:', pageCount);
}

module.exports = {
  runVerify,
  hasUnbalancedBraces,
  findDuplicateGlossesInText,
  findBraceEnglishInText,
};
