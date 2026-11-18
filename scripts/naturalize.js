// Edebî/doğal Türkçe geçişi: makine çevirisinin "resmî" kalıplarını light novel
// anlatımına çevirir, dizgiyi tek tipleştirir. Kural listesi deterministiktir:
// diyalog içi korumalıdır, anlamı bozmayacak bağlamsal dönüşümler uygulanır.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'data/paragraphs_final.json');
const dry = process.argv.includes('--dry');
const contextOnly = process.argv.includes('--context-only');

function W(str, flags = 'gui') {
  return new RegExp('(?<!\\p{L})' + str + '(?!\\p{L})', flags);
}

function replacePreserveCase(text, regex, replacement) {
  if (typeof replacement === 'function') return text.replace(regex, replacement);
  return text.replace(regex, (match) => {
    const firstChar = match.charAt(0);
    if (firstChar === firstChar.toLocaleUpperCase('tr') && firstChar !== firstChar.toLocaleLowerCase('tr')) {
      return replacement.charAt(0).toLocaleUpperCase('tr') + replacement.slice(1);
    }
    return replacement;
  });
}

// Diyalog bloklarını koruma (alıntı içindeki diyaloglar tahrif edilmez)
const DIALOGUE_RE = /(“[^”]*”|『[^』]*』)/g;

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî
const LEX = [
  [W('söz konusu(?!\\s+(?:değil|olmadığı|olduğu))'), 'o'],
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

// 2b) bağlamsal zarf kuralları: "X bir şekilde" -> Türkçe zarf/morfolojik ek
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
  [W('zarif bir şekilde'), 'zarifçe'],
  [W('yumuşak bir şekilde'), 'yumuşakça'],
  [W('derin bir şekilde'), 'derince'],
  [W('düzgün bir şekilde'), 'düzgünce'],
  [W('asil bir şekilde'), 'asilce'],
  [W('şeytani bir şekilde'), 'şeytanca'],
  [W('huzurlu bir şekilde'), 'huzurla'],
  [W('sorunsuz bir şekilde'), 'sorunsuzca'],
  [W('mutlu bir şekilde'), 'mutlulukla'],
  [W('samimi bir şekilde'), 'samimiyetle'],
  [W('şaşkın bir şekilde'), 'şaşkınlıkla'],
  [W('gergin bir şekilde'), 'gergince'],
  [W('tedirgin bir şekilde'), 'tedirgince'],
  [W('yorgun bir şekilde'), 'yorgunca'],
  [W('bariz bir şekilde'), 'bariz biçimde'],
  [W('garip bir şekilde'), 'garip biçimde'],
  [W('beklenmedik bir şekilde'), 'beklenmedik biçimde'],
  [W('tuhaf bir şekilde'), 'tuhafça'],
  [W('şakacı bir şekilde'), 'şakacı bir tavırla'],
  [W('alaycı bir şekilde'), 'alaycı bir tavırla'],
  [W('duygusal bir şekilde'), 'duygusal bir tavırla'],
  [W('istem dışı bir şekilde'), 'istem dışı'],
  [W('açık sözlü bir şekilde'), 'açıkça'],
  [W('doğal bir şekilde'), 'doğal olarak'],
  [W('hoş olmayan bir şekilde'), 'tatsız bir biçimde'],
  [W('çıkaran bir şekilde'), 'çıkarırcasına'],
  [W('olmayan bir şekilde'), 'olmayacak biçimde'],
  [W('gömmüş bir şekilde'), 'gömmüş halde'],
  [W('çatmış bir şekilde'), 'çatmış halde'],
  [W('kızarmış bir şekilde'), 'kızarmış halde'],
  [W('dalmış bir şekilde'), 'dalmış halde'],
  // -ce/-ca bir şekilde -> -ce/-ca
  [new RegExp('(?<!\\p{L})(\\p{L}+(?:ce|ca|çe|ça))\\s+bir şekilde(?!\\p{L})', 'gui'), '$1'],
  // -lı/-li bir şekilde -> -lıca/-lice
  [new RegExp('(?<!\\p{L})(\\p{L}+(?:lı|li|lu|lü))\\s+bir şekilde(?!\\p{L})', 'gui'), '$1ce'],
  // Anlatısal bağlamdaki "bir şekilde" kalıpları
  [W('Sonra bir şekilde'), 'Sonra bir yolunu bulup'],
  [new RegExp('(?<!\\p{L})Böylece,\\s*bir şekilde(?!\\p{L})', 'gui'), 'Böylece öyle ya da böyle'],
  [new RegExp('(?<!\\p{L})Masachika,\\s*bir şekilde(?!\\p{L})', 'gui'), 'Masachika nasıl olduysa'],
  [W('Masachika bir şekilde'), 'Masachika bir yolunu bulup'],
  [W('olduğunu bir şekilde tahmin etmiş'), 'olduğunu nasılsa tahmin etmiş'],
  [new RegExp('(?<!\\p{L})\\(\\?\\),\\s*bir şekilde(?!\\p{L})', 'gui'), '(?), öyle ya da böyle'],
  [W('Aşk konusunda'), 'Aşkta'],
  [W('kütlesi açısından'), 'kütlesi bakımından'],
  [W('noktasına yönelik atma'), 'noktayı hedef alan atma'],
  [W('sanki kendinden utanmış gibi'), 'kendinden utanmışçasına'],
  [new RegExp('(?<!\\p{L})Hatta,\\s+', 'gui'), 'Hatta '],
];

