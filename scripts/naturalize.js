// Edebî/doğal Türkçe geçişi: makine çevirisinin "resmî" kalıplarını light novel
// anlatımına çevirir, çevirmen notlarını temizler ve dizgiyi tek tipleştirir.
// Kullanım: node scripts/naturalize.js [--volume <v>] [dosya] [--dry] [--context-only]
const fs = require('fs');
const path = require('path');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');

function matchCase(replacement, matched) {
  if (!matched || !replacement) return replacement;
  const first = matched.charAt(0);
  if (first === first.toLocaleUpperCase('tr') && first !== first.toLocaleLowerCase('tr')) {
    return replacement.charAt(0).toLocaleUpperCase('tr') + replacement.slice(1);
  }
  return replacement;
}

const W = (pat) => new RegExp('(?<!\\p{L})' + pat + '(?!\\p{L})', 'giu');

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî + Türkçe imla düzeltmeleri
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
  [W('dikkatli bir şekilde'), 'dikkatle'],
  [W('ciddi bir şekilde'), 'ciddiyetle'],
  [W('kararlı bir şekilde'), 'kararlılıkla'],
  [W('meraklı bir şekilde'), 'merakla'],
  [W('endişeli bir şekilde'), 'endişeyle'],
  [W('şaşkın bir şekilde'), 'şaşkınlıkla'],
  [W('mutlu bir şekilde'), 'mutlulukla'],
  [W('öfkeli bir şekilde'), 'öfkeyle'],
  [W('heyecanlı bir şekilde'), 'heyecanla'],
  [W('sinirli bir şekilde'), 'sinirle'],
  [W('gergin bir şekilde'), 'gergince'],
  [W('doğal bir şekilde'), 'doğalca'],
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
  [W('belirgin bir şekilde'), 'belirgin biçimde'],
  [W('farklı bir şekilde'), 'başka türlü'],
  [W('benzer bir şekilde'), 'benzer biçimde'],
  [W('bu şekilde'), 'böyle'],
  [W('o şekilde'), 'öyle'],
  [W('farkında olmadan'), 'istem dışı'],
  [W('fark etmeden'), 'istemeden'],
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

// çevirmen notlarını tamamen temizle: (TN: ...), (ÇN: ...), [TN: ...], vb.
function notes(t) {
  return String(t || '')
    .replace(/\(\s*(?:TN|ÇN|T\/N|TL\s*note|Translator['’]?s?\s*note|Çevirmen\s*notu|Ed\.?\s*note)\s*:[^()]*(?:\([^()]*\)[^()]*)*\)/gi, '')
    .replace(/\[\s*(?:TN|ÇN|T\/N|TL\s*note|Translator['’]?s?\s*note|Çevirmen\s*notu|Ed\.?\s*note)\s*:[^\]]*\]/gi, '')
    .replace(/(?:^|\s+)(?:\(\s*)?(?:TN|ÇN|T\/N|TL\s*note|Translator['’]?s?\s*note)\s*:[^\n)]*\)?/gi, '')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// 3) dizgi
function typography(t) {
  return String(t || '')
    .replace(/\.{2,}/g, '…')
    .replace(/…\.+/g, '…')
    .replace(/([!?])\.+/g, '$1')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/([!?])\s+([!?])/g, '$1$2')
    .replace(/([,;:!?])(?=[^\s"”'’»)}\])…!?])/g, '$1 ')
    .replace(/(?<!\d)\.(?=[^\s"”'’»)}\])…!?0-9])/g, '. ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

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
  const urls = [];
  let masked = t.replace(
    /https?:\s*\/\/(?:[^\s)]|\.\s+(?:com|gg|me|org|net|xyz))+|\b[\w-]+\s*\.\s*(?:com|gg|me|org|net|xyz)(?:\/[^\s)]*)?/giu,
    (m) => {
      urls.push(m);
      return `__URL_${urls.length - 1}__`;
    }
  );
  let out = masked.replace(/^([“"‘'(\[{]*)([a-zçğıöşü])/u, (m, pre, ch) => pre + ch.toLocaleUpperCase('tr'));
  out = out.replace(
    /((?:(?<!\d)(?<!(?<!\p{L})(?:vb|vs|bkz|örn|ör|dr|prof|sn|yy|Vb|Vs|Bkz|Örn|Ör|Dr|Prof|Sn))\.|[!?])\s+[“"‘'(\[{]*)([a-zçğıöşü])/gu,
    (m, pre, ch) => pre + ch.toLocaleUpperCase('tr')
  );
  return out.replace(/__URL_(\d+)__/g, (_, i) => urls[Number(i)]);
}

function naturalize(text, opts = {}) {
  const onlyCtx = Boolean(opts.contextOnly);
  let t = String(text || '');
  t = notes(t);
  if (!onlyCtx) for (const [re, to] of LEX) t = replacePreserveCase(t, re, to);
  if (!onlyCtx) for (const [re, to] of MECH) t = replacePreserveCase(t, re, to);
  t = context(t);
  t = typography(t);
  t = capitalizeStops(t);
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
    const rawExisting = fs.readFileSync(FILE, 'utf8');
    const indent = rawExisting.startsWith('{\n "') ? 1 : 2;
    fs.writeFileSync(FILE, JSON.stringify(fin, null, indent) + '\n');
    console.log('doğallaştırma uygulandı:', changed, 'paragraf | dosya:', FILE);
  }
}

module.exports = {
  naturalize,
  notes,
  capitalizeStops,
  replacePreserveCase,
  typography,
  context,
};
