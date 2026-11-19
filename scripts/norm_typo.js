// Dizgi normalizasyonu: tarama kaynaklı noktalama yığılmaları, tilde tekrarları,
// aşırı harf uzatmaları ve çift boşlukları tek tipleştirir.
// Kullanım: node scripts/norm_typo.js [--volume <v>] [dosya] [--dry]
const fs = require('fs');
const path = require('path');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');

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

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const abs = resolveTargetFile(args);
const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

const RULES = [
  // çift/üç nokta düzeltmeleri
  ['üç nokta dönüşümü', /\.{2,}/g, '…'],
  ['üç nokta artı nokta', /…\.+/g, '…'],
  // ünlem/soru sonrası kaçak nokta
  ['ünlem/soru nokta', /([!?])\.+/g, '$1'],
  // ünlem/soru yığılması: en fazla üç işaret
  ['noktalama yığılması', /([!?])\1{3,}/g, (m, c) => c.repeat(3)],
  ['karışık noktalama', /[!?]{4,}/g, (m) => (m.includes('!') ? '!!!' : '???')],
  // tilde / dalga tekrarı
  ['tilde tekrarı', /~{2,}/g, '~'],
  ['uzun çizgi tekrarı', /—{3,}/g, '——'],
  // üç nokta: en fazla iki karakter (……)
  ['üç nokta yığılması', /…{4,}/g, '……'],
  // harf uzatma: aynı harf 5+ kez -> 4
  ['harf uzatma', /(\p{L})\1{4,}/gu, (m, c) => c.repeat(4)],
  // çift boşluk
  ['çift boşluk', / {2,}/g, ' '],
  // noktalama öncesi boşluk
  ['noktalama öncesi boşluk', / +([,.;:!?])/g, '$1'],
];

const hits = new Map();
let changedParas = 0;
for (const arr of Object.values(data)) {
  if (!Array.isArray(arr)) continue;
  for (let i = 0; i < arr.length; i++) {
    let t = arr[i];
    for (const [name, re, rep] of RULES) {
      const before = t;
      t = t.replace(re, rep);
      if (t !== before) hits.set(name, (hits.get(name) || 0) + 1);
    }
    t = t.trim();
    if (t !== arr[i]) {
      arr[i] = t;
      changedParas++;
    }
  }
}

console.log(dry ? '(dry-run)' : 'uygulandı');
console.log('değişen paragraf:', changedParas);
for (const [k, v] of [...hits].sort((a, b) => b[1] - a[1])) console.log('  ', k.padEnd(24), v);

if (!dry) {
  fs.writeFileSync(abs, JSON.stringify(data));
  console.log('yazıldı:', abs);
}
