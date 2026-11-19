// Edebî/doğal Türkçe geçişi: makine çevirisinin "resmî" kalıplarını light novel
// anlatımına çevirir, çevirmen notlarını temizler ve dizgiyi tek tipleştirir.
// Kullanım: node scripts/naturalize.js [--volume <v>] [dosya] [--dry] [--context-only]
const fs = require('fs');
const path = require('path');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');

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
    out = out.replace(re, (m) => (typeof to === 'function' ? to(m) : preserveCase(m, to)));
  }
  return out;
}

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî + Türkçe imla düzeltmeleri
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
  [W('bir nevi'), 'bir bakıma'],
  [W('olmasına rağmen'), 'olsa da'],
  [W('herşey'), 'her şey'],
  [W('birşey'), 'bir şey'],
  [W('herkez'), 'herkes'],
  [W('yanlız'), 'yalnız'],
  [W('bir çok'), 'birçok'],
];

// 2) makine çevirisine özgü kalıplar
const MECH = [
  [W('oldukça fazla'), 'epey'],
];

// 2b) bağlamsal zarf kuralları: "X bir şekilde" -> Türkçe zarf
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
  [W('meraklı bir şekilde'), 'merakla'],
  [W('mutlu bir şekilde'), 'mutlulukla'],
  [W('üzüntülü bir şekilde'), 'üzüntüyle'],
  [W('endişeli bir şekilde'), 'endişeyle'],
  [W('öfkeli bir şekilde'), 'öfkeyle'],
  [W('heyecanlı bir şekilde'), 'heyecanla'],
  [W('sinirli bir şekilde'), 'sinirle'],
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

// çevirmen notlarını tamamen temizle: (TN: ...), (ÇN: ...), [TN: ...], vb.
function notes(t) {
  return String(t || '')
    .replace(
      /\(\s*(?:TN|ÇN|T\/N|TL\s*note|Translator['’]?s?\s*note|Çevirmen\s*notu|Ed\.?\s*note)\s*:[^()]*(?:\([^()]*\)[^()]*)*\)/giu,
      ''
    )
    .replace(/\[\s*(?:TN|ÇN|T\/N|TL\s*note|Translator['’]?s?\s*note|Çevirmen\s*notu|Ed\.?\s*note)\s*:[^\]]*\]/giu, '')
    .replace(/(?:^|\s+)(?:\(\s*)?(?<!\p{L})(?:TN|ÇN|T\/N|TL\s*note|Translator['’]?s?\s*note)\s*:[^\n)]*\)?/giu, '')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const URL_MASK_RE =
  /(?:https?:\/\/|(?:www|discord)\.)\S+|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|org|net|me|gg|io|jp)(?:\/\S*)?(?![\p{L}\p{N}])/gu;

// 3) dizgi
function typography(t) {
  const urls = [];
  const masked = String(t || '').replace(URL_MASK_RE, (m) => {
    urls.push(m);
    return `__URL_${urls.length - 1}__`;
  });
  const out = masked
    .replace(/\.{2,}/g, '…')
    .replace(/…\.+/g, '…')
    .replace(/([!?])\.+/g, '$1')
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

function naturalize(text, opts = {}) {
  const onlyContext = Boolean(opts.contextOnly);
  let t = String(text || '');
  t = notes(t);
  if (!onlyContext) t = applyRules(t, LEX);
  if (!onlyContext) t = applyRules(t, MECH);
  t = context(t);
  t = typography(t);
  // paragraf başı küçük harf (makine çevirisi artığı) düzeltilir
  if (/^[a-zçğıöşü]/.test(t)) t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  return t;
}

function resolveTargetFile(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--volume' || a === '--vol' || a === '-v') {
      i++;
      continue;
    }
    if (a.startsWith('--')) continue;
    return path.resolve(a);
  }
  const volKey = parseVolumeArg(args, '4');
  const vol = resolveVolume(volKey);
  if (!vol) {
    console.error(`Bilinmeyen cilt: ${volKey}`);
    process.exit(1);
  }
  return vol.finalFile;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const contextOnly = args.includes('--context-only');
  const FILE = resolveTargetFile(args);

  const fin = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let changed = 0;
  const samples = [];
  for (const [pg, arr] of Object.entries(fin)) {
    if (!Array.isArray(arr)) continue;
    fin[pg] = arr
      .map((t, i) => {
        const n = naturalize(t, { contextOnly });
        if (n !== t) {
          changed++;
          if (samples.length < 8 && Math.random() < 0.06) samples.push([pg, i, t, n]);
        }
        return n;
      })
      .filter((x) => x.trim().length > 0);
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
    console.log('doğallaştırma uygulandı:', changed, 'paragraf | dosya:', FILE);
  }
}

module.exports = {
  W,
  LEX,
  MECH,
  CONTEXT,
  notes,
  typography,
  context,
  naturalize,
};
