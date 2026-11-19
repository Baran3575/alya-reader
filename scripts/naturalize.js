// Edebî/doğal Türkçe geçişi: makine çevirisinin "resmî" kalıplarını light novel
// anlatımına çevirir, dizgiyi tek tipleştirir. Kural listesi bilinçli olarak tutucu:
// anlamı değiştirebilecek dönüşümler yalnızca net kalıplarda uygulanır.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Türkçe harfler ("ş, ğ, ı, İ, ö, ü, ç") ASCII \b ile eşleşmediğinden Unicode harf sınırları kullanılır
function W(pattern, extraLookahead = '') {
  return new RegExp(`(?<!\\p{L})(?:${pattern})(?!\\p{L})${extraLookahead}`, 'giu');
}

function preserveCase(match, replacement) {
  if (!match || !replacement) return replacement;
  const first = match[0];
  const isUpper = first === first.toLocaleUpperCase('tr') && first !== first.toLocaleLowerCase('tr');
  if (!isUpper) return replacement;
  return replacement.charAt(0).toLocaleUpperCase('tr') + replacement.slice(1);
}

function applyRules(text, rules) {
  let out = text;
  for (const [re, to] of rules) {
    out = out.replace(re, (m) => preserveCase(m, to));
  }
  return out;
}

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî
const LEX = [
  [W('söz konusu', '(?!\\s+(?:değil|olmadığı|olduğu))'), 'o'],
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
  [W('açık bir şekilde'), 'açıkça'],
  [W('net bir şekilde'), 'açıkça'],
  [W('dikkatli bir şekilde'), 'dikkatle'],
  [W('ciddi bir şekilde'), 'ciddiyetle'],
  [W('mutlu bir şekilde'), 'mutlulukla'],
  [W('üzüntülü bir şekilde'), 'üzüntüyle'],
  [W('endişeli bir şekilde'), 'endişeyle'],
  [W('öfkeli bir şekilde'), 'öfkeyle'],
  [W('isteksiz bir şekilde'), 'isteksizce'],
  [W('umutsuz bir şekilde'), 'umutsuzca'],
  [W('beceriksiz bir şekilde'), 'beceriksizce'],
  [W('doğal olmayan bir şekilde'), 'yapmacık biçimde'],
  [W('doğal bir şekilde'), 'doğal biçimde'],
  [W('normal bir şekilde'), 'normal biçimde'],
  [W('düzenli bir şekilde'), 'düzenli olarak'],
  [W('uygun bir şekilde'), 'uygun biçimde'],
  [W('belirgin bir şekilde'), 'belirgin biçimde'],
  [W('beklenmedik bir şekilde'), 'beklenmedik biçimde'],
  [W('garip bir şekilde'), 'garip biçimde'],
  [W('tuhaf bir şekilde'), 'tuhaf biçimde'],
  [W('zarif bir şekilde'), 'zarifçe'],
  [W('samimi bir şekilde'), 'içtenlikle'],
  [W('şaşkın bir şekilde'), 'şaşkınlıkla'],
  [W('kararlı bir şekilde'), 'kararlılıkla'],
  [W('kendinden emin bir şekilde'), 'kendinden emin bir tavırla'],
  [W('tedirgin bir şekilde'), 'tedirginlikle'],
  [W('sorunsuz bir şekilde'), 'sorunsuzca'],
  [W('yumuşak bir şekilde'), 'yumuşakça'],
  [W('düzgün bir şekilde'), 'düzgünce'],
  [W('bariz bir şekilde'), 'açıkça'],
  [W('gergin bir şekilde'), 'gergince'],
  [W('huzurlu bir şekilde'), 'huzurla'],
  [W('gizemli bir şekilde'), 'gizemlice'],
  [W('rahat bir şekilde'), 'rahatça'],
  [W('sevimli bir şekilde'), 'sevimlice'],
  [W('şiddetli bir şekilde'), 'şiddetle'],
  [W('gelişigüzel bir şekilde'), 'gelişigüzel'],
  [W('abartılı bir şekilde'), 'abartıyla'],
  [W('soğukkanlı bir şekilde'), 'soğukkanlılıkla'],
  [W('bilinçli bir şekilde'), 'bilinçli olarak'],
  [W('saldırgan bir şekilde'), 'saldırganca'],
  [W('farklı bir şekilde'), 'başka türlü'],
  [W('benzer bir şekilde'), 'benzer biçimde'],
  [W('bu şekilde'), 'böyle'],
  [W('o şekilde'), 'öyle'],
  [W('farkında olmadan'), 'istem dışı'],
  [W('fark etmeden'), 'istemeden'],
];

