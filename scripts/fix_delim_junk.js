// Cilt 9.5 / 4.5 metin temizliği: OCR görsel gürültüsü ve dengesiz ayraç onarımı.
// Kaynak: glucosetl HTML sayfaları (9.5) illüstrasyon altı OCR çöpü ve karışık { } / [ ] ayraçları içeriyor.
// Kullanım: node scripts/fix_delim_junk.js [--dry]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');

const TARGETS = [
  { dir: 'data95', label: 'Cilt 9.5' },
  { dir: 'data45', label: 'Cilt 4.5' },
  { dir: 'data5', label: 'Cilt 5' },
  { dir: 'data6', label: 'Cilt 6' },
  { dir: 'data7', label: 'Cilt 7' },
  { dir: 'data8', label: 'Cilt 8' },
  { dir: 'data9', label: 'Cilt 9' },
  { dir: 'data10', label: 'Cilt 10' },
  { dir: 'data11', label: 'Cilt 11' },
  { dir: 'data12', label: 'Cilt 12' },
];

const bal = (s, o, c) => {
  let n = 0;
  for (const ch of s) {
    if (ch === o) n++;
    else if (ch === c) n--;
  }
  return n;
};

// harf oranı düşük, simge yığını satırlar (illüstrasyon üzerindeki OCR artıkları)
function isNoise(text) {
  const t = text.trim();
  if (t.length < 12) return false;
  if (/^[“‘({[]/.test(t) && /[?!.”’)}\]]$/.test(t) && !/[|@#$%^&*_=+<>\\/]/.test(t)) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  const ratio = letters / t.length;
  if (ratio < 0.25 && t.length > 30) return true;
  // hece üretmeyen, tek/iki harfli token yığını
  const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const short = words.filter((w) => w.replace(/[^\p{L}]/gu, '').length <= 2).length;
  return words.length >= 8 && short / words.length > 0.55;
}


// 0) elle yazılmış düzeltmeler (indeksler kaymadan önce) (kaynağa sadık yeniden yazım)
const handPath = path.join(ROOT, 'data', 'handfix_delim.json');
if (fs.existsSync(handPath)) {
  const hand = JSON.parse(fs.readFileSync(handPath, 'utf8'));
  for (const [dir, entries] of Object.entries(hand)) {
    const file = path.join(ROOT, dir, 'paragraphs_final.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    let n = 0;
    for (const [key, text] of Object.entries(entries)) {
      const [pg, i] = key.split('.');
      if (!data[pg] || data[pg][+i] === undefined) {
        console.log('  ! elle düzeltme bulunamadı:', dir, key);
        continue;
      }
      if (data[pg][+i] === text) continue;
      data[pg][+i] = text;
      n++;
    }
    if (n && !DRY) fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
    console.log(dir, 'elle düzeltme:', n, DRY ? '(önizleme)' : '');
  }
}


const fixes = [];
let removed = 0;

for (const { dir, label } of TARGETS) {
  const file = path.join(ROOT, dir, 'paragraphs_final.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;

  for (const [pg, arr] of Object.entries(data)) {
    const kept = [];
    arr.forEach((text, i) => {
      if (!text) return; // elle boşaltılan (silinen) paragraf
      const key = `${dir}:${pg}.${i}`;

      if (isNoise(text)) {
        fixes.push({ key, kind: 'OCR çöpü silindi', before: text.slice(0, 60) });
        removed++;
        changed++;
        return; // paragraf düşürüldü
      }

      let t = text;

      // { …]  ->  { …}
      if (bal(t, '{', '}') === 1 && t.includes(']')) t = t.replace(/\]/g, '}');
      // { ile açılıp kapanmamış
      if (bal(t, '{', '}') === 1 && t.trimStart().startsWith('{')) t = t.trimEnd() + '}';
      // [ ile açılıp kapanmamış (grup konuşması)
      if (bal(t, '[', ']') === 1 && t.trimStart().startsWith('[')) t = t.trimEnd() + ']';
      // sonda kalmış yalnız ]
      if (bal(t, '[', ']') === -1 && t.trimEnd().endsWith(']') && !t.includes('[')) {
        t = t.trimEnd().slice(0, -1);
      }
      // [açılış …, kapanışsız ve { } dengesi bozuk değilse süslüye çevir
      if (bal(t, '[', ']') === -1 && t.includes('[') && !t.trimStart().startsWith('[')) {
        t = t.replace(/\[/g, '{').trimEnd() + '}';
      }
      // Japonca köşe tırnağı (telefon mesajı) -> tek eğik tırnak
      t = t.replace(/[\u300E\u300C]/g, '‘').replace(/[\u300F\u300D]/g, '’');
      // tırnak yığılmalarını tekille (iç içe köşe tırnağı dönüşümünden kalanlar)
      for (let k = 0; k < 3; k++) {
        t = t.replace(/‘{2,}/g, '‘').replace(/’{2,}/g, '’');
        t = t.replace(/‘\s+/g, '‘').replace(/\s+’/g, '’');
        t = t.replace(/’\s*’/g, '’').replace(/‘\s*‘/g, '‘');
      }
      // açılışı olup kapanmayan [ (grup konuşması) -> kapat
      if (bal(t, '[', ']') > 0 && t.includes('[')) t = t.trimEnd() + ']'.repeat(bal(t, '[', ']'));
      // OCR artığı nota/ünlem kalıntıları
      t = t.replace(/~[JU](?![0-9])/g, '~♪');
      // iç düşünce: tek tırnak yerine eğik tırnak
      t = t.replace(/(?<=\p{L})'(\p{L}[^']{1,30})'/gu, '‘$1’');

      if (t !== text) {
        fixes.push({ key, kind: 'ayraç/tırnak onarımı', before: text.slice(0, 70), after: t.slice(0, 70) });
        changed++;
      }
      kept.push(t);
    });
    data[pg] = kept;
  }

  if (!DRY && changed) fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
  console.log(`${label}: ${changed} düzeltme${DRY ? ' (önizleme)' : ''}`);
}

// boş bırakılan paragrafları tamamen kaldır (boş paragraf QC hatası olmasın)
for (const d of ['data95', 'data45']) {
  const f = path.join(ROOT, d, 'paragraphs_final.json');
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  let n = 0;
  for (const pg of Object.keys(data)) {
    const before = data[pg].length;
    data[pg] = data[pg].filter((x) => x !== null && String(x).trim() !== '');
    n += before - data[pg].length;
  }
  if (n && !DRY) fs.writeFileSync(f, JSON.stringify(data, null, 1) + '\n');
  if (n) console.log(d, 'boşaltılan paragraf kaldırıldı:', n);
}

console.log('\nOCR çöpü olarak silinen paragraf:', removed);
for (const f of fixes.slice(0, 40)) {
  console.log(' ', f.key, '|', f.kind);
  if (f.after) console.log('    önce:', f.before, '\n    sonra:', f.after);
  else console.log('    ', f.before);
}
console.log('\ntoplam düzeltme:', fixes.length);
