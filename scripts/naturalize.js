// Edebî/doğal Türkçe geçişi: makine çevirisinin "resmî" kalıplarını light novel
// anlatımına çevirir, dizgiyi tek tipleştirir. Kural listesi bilinçli olarak tutucu:
// anlamı değiştirebilecek dönüşümler yalnızca net kalıplarda uygulanır.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'data/paragraphs_final.json');
const dry = process.argv.includes('--dry');

const W = (pat) => new RegExp('(?<!\\p{L})' + pat + '(?!\\p{L})', 'giu');

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî
const LEX = [
  [/(?<!\p{L})söz konusu(?!\p{L})(?!\s+(değil|olmadığı|olduğu))/giu, 'o'],
  [W('adı geçen'), 'o'],
  [W('sözü edilen'), 'o'],
  [W('bahse konu'), 'o'],
  [W('zira'), 'çünkü'],
  [W('lakin'), 'ama'],
  [W('şayet'), 'eğer'],
  [W('dolayısıyla'), 'bu yüzden'],
  [W('bununla birlikte'), 'ama'],
  [W('bu nedenle'), 'bu yüzden'],
  [W('bu sebeple'), 'bu yüzden'],
  [W('gerçekleştirdi'), 'yaptı'],
  [W('gerçekleştirmek'), 'yapmak'],
  [W('gerçekleştirilen'), 'yapılan'],
  [W('gerçekleştiriyor'), 'yapıyor'],
  [W('gerçekleştirmişti'), 'yapmıştı'],
  [W('gerçekleştirir'), 'yapar'],
  [W('gerçekleşti'), 'oldu'],
  [W('gerçekleşen'), 'olan'],
  [W('icra etti'), 'yaptı'],
  [W('icra etmek'), 'yapmak'],
  [W('ifade etti'), 'söyledi'],
  [W('ifade etmek'), 'söylemek'],
  [W('ifade ediyor'), 'söylüyor'],
  [W('ifade ederek'), 'diyerek'],
  [W('beyan etti'), 'söyledi'],
  [W('önlem aldı'), 'önlem aldı'],
  [W('muvaffak oldu'), 'başardı'],
  [W('muvaffak olmak'), 'başarmak'],
];

// 2) makine çevirisine özgü kalıplar (anlamı bozmayacak kadar dar)
const MECH = [
  [W('oldukça fazla'), 'epey'],
];

// 2b) bağlamsal zarf kuralları: "X bir şekilde" -> Türkçe zarf;
// algı kalıplarının sadeleştirilmesi. Yalnızca tek anlamlı kalıplar.
const CONTEXT = [
  [W('çok hızlı bir şekilde'), 'hızla'],
  [W('hızlı bir şekilde'), 'hızlıca'],
  [W('yavaş bir şekilde'), 'yavaşça'],
  [W('sessiz bir şekilde'), 'sessizce'],
  [W('nazik bir şekilde'), 'nazikçe'],
  [W('sakin bir şekilde'), 'sakince'],
  [W('kolay bir şekilde'), 'kolayca'],
  [W('kesin bir şekilde'), 'kesinlikle'],
  [W('belirgin bir şekilde'), 'belirgin biçimde'],
  [W('farklı bir şekilde'), 'başka türlü'],
  [W('benzer bir şekilde'), 'benzer biçimde'],
  [W('bu şekilde'), 'böyle'],
  [W('o şekilde'), 'öyle'],
  [W('farkında olmadan'), 'istem dışı'],
  [W('fark etmeden'), 'istemeden'],
  [W('görünüyordu'), 'görünüyordu'],
];

function replacePreserveCase(str, re, to) {
  return str.replace(re, (m) => {
    const first = m.charAt(0);
    const isUpper = first === first.toLocaleUpperCase('tr') && first !== first.toLocaleLowerCase('tr');
    if (isUpper) {
      return to.charAt(0).toLocaleUpperCase('tr') + to.slice(1);
    }
    return to;
  });
}

// zaman bağlaçlarını sırayla çeşitlendir (aşırı "ardından" yığılmasını kırar)
const CONNECTORS = ['Sonra', 'Derken', 'Peşinden', 'Ardından'];

// çevirmen notları: (TN: ...) -> (ÇN: ...)
function notes(t) {
  return t.replace(/\((TN|ÇN|TL note|Translator'?s? note)\s*:/gi, '(ÇN:');
}

// 3) dizgi
function typography(t) {
  return t
    .replace(/\.{3,}/g, '…')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/([!?])\s+([!?])/g, '$1$2')
    .replace(/([,;:!?])(?=[^\s"”'’»)}\])…!?])/g, '$1 ')
    .replace(/(?<!\d)\.(?=[^\s"”'’»)}\])…!?0-9])/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const contextOnly = process.argv.includes('--context-only');
let connectorTurn = 0;

function context(t) {
  let s = t;
  for (const [re, to] of CONTEXT) s = replacePreserveCase(s, re, to);
  // cümle başındaki "Ardından" → dönüşümlü bağlaç
  s = s.replace(/(^|[.!?…]\s+)Ardından(?!\p{L})/gu, (m, pre) => {
    const pick = CONNECTORS[connectorTurn++ % CONNECTORS.length];
    return pre + pick;
  });
  return s;
}

function capitalizeStops(t) {
  // Paragraf başındaki küçük harfi büyüt (açılış tırnağı / parantezi sonrasında da)
  let out = t.replace(/^([“"‘'(\[{]*)([a-zçğıöşü])/u, (m, pre, ch) => pre + ch.toLocaleUpperCase('tr'));
  // Cümle sonu nokta/ünlem/soru işaretinden sonra gelen cümle başı harfini koru / büyüt
  out = out.replace(/([.!?]\s+[“"‘'(\[{]*)([a-zçğıöşü])/gu, (m, pre, ch) => pre + ch.toLocaleUpperCase('tr'));
  return out;
}

function naturalize(text, opts = {}) {
  const onlyCtx = opts.contextOnly !== undefined ? opts.contextOnly : contextOnly;
  let t = text;
  if (!onlyCtx) for (const [re, to] of LEX) t = replacePreserveCase(t, re, to);
  if (!onlyCtx) for (const [re, to] of MECH) t = replacePreserveCase(t, re, to);
  t = context(t);
  t = notes(t);
  t = typography(t);
  t = capitalizeStops(t);
  return t;
}

if (require.main === module) {
  const fin = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let changed = 0;
  const samples = [];
  for (const [pg, arr] of Object.entries(fin)) {
    arr.forEach((t, i) => {
      const n = naturalize(t);
      if (n !== t) {
        changed++;
        if (samples.length < 8 && Math.random() < 0.06) samples.push([pg, i, t, n]);
        fin[pg][i] = n;
      }
    });
  }

  if (dry) {
    console.log('değişecek paragraf:', changed);
    for (const [pg, i, a, b] of samples) {
      console.log(`\n--- s${pg}.${i}`);
      console.log('ÖNCE:', a.slice(0, 220));
      console.log('SONRA:', b.slice(0, 220));
    }
  } else {
    fs.writeFileSync(FILE, JSON.stringify(fin));
    console.log('doğallaştırma uygulandı:', changed, 'paragraf');
  }
}

module.exports = { naturalize, capitalizeStops, replacePreserveCase, typography, context };
