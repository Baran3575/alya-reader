// Edebî/doğal Türkçe geçişi: makine çevirisinin "resmî" kalıplarını light novel
// anlatımına çevirir, dizgiyi tek tipleştirir. Kural listesi bilinçli olarak tutucu:
// anlamı değiştirebilecek dönüşümler yalnızca net kalıplarda uygulanır.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data/paragraphs_final.json');
const dry = process.argv.includes('--dry');

// 1) sözcük/ifade düzeyi: resmî -> günlük/edebî
const LEX = [
  [/\bsöz konusu\b(?!\s+(değil|olmadığı|olduğu))/gi, 'o'],
  [/\badı geçen\b/gi, 'o'],
  [/\bsözü edilen\b/gi, 'o'],
  [/\bbahse konu\b/gi, 'o'],
  [/\bzira\b/gi, 'çünkü'],
  [/\blakin\b/gi, 'ama'],
  [/\bşayet\b/gi, 'eğer'],
  [/\bdolayısıyla\b/gi, 'bu yüzden'],
  [/\bbununla birlikte\b/gi, 'ama'],
  [/\bbu nedenle\b/gi, 'bu yüzden'],
  [/\bbu sebeple\b/gi, 'bu yüzden'],
  [/\bgerçekleştirdi\b/gi, 'yaptı'],
  [/\bgerçekleştirmek\b/gi, 'yapmak'],
  [/\bgerçekleştirilen\b/gi, 'yapılan'],
  [/\bgerçekleştiriyor\b/gi, 'yapıyor'],
  [/\bgerçekleştirmişti\b/gi, 'yapmıştı'],
  [/\bgerçekleştirir\b/gi, 'yapar'],
  [/\bgerçekleşti\b/gi, 'oldu'],
  [/\bgerçekleşen\b/gi, 'olan'],
  [/\bicra etti\b/gi, 'yaptı'],
  [/\bicra etmek\b/gi, 'yapmak'],
  [/\bifade etti\b/gi, 'söyledi'],
  [/\bifade etmek\b/gi, 'söylemek'],
  [/\bifade ediyor\b/gi, 'söylüyor'],
  [/\bifade ederek\b/gi, 'diyerek'],
  [/\bbeyan etti\b/gi, 'söyledi'],
  [/\bönlem aldı\b/gi, 'önlem aldı'],
  [/\bmuvaffak oldu\b/gi, 'başardı'],
  [/\bmuvaffak olmak\b/gi, 'başarmak'],
];

// 2) makine çevirisine özgü kalıplar (anlamı bozmayacak kadar dar)
const MECH = [
  [/\boldukça fazla\b/gi, 'epey'],
];

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

function naturalize(text) {
  let t = text;
  for (const [re, to] of LEX) t = t.replace(re, to);
  for (const [re, to] of MECH) t = t.replace(re, to);
  t = notes(t);
  t = typography(t);
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