// zaman bağlaçlarını sırayla çeşitlendir (aşırı "ardından" yığılmasını kırar)
const CONNECTORS = ['Sonra', 'Derken', 'Peşinden', 'Ardından'];

// çevirmen notları: yasaklı "(ÇN: ...)" üretmek yerine tamamen temizle
function notes(t) {
  return t
    .replace(/\s*\((?:TN|ÇN|TL\s*note|Translator['’]?s?\s*note)\s*:[^)]*\)/giu, '')
    .replace(/\s*\[(?:TN|ÇN|TL\s*note|Translator['’]?s?\s*note)\s*:[^\]]*\]/giu, '')
    .replace(/(?:^|\s+)(?<!\p{L})(?:TN|ÇN|TL\s*note|Translator['’]?s?\s*note)\s*:[^\n]*/giu, '');
}

const URL_MASK_RE =
  /(?:https?:\/\/|(?:www|discord)\.)\S+|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|org|net|me|gg|io|jp)(?:\/\S*)?(?![\p{L}\p{N}])/gu;

// 3) dizgi
function typography(t) {
  const urls = [];
  const masked = t.replace(URL_MASK_RE, (m) => {
    urls.push(m);
    return `__URL_${urls.length - 1}__`;
  });
  const out = masked
    .replace(/\.{3,}/g, '…')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/([!?])\s+([!?])/g, '$1$2')
    .replace(/([,;:!?])(?=[^\s"”'’»)}\])…!?])/g, '$1 ')
    .replace(/(?<!\d)\.(?=[^\s"”'’»)}\])…!?0-9])/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return out.replace(/__URL_(\d+)__/g, (_, idx) => urls[Number(idx)]);
}

let connectorTurn = 0;

function context(t) {
  let s = applyRules(t, CONTEXT);
  // cümle başındaki "Ardından" → dönüşümlü bağlaç
  s = s.replace(/(^|[.!?…]\s+)Ardından(?!\p{L})/gu, (m, pre) => {
    const pick = CONNECTORS[connectorTurn++ % CONNECTORS.length];
    return pre + pick;
  });
  return s;
}

function naturalize(text, opt = {}) {
  const onlyContext = Boolean(opt.contextOnly);
  let t = text;
  if (!onlyContext) t = applyRules(t, LEX);
  if (!onlyContext) t = applyRules(t, MECH);
  t = context(t);
  t = notes(t);
  t = typography(t);
  // paragraf başı küçük harf (makine çevirisi artığı) düzeltilir
  if (/^[a-zçğıöşü]/.test(t)) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  return t;
}

if (require.main === module) {
  const FILE = process.argv[2] && !process.argv[2].startsWith('--')
    ? path.resolve(process.argv[2])
    : path.join(ROOT, 'data/paragraphs_final.json');
  const dry = process.argv.includes('--dry');
  const contextOnly = process.argv.includes('--context-only');

  const fin = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let changed = 0;
  const samples = [];
  for (const [pg, arr] of Object.entries(fin)) {
    arr.forEach((t, i) => {
      const n = naturalize(t, { contextOnly });
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

module.exports = { W, LEX, MECH, CONTEXT, notes, typography, context, naturalize };
