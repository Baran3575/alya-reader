// Sayfa sınırında bölünen parantezleri/paragrafları onarır.
// Kullanım: node scripts/fix_boundaries.js [--volume <v>] [dosya] [--dry]
// Kural: açık parantezi kapanmayan paragraf ile, kapanış paranteziyle başlayan
// sonraki paragraf birleştirilir. Eşleşme yoksa tek başına kalan parantez silinir.
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

const opens = (t) => (t.match(/\(/g) || []).length;
const closes = (t) => (t.match(/\)/g) || []).length;

const report = { merged: [], stripped: [], ocr: [] };

// 1) OCR çöpü: yalnızca anlamsız karakter yığını olan ve sayfa numarası <= 3 olan kayıtlar
for (const [p, arr] of Object.entries(data)) {
  if (Number(p) > 3 || !Array.isArray(arr)) continue;
  const keep = arr.filter((t) => {
    const letters = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
    const word = /[a-zçğıöşü]{3,}/.test(t);
    const junk = letters < 6 || !word || /\d\s*[/)]/.test(t);
    if (junk) report.ocr.push(p + ': ' + t.slice(0, 40));
    return !junk;
  });
  if (keep.length !== arr.length) data[p] = keep;
}

// 2) paragraf içi/sayfa içi ve sayfalar arası birleştirme
const pages = Object.keys(data)
  .filter((k) => /^\d+$/.test(k))
  .map(Number)
  .sort((a, b) => a - b);

for (let pi = 0; pi < pages.length; pi++) {
  const p = String(pages[pi]);
  const arr = data[p];
  if (!Array.isArray(arr)) continue;
  for (let i = 0; i < arr.length - 1; i++) {
    if (opens(arr[i]) > closes(arr[i]) && closes(arr[i + 1]) > opens(arr[i + 1])) {
      arr[i] = arr[i] + ' ' + arr[i + 1];
      report.merged.push(p + ':' + i + ' + ' + (i + 1));
      arr.splice(i + 1, 1);
      i--;
    }
  }
  const last = arr.length - 1;
  if (last >= 0 && opens(arr[last]) > closes(arr[last])) {
    const np = String(pages[pi + 1]);
    const next = data[np];
    if (next && next.length && closes(next[0]) > opens(next[0])) {
      arr[last] = arr[last] + ' ' + next[0];
      report.merged.push(p + ':' + last + ' ↔ s.' + np);
      next.shift();
    }
  }
}

// 3) hâlâ dengesiz kalan parantezleri temizle
for (const [p, arr] of Object.entries(data)) {
  if (!Array.isArray(arr)) continue;
  arr.forEach((t, i) => {
    if (opens(t) === closes(t)) return;
    let s = t;
    if (opens(s) > closes(s)) s = s.replace(/\(/g, '');
    else s = s.replace(/\)/g, '');
    s = s.replace(/\s{2,}/g, ' ').trim();
    arr[i] = s;
    report.stripped.push(p + ':' + i);
  });
}

console.log('birleştirilen:', report.merged.length, '| parantez temizlenen:', report.stripped.length, '| OCR temizlenen:', report.ocr.length);
report.ocr.forEach((x) => console.log('  ocr  ', x));
report.merged.slice(0, 20).forEach((x) => console.log('  birleş', x));
report.stripped.slice(0, 20).forEach((x) => console.log('  temiz ', x));

if (!dry) {
  fs.writeFileSync(abs, JSON.stringify(data));
  console.log('yazıldı:', abs, '| paragraf:', Object.values(data).flat().length);
} else {
  console.log('(dry-run, yazılmadı)');
}