// Zaman bağlaçlarını çeşitlendirme ("ardından" kalıbını kırar)
const CLAUSE_CONNECTORS = ['sonrasında', 'bunun üzerine', 'daha sonra', 'peşinden'];
const SENT_CONNECTORS = ['Sonrasında', 'Daha sonra', 'Bunun üzerine', 'Derken', 'Peşinden', 'Ardından'];
let clauseTurn = 0;
let sentTurn = 0;

function diversifyConnectors(text) {
  let s = text;
  // Cümle başındaki "Ardından" (başlangıç veya nokta, ünlem, soru, üç nokta ve parantez/tırnak sonrası)
  s = s.replace(/(^|[.!?…][”"’)\]]*\s+)Ardından\b/gu, (m, pre) => {
    const pick = SENT_CONNECTORS[sentTurn++ % SENT_CONNECTORS.length];
    return pre + pick;
  });

  // Hemen ardından
  s = s.replace(/(?<!\p{L})Hemen ardından\b/gu, () => {
    const alts = ['Hemen sonrasında', 'Çok geçmeden', 'Derken', 'Hemen peşinden'];
    return alts[clauseTurn++ % alts.length];
  });

  // Noktalı virgül sonrası: ; ardından
  s = s.replace(/;\s*ardından\b/gu, () => {
    const pick = CLAUSE_CONNECTORS[clauseTurn++ % CLAUSE_CONNECTORS.length];
    return '; ' + pick;
  });

  // ve ardından
  s = s.replace(/(?<!\p{L})ve ardından\b/gu, () => {
    const pick = ['ve sonra', 've sonrasında', 've daha sonra', 've peşinden'][clauseTurn++ % 4];
    return pick;
  });

  // Virgül sonrası: , ardından
  s = s.replace(/,\s*ardından\b/gu, () => {
    const pick = CLAUSE_CONNECTORS[clauseTurn++ % CLAUSE_CONNECTORS.length];
    return ', ' + pick;
  });

  return s;
}

// 2c) Tekrarlayan algı kalıplarını tekil doğal kiplik yüklemlerine açma
function unwindPerception(text) {
  let s = text;
  // "sanki ... gibiydi" ikili algı kalıbını çözme
  s = s.replace(/(?<!\p{L})[Ss]anki\s+(\uE000DLG_\d+\uE001)\s+der\s+gibiydi/gu, '$1 der gibiydi');
  s = s.replace(/(?<!\p{L})[Ss]anki\s+([^.!?…\uE000]+?)\s+der\s+gibiydi/gu, '“$1” der gibiydi');
  s = s.replace(/(?<!\p{L})Sanki\s+(sadece|bir tür|vücudundaki)\s+([^.!?…]+?)\s+gibiydi/gu, (m, w1, rest) => {
    return (w1.charAt(0).toLocaleUpperCase('tr') + w1.slice(1)) + ' ' + rest + ' gibiydi';
  });
  s = s.replace(/(?<!\p{L})sanki\s+(sadece|bir tür|vücudundaki)\s+([^.!?…]+?)\s+gibiydi/gu, '$1 $2 gibiydi');
  s = s.replace(/(?<!\p{L})[Ss]anki\s+([^.!?…]+?(?:casına|cesine|çasına|çesine))/gu, '$1');
  s = s.replace(/(?<!\p{L})anlamış gibiydi/gu, 'anlamışa benziyordu');
  s = s.replace(/(?<!\p{L})[Ss]anki\s+uçuruma açılan bir geçit gibi görünüyordu/gu, 'uçuruma açılan bir geçidi andırıyordu');

  // "gibi görünüyordu" -> tekil kiplik yüklemleri (andıran, benzeyen, gözüken, duran)
  s = s.replace(/(?<!\p{L})tıpkı bir ilkokul öğrencisi gibi görünüyordu/gu, 'tıpkı bir ilkokul öğrencisini andırıyordu');
  s = s.replace(/(?<!\p{L})bir hamster gibi görünüyordu/gu, 'bir hamsterı andırıyordu');
  s = s.replace(/(?<!\p{L})niyetinde değilmiş gibi görünüyordu/gu, 'niyetinde gözükmüyordu');
  s = s.replace(/(?<!\p{L})tahmin etmiş gibi görünüyordu/gu, 'tahmin etmişe benziyordu');
  s = s.replace(/(?<!\p{L})pek memnun kalmamış gibi görünüyordu/gu, 'pek memnun kalmamışa benziyordu');
  s = s.replace(/(?<!\p{L})aynı şeyi hissediyor gibi görünüyordu/gu, 'aynı şeyi hissediyora benziyordu');
  s = s.replace(/(?<!\p{L})endişeli gibi görünüyordu/gu, 'endişeli gözüküyordu');
  s = s.replace(/(?<!\p{L})rahatsız olmuş gibi görünüyordu/gu, 'rahatsız olmuş gözüküyordu');
  s = s.replace(/(?<!\p{L})maço bir adam gibi görünüyordu/gu, 'maço bir adamı andırıyordu');
  s = s.replace(/(?<!\p{L})ağlamak üzereymiş gibi görünüyordu/gu, 'ağlamak üzere gözüküyordu');
  s = s.replace(/(?<!\p{L})“Masachika uyuyan Maria’ya saldırıyor” gibi görünüyordu/gu, '“Masachika uyuyan Maria’ya saldırıyor” gibi duruyordu');
  s = s.replace(/(?<!\p{L})Ne yapacağını bilmiyor gibi görünüyordu/gu, 'Ne yapacağını bilemez halde');
  s = s.replace(/(?<!\p{L})hiç sarsılmamış gibi görünüyordu/gu, 'hiç sarsılmamışa benziyordu');
  s = s.replace(/(?<!\p{L})net biçimde görünüyordu/gu, 'net biçimde belli oluyordu');
  s = s.replace(/(?<!\p{L})gibi görünüyordu/gu, 'gözüküyordu');

  return s;
}

// 2d) 7 veya daha fazla virgül içeren uzun virgül zincirlerini bağlaç sınırlarında bölme
function splitCommaChains(text) {
  let s = text;
  const commaCount = (s.match(/,/g) || []).length;
  if (commaCount >= 7) {
    s = s.replace(/,\s*ancak…/gu, '. Ancak…');
    s = s.replace(/,\s*ancak\b/gu, '. Ancak');
    s = s.replace(/,\s*ama\b/gu, '. Ama');
    s = s.replace(/,\s*fakat\b/gu, '. Fakat');
    s = s.replace(/,\s*oysa\b/gu, '. Oysa');
    s = s.replace(/,\s*çünkü\b/gu, '. Çünkü');
    s = s.replace(/,\s*üstelik\b/gu, '. Üstelik');
    s = s.replace(/,\s*sadece\s+([A-ZÇĞİÖŞÜ])/gu, '. Sadece $1');
    s = s.replace(/,\s*$/gu, '.');
  }
  s = s.replace(/;\s*ancak\b/gu, '. Ancak');
  return s;
}

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
    .replace(/([,;:!?])(?=[^\s"”'’»)}\]…!?])/g, '$1 ')
    .replace(/(?<!\d)\.(?=[^\s"”'’»)}\]…!?0-9])/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function naturalize(text) {
  // Alıntı içi diyalogları korumak için maskeleme
  const dlg = [];
  let t = text.replace(DIALOGUE_RE, (m) => {
    dlg.push(m);
    return `\uE000DLG_${dlg.length - 1}\uE001`;
  });

  if (!contextOnly) {
    for (const [re, to] of LEX) t = replacePreserveCase(t, re, to);
    for (const [re, to] of MECH) t = replacePreserveCase(t, re, to);
  }
  for (const [re, to] of CONTEXT) t = replacePreserveCase(t, re, to);
  t = diversifyConnectors(t);
  t = unwindPerception(t);
  t = splitCommaChains(t);
  t = notes(t);
  t = typography(t);

  // Maskelenen diyalogları geri yükle
  t = t.replace(/\uE000DLG_(\d+)\uE001/g, (_, i) => dlg[+i]);

  // paragraf başı küçük harf (makine çevirisi artığı) düzeltilir
  if (/^[a-zçğıöşü]/.test(t)) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  return t;
}

const fin = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let changed = 0;
const samples = [];
for (const [pg, arr] of Object.entries(fin)) {
  arr.forEach((t, i) => {
    const n = naturalize(t);
    if (n !== t) {
      changed++;
      if (samples.length < 8 && Math.random() < 0.1) samples.push([pg, i, t, n]);
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
