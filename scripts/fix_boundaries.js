// Sayfa sınırında bölünen parantezleri ve yarım cümle kırpıntılarını onarır.
// Kullanım: node scripts/fix_boundaries.js [--volume <v>] [dosya] [--dry]
// Kural:
// 1) Açık parantezi kapanmayan paragraf ile kapanış paranteziyle başlayan sonraki paragraf birleştirilir.
// 2) Kaynak metin (source.json) sayfa sonunda cümle ortasında kesiliyorsa, sonraki sayfanın başındaki
//    1-3 kelimelik yetim cümle kırpıntısı ("Elbise.", "Saç modeli.", "O." vb.) önceki sayfaya bağlanır;
//    hiçbir sayfa tamamen boşaltılmaz.
const fs = require('fs');
const path = require('path');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');

const opens = (t) => (String(t).match(/\(/g) || []).length;
const closes = (t) => (String(t).match(/\)/g) || []).length;

function resolveTarget(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--volume' || a === '--vol' || a === '-v') {
      i++;
      continue;
    }
    if (a.startsWith('--')) continue;
    return { finalFile: path.resolve(a), sourceFile: null };
  }
  const volKey = parseVolumeArg(args, '4');
  const vol = resolveVolume(volKey);
  if (!vol) {
    console.error(`Bilinmeyen cilt: ${volKey}`);
    process.exit(1);
  }
  return { finalFile: vol.finalFile, sourceFile: vol.sourceFile };
}

function loadSourceMap(sourceInput) {
  if (!sourceInput) return {};
  let raw = sourceInput;
  if (typeof sourceInput === 'string') {
    if (!fs.existsSync(sourceInput)) return {};
    raw = JSON.parse(fs.readFileSync(sourceInput, 'utf8'));
  }
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.pages) ? raw.pages : [];
  const map = {};
  for (const item of arr) {
    if (item && item.page !== undefined) map[String(item.page)] = String(item.text || '');
  }
  return map;
}

function lowerFirstTr(s) {
  if (!s) return s;
  // Özel adlar küçük harfe çevrilmez
  if (/^(?:Masachika|Kuze|Alya|Alisa|Kujou|Yuki|Suou|Ayano|Kimishima|Maria|Masha|Sayaka|Nonoa|Chisaki|Touya|Sumire|Kiryuin|Violet|Elena|Hikaru|Takeshi|Seirei|Raikokai|Slit-Paisen)\b/u.test(s)) {
    return s;
  }
  return s.charAt(0).toLocaleLowerCase('tr') + s.slice(1);
}

function repairBoundaries(data, sourceInput = null) {
  const srcMap = loadSourceMap(sourceInput);
  const report = { merged: [], fragments: [], stripped: [], ocr: [] };

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

  // 2) Paragraf içi/sayfa içi ve sayfalar arası parantez + yetim kırpıntı birleştirme
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
    if (last < 0 || pi + 1 >= pages.length) continue;
    const np = String(pages[pi + 1]);
    const next = data[np];
    if (!Array.isArray(next) || next.length === 0) continue;

    // 2a) Sayfalar arası açık/kapalı parantez birleştirme (sonraki sayfayı tamamen boşaltmadan)
    if (opens(arr[last]) > closes(arr[last]) && closes(next[0]) > opens(next[0]) && next.length > 1) {
      arr[last] = arr[last] + ' ' + next[0];
      report.merged.push(p + ':' + last + ' ↔ s.' + np);
      next.shift();
      continue;
    }

    // 2b) Kaynak metin akışına dayalı sayfa başı yetim kırpıntı onarımı
    const enCur = (srcMap[p] || '').trim();
    const enNext = (srcMap[np] || '').trim();
    const hasSrcHint = enCur && enNext ? /[A-Za-z,;—-]$/.test(enCur) && /^[a-z]/.test(enNext) : false;

    if (hasSrcHint && !arr[last].startsWith('ÇN:') && !next[0].startsWith('ÇN:')) {
      const m = next[0].match(/^([A-ZÇĞİÖŞÜ][\p{L}’'-]*(?:\s+[\p{L}’'-]+){0,2})\.\s+([\s\S]+)$/u);
      if (m && !/^(?:Evet|Hayır|Ancak|Fakat|Sonra|Derken|Ardından|Tamam|Peki|Belki|Tabii|Elbette|Örneğin|Mesela|Neyse|Doğrusu|Gerçekten)$/u.test(m[1])) {
        const frag = lowerFirstTr(m[1]);
        const rest = m[2].trim();
        if (!/[.!?…"”’)}\]⋆◇]$/.test(arr[last])) {
          arr[last] = `${arr[last].trim()} ${frag}.`;
        } else if (arr[last].endsWith('.')) {
          arr[last] = `${arr[last].slice(0, -1)} — ${frag}.`;
        }
        next[0] = rest;
        report.fragments.push(`${p}:${last} <- s.${np} ("${m[1]}.")`);
      }
    }
  }

  // 3) Hâlâ dengesiz kalan parantezleri temizle
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

  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const { finalFile, sourceFile } = resolveTarget(args);
  const data = JSON.parse(fs.readFileSync(finalFile, 'utf8'));
  const report = repairBoundaries(data, sourceFile);

  console.log(
    'birleştirilen:',
    report.merged.length,
    '| kırpıntı onarılan:',
    report.fragments.length,
    '| parantez temizlenen:',
    report.stripped.length,
    '| OCR temizlenen:',
    report.ocr.length
  );
  report.ocr.forEach((x) => console.log('  ocr   ', x));
  report.merged.slice(0, 20).forEach((x) => console.log('  birleş', x));
  report.fragments.slice(0, 20).forEach((x) => console.log('  kırpın', x));
  report.stripped.slice(0, 20).forEach((x) => console.log('  temiz ', x));

  if (!dry) {
    fs.writeFileSync(finalFile, JSON.stringify(data, null, 2) + '\n');
    console.log('yazıldı:', finalFile, '| paragraf:', Object.values(data).flat().length);
  } else {
    console.log('(dry-run, yazılmadı)');
  }
}

module.exports = { repairBoundaries, loadSourceMap, resolveTarget };
