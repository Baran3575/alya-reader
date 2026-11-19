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

function caseReplace(re, to) {
  return [re, (m) => matchCase(to, m)];
}

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî + Türkçe imla düzeltmeleri
const LEX = [
  caseReplace(/\bsöz konusu\b(?!\s+(değil|olmadığı|olduğu))/gi, 'o'),
  caseReplace(/\badı geçen\b/gi, 'o'),
  caseReplace(/\bsözü edilen\b/gi, 'o'),
  caseReplace(/\bbahse konu\b/gi, 'o'),
  caseReplace(/\bzira\b/gi, 'çünkü'),
  caseReplace(/\blakin\b/gi, 'ama'),
  caseReplace(/\bşayet\b/gi, 'eğer'),
  caseReplace(/\bdolayısıyla\b/gi, 'bu yüzden'),
  caseReplace(/\bbununla birlikte\b/gi, 'ama'),
  caseReplace(/\bbu nedenle\b/gi, 'bu yüzden'),
  caseReplace(/\bbu sebeple\b/gi, 'bu yüzden'),
  caseReplace(/\bgerçekleştirdi\b/gi, 'yaptı'),
  caseReplace(/\bgerçekleştirmek\b/gi, 'yapmak'),
  caseReplace(/\bgerçekleştirilen\b/gi, 'yapılan'),
  caseReplace(/\bgerçekleştiriyor\b/gi, 'yapıyor'),
  caseReplace(/\bgerçekleştirmişti\b/gi, 'yapmıştı'),
  caseReplace(/\bgerçekleştirir\b/gi, 'yapar'),
  caseReplace(/\bgerçekleşti\b/gi, 'oldu'),
  caseReplace(/\bgerçekleşen\b/gi, 'olan'),
  caseReplace(/\bicra etti\b/gi, 'yaptı'),
  caseReplace(/\bicra etmek\b/gi, 'yapmak'),
  caseReplace(/\bifade etti\b/gi, 'söyledi'),
  caseReplace(/\bifade etmek\b/gi, 'söylemek'),
  caseReplace(/\bifade ediyor\b/gi, 'söylüyor'),
  caseReplace(/\bifade ederek\b/gi, 'diyerek'),
  caseReplace(/\bbeyan etti\b/gi, 'söyledi'),
  caseReplace(/\bmuvaffak oldu\b/gi, 'başardı'),
  caseReplace(/\bmuvaffak olmak\b/gi, 'başarmak'),
  caseReplace(/\bbir nevi\b/gi, 'bir bakıma'),
  caseReplace(/\bolmasına rağmen\b/gi, 'olsa da'),
  caseReplace(/(?<!\p{L})herşey(?!\p{L})/gui, 'her şey'),
  caseReplace(/(?<!\p{L})birşey(?!\p{L})/gui, 'bir şey'),
  caseReplace(/(?<!\p{L})herkez(?!\p{L})/gui, 'herkes'),
  caseReplace(/(?<!\p{L})yanlız(?!\p{L})/gui, 'yalnız'),
  caseReplace(/(?<!\p{L})bir çok(?!\p{L})/gui, 'birçok'),
];

// 2) makine çevirisine özgü kalıplar
const MECH = [
  caseReplace(/\boldukça fazla\b/gi, 'epey'),
  caseReplace(/\bdikkatli bir şekilde\b/gi, 'dikkatle'),
  caseReplace(/\bciddi bir şekilde\b/gi, 'ciddiyetle'),
  caseReplace(/\bkararlı bir şekilde\b/gi, 'kararlılıkla'),
  caseReplace(/\bmeraklı bir şekilde\b/gi, 'merakla'),
  caseReplace(/\bendişeli bir şekilde\b/gi, 'endişeyle'),
  caseReplace(/\bşaşkın bir şekilde\b/gi, 'şaşkınlıkla'),
  caseReplace(/\bmutlu bir şekilde\b/gi, 'mutlulukla'),
  caseReplace(/\böfkeli bir şekilde\b/gi, 'öfkeyle'),
  caseReplace(/\bheyecanlı bir şekilde\b/gi, 'heyecanla'),
  caseReplace(/\bsinirli bir şekilde\b/gi, 'sinirle'),
  caseReplace(/\bgergin bir şekilde\b/gi, 'gergince'),
  caseReplace(/\bdoğal bir şekilde\b/gi, 'doğalca'),
];

// 2b) bağlamsal zarf kuralları: "X bir şekilde" -> Türkçe zarf
const CONTEXT = [
  caseReplace(/\bçok hızlı bir şekilde\b/gi, 'hızla'),
  caseReplace(/\bhızlı bir şekilde\b/gi, 'hızlıca'),
  caseReplace(/\byavaş bir şekilde\b/gi, 'yavaşça'),
  caseReplace(/\bsessiz bir şekilde\b/gi, 'sessizce'),
  caseReplace(/\bnazik bir şekilde\b/gi, 'nazikçe'),
  caseReplace(/\bsakin bir şekilde\b/gi, 'sakince'),
  caseReplace(/\bkolay bir şekilde\b/gi, 'kolayca'),
  caseReplace(/\bkesin bir şekilde\b/gi, 'kesinlikle'),
  caseReplace(/\bbelirgin bir şekilde\b/gi, 'belirgin biçimde'),
  caseReplace(/\bfarklı bir şekilde\b/gi, 'başka türlü'),
  caseReplace(/\bbenzer bir şekilde\b/gi, 'benzer biçimde'),
  caseReplace(/\bbu şekilde\b/gi, 'böyle'),
  caseReplace(/\bo şekilde\b/gi, 'öyle'),
  caseReplace(/\bfarkında olmadan\b/gi, 'istem dışı'),
  caseReplace(/\bfark etmeden\b/gi, 'istemeden'),
];

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
  for (const [re, to] of CONTEXT) s = s.replace(re, to);
  // cümle başındaki "Ardından" → dönüşümlü bağlaç
  s = s.replace(/(^|[.!?…]\s+)Ardından\b/g, (m, pre) => {
    const pick = CONNECTORS[connectorTurn++ % CONNECTORS.length];
    return pre + pick;
  });
  return s;
}

function naturalize(text, opts = {}) {
  const contextOnly = Boolean(opts.contextOnly);
  let t = String(text || '');
  t = notes(t);
  if (!contextOnly) for (const [re, to] of LEX) t = t.replace(re, to);
  if (!contextOnly) for (const [re, to] of MECH) t = t.replace(re, to);
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
  naturalize,
  notes,
  typography,
  context,
};
