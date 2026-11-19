// 5 geçişin sonucunu ölçer
const fs = require('fs');
const path = require('path');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;
const URL_TOKEN_RE = /https?:\s*\/\/\S+/gi;
const FAN_TL_SPAM_RE = /(?:glucosetl|discord\s*\.\s*gg|novelupdates|lightnovelreader|Goldenagato|mp4directs|zerobooks)/gi;

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
  for (const x of paras) {
    if ((x.t.match(/[“”]/g) || []).length % 2) unbalQ++;
    if ((x.t.match(/\(/g) || []).length !== (x.t.match(/\)/g) || []).length) unbalP++;
  }
  row('  ', unbalQ, 'tek sayıda tırnak (sayfa bölünmesi olabilir)');
  row('  ', unbalP, 'dengesiz parantez');
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
    const clean = x.t.replace(URL_TOKEN_RE, '');
    return a + (clean.match(EN_RESIDUE_RE) || []).length;
  }, 0);
  row('6. yasaklı', countEnResidue, 'İngilizce kalıntı');
  row('  ', count(TN_RE), 'çevirmen notu');
  row('  ', count(FAN_TL_SPAM_RE), 'fan-TL spam (glucosetl/discord.gg/novelupdates/lightnovelreader/Goldenagato/mp4directs/zerobooks)');

  return { rows, paras, pageCount: Object.keys(f).length };
}

if (require.main === module) {
  const { rows, paras, pageCount } = runVerify();
  for (const [label, n, note] of rows) console.log(String(n).padStart(6), (label + ' ' + note).padEnd(60));
  console.log('\nparagraf:', paras.length, '| sayfa:', pageCount);
}

module.exports = { runVerify, URL_TOKEN_RE, FAN_TL_SPAM_RE };
