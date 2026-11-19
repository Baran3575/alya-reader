// Metin cerrahisi: verilen sayfada bir paragrafı (veya paragraf parçasını) değiştirir.
// Girdi: data/textfix.json  -> [{ "page": 190, "find": "...", "replace": "..." }]
// Sayfa kalite dosyasında varsa oraya, yoksa paragraphs_final'e yazar.
// node scripts/text_patch.js [--dry] [--vol 4]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOLS = {
  '4': { q: 'data/quality/v4.json', p: 'data/paragraphs_final.json' },
  '4.5': { q: 'data/quality/v4.5.json', p: 'data45/paragraphs_final.json' },
  '5': { q: 'data/quality/v5.json', p: 'data5/paragraphs_final.json' },
  '6': { q: 'data/quality/v6.json', p: 'data6/paragraphs_final.json' },
  '7': { q: 'data/quality/v7.json', p: 'data7/paragraphs_final.json' },
  '8': { q: 'data/quality/v8.json', p: 'data8/paragraphs_final.json' },
  '9': { q: 'data/quality/v9.json', p: 'data9/paragraphs_final.json' },
  '9.5': { q: 'data/quality/v9.5.json', p: 'data95/paragraphs_final.json' },
  '10': { q: 'data/quality/v10.json', p: 'data10/paragraphs_final.json' },
  '11': { q: 'data/quality/v11.json', p: 'data11/paragraphs_final.json' },
  '12': { q: 'data/quality/v12.json', p: 'data12/paragraphs_final.json' },
};

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : '4';

const fixes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/textfix.json'), 'utf8'));
const { q: qf, p: pf } = VOLS[only];
const quality = fs.existsSync(path.join(ROOT, qf)) ? JSON.parse(fs.readFileSync(path.join(ROOT, qf), 'utf8')) : {};
const final = JSON.parse(fs.readFileSync(path.join(ROOT, pf), 'utf8'));

let ok = 0;
let fail = 0;
for (const fix of fixes) {
  const page = String(fix.page);
  const target = quality[page] ? quality : final;
  const arr = target[page];
  if (!Array.isArray(arr)) {
    console.log(`✗ s.${page}: sayfa yok`);
    fail++;
    continue;
  }
  if (Array.isArray(fix.insert)) {
    const at = typeof fix.index === 'number' ? fix.index : arr.length;
    arr.splice(at, 0, ...fix.insert);
    ok++;
    console.log(`✓ s.${page}[${at}] ${fix.insert.length} paragraf eklendi`);
    continue;
  }
  let hit = -1;
  if (typeof fix.index === 'number') {
    if (fix.index < arr.length && (!fix.find || String(arr[fix.index]).includes(fix.find))) hit = fix.index;
  } else for (let i = 0; i < arr.length; i++) {
    if (String(arr[i]).includes(fix.find) || String(arr[i]) === fix.find) {
      hit = i;
      break;
    }
  }
  if (hit < 0) {
    console.log(`✗ s.${page}: eşleşme yok -> ${fix.find.slice(0, 60)}`);
    fail++;
    continue;
  }
  const before = String(arr[hit]);
  if (fix.replace === null) {
    arr.splice(hit, 1);
    ok++;
    console.log(`✓ s.${page}[${hit}] paragraf silindi ${quality[page] ? '(kalite)' : '(final)'}`);
    continue;
  }
  arr[hit] = before === fix.find ? fix.replace : before.replace(fix.find, fix.replace);
  ok++;
  console.log(`✓ s.${page}[${hit}] ${quality[page] ? '(kalite)' : '(final)'}`);
}

if (!dry) {
  if (Object.keys(quality).length && fixes.some((f) => quality[String(f.page)])) {
    fs.writeFileSync(path.join(ROOT, qf), JSON.stringify(quality, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(ROOT, pf), JSON.stringify(final, null, 2) + '\n');
}
console.log(`uygulandı: ${ok}, başarısız: ${fail}${dry ? ' (deneme)' : ''}`);
