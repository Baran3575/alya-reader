// 5 geçişin sonucunu ölçer
const fs = require('fs');
const path = require('path');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
// Yalnızca İngilizce kısaltma (TN:) kusur sayılır; Türkçe "ÇN:" notları meşrudur.
const TN_RE = /(?<!\p{L})TN\s*:/gu;
const CN_RE = /(?<!\p{L})ÇN\s*:/gu;
const CORNER_QUOTE_RE = /[『』「」]/g;
const CYRILLIC_RE = /\p{Script=Cyrillic}+/gu;

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

function hasNestedDoubleQuotes(str) {
  const quotes = str.match(/[“”]/g) || [];
  if (quotes.length < 4 || quotes.length % 2 !== 0) return false;
  let depth = 0;
  for (const ch of quotes) {
    if (ch === '“') {
      depth++;
      if (depth > 1) return true;
    } else {
      depth--;
      if (depth < 0) return false;
    }
  }
  return false;
}

const SEN_PRON_RE = /(?<!\p{L})(?:sen|seni|sana|sende|senden|senin|seninle|misin|mısın|musun|müsün)(?!\p{L})/iu;
const SEN_VERB_RE = /(?<!\p{L})[\p{L}]{2,}(?:yorsun|iyorsun|ıyorsun|uyorsun|üyorsun|acaksın|eceksin|malısın|melisin|bilirsin|amazsın|emezsin|mıyorsun|miyorsun|muyorsun|müyorsun|mışsın|mişsin|muşsun|müşsün)(?!\p{L})/iu;
const SIZ_PRON_RE = /(?<!\p{L})(?:siz|sizi|size|sizde|sizden|sizin|sizinle|misiniz|mısınız|musunuz|müsünüz)(?!\p{L})/iu;
const SIZ_VERB_RE = /(?<!\p{L})[\p{L}]{2,}(?:yorsunuz|iyorsunuz|ıyorsunuz|uyorsunuz|üyorsunuz|acaksınız|eceksiniz|malısınız|melisiniz|bilirsiniz|amazsınız|emezsiniz|mıyorsunuz|miyorsunuz|muyorsunuz|müyorsunuz|mışsınız|mişsiniz|muşsunuz|müşsünüz|dınız|diniz|dunuz|dünüz|tınız|tiniz|tunuz|tünüz|mayın|meyin|mayınız|meyiniz)(?!\p{L})/iu;
const PLURAL_CTX_RE = /(?<!\p{L})(?:ikiniz|ikinizi|ikinize|ikinizin|üçünüz|dördünüz|beşiniz|hepiniz|hepinize|hepinizin|sizler|sizleri|sizlere|millet|arkadaşlar|çocuklar|hanımlar|beyler|öğrenciler|üyeler|herkes|sen\s+ve\s+[\p{L}]+)(?!\p{L})/iu;
const VOCATIVE_SAMA_RE = /(?<![\p{L}-])(?!(?:Onii|Nii|Onee|Nee|Ani|Onii-chan|Ore|Ojou|Kami)-sama(?!\p{L}))[\p{L}]+-sama(?!’)(?!\p{L})/iu;
const INNER_SINGLE_QUOTE_RE = /‘[^’]*’|(?<!\p{L})’[^’]+’/gu;

function hasSamaSenMismatch(str) {
  const quotes = str.match(/“[^”]+”/g) || [];
  for (const q of quotes) {
    const outer = q.replace(INNER_SINGLE_QUOTE_RE, ' ');
    if (VOCATIVE_SAMA_RE.test(outer) && (SEN_PRON_RE.test(outer) || SEN_VERB_RE.test(outer))) {
      return true;
    }
  }
  return false;
}

function hasSenSizCollision(str) {
  const quotes = str.match(/“[^”]+”/g) || [];
  for (const q of quotes) {
    const outer = q.replace(INNER_SINGLE_QUOTE_RE, ' ');
    if (PLURAL_CTX_RE.test(outer)) continue;
    const sen = SEN_PRON_RE.test(outer) || SEN_VERB_RE.test(outer);
    const siz = SIZ_PRON_RE.test(outer) || SIZ_VERB_RE.test(outer);
    if (sen && siz) return true;
  }
  return false;
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
  let nestedQ = 0;
  let unbalP = 0;
  let unbalB = 0;
  let unbalS = 0;
  for (const x of paras) {
    if ((x.t.match(/[“”]/g) || []).length % 2) unbalQ++;
    if (hasNestedDoubleQuotes(x.t)) nestedQ++;
    if ((x.t.match(/\(/g) || []).length !== (x.t.match(/\)/g) || []).length) unbalP++;
    if (hasUnbalancedDelim(x.t, '{', '}')) unbalB++;
    if (hasUnbalancedDelim(x.t, '[', ']')) unbalS++;
  }
  row('  ', unbalQ, 'tek sayıda tırnak (sayfa bölünmesi olabilir)');
  row('  ', nestedQ, 'iç içe çift tırnak');
  row('  ', unbalP, 'dengesiz parantez');
  row('  ', unbalB, 'dengesiz süslü parantez');
  row('  ', unbalS, 'dengesiz köşeli parantez');
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

  row('5. gramer', count(W('(herşey|birşey|herkez|yanlız|bir çok)', 'gi')), 'bitişik/imla hatası');
  row('  ', count(W('([\\p{L}]{3,})\\s+\\1', 'gi')), 'ikiz kelime');
  let samaSen = 0;
  let senSiz = 0;
  for (const x of paras) {
    if (hasSamaSenMismatch(x.t)) samaSen++;
    if (hasSenSizCollision(x.t)) senSiz++;
  }
  row('  ', samaSen, '-sama + sen kip uyumsuzluğu');
  row('  ', senSiz, 'tek replikte sen/siz çakışması');

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
  hasNestedDoubleQuotes,
  hasSamaSenMismatch,
  hasSenSizCollision,
};
