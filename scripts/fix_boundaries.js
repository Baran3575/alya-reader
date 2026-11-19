// Sayfa sınırında bölünen parantezleri ve yarım kalan cümleleri başlangıç sayfasına birleştirir.
// Kullanım: node scripts/fix_boundaries.js [--volume <v>] [dosya] [--dry]
const fs = require('fs');
const path = require('path');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');

const opens = (t) => (String(t || '').match(/\(/g) || []).length;
const closes = (t) => (String(t || '').match(/\)/g) || []).length;
const curlyCount = (t) => (String(t || '').match(/[“”"]/g) || []).length;
const TERMINAL_RE = /[.!?"”'\u2019…~)\]»*}◇⋆]$/;

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

function isTocArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && /^İçindekiler\b/i.test(String(arr[0] || '').trim());
}

function splitLeadingSentence(text, opts = {}) {
  let s = String(text || '').trim();
  if (!s) return ['', ''];

  // Sayfa devamında hatalı açılmış tırnak varsa ve önceki paragraf zaten tırnak açtıysa temizle
  if (opts.needCloseQuote && /^[“"]/.test(s) && curlyCount(s) >= 2) {
    s = s.replace(/^[“"]\s*/, '');
  }

  if (opts.needCloseParen) {
    const idx = s.indexOf(')');
    if (idx > -1) {
      let end = idx + 1;
      while (end < s.length && /[.!?…"”'\u2019]/.test(s[end])) end++;
      return [s.slice(0, end).trim(), s.slice(end).trim()];
    }
  }

  if (opts.needCloseQuote) {
    const m = s.match(/^[\s\S]*?[”"]/);
    if (m) {
      return [m[0].trim(), s.slice(m[0].length).trim()];
    }
  }

  const m = s.match(/^([\s\S]*?[.!?…]+(?:[”"'\u2019)\]]+)?)(?:\s+([\s\S]+))?$/);
  if (m) {
    return [m[1].trim(), (m[2] || '').trim()];
  }
  return [s, ''];
}

function capitalizeTurkishStart(text) {
  const s = String(text || '').trim();
  if (!s) return s;
  return s.replace(/^([“"(\[—–\s]*)([a-zçğıöşü])/u, (_, pre, ch) => pre + ch.toLocaleUpperCase('tr'));
}

function fixBoundaries(data) {
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

  // 2) paragraf içi/sayfa içi ve sayfalar arası cümle/parantez/tırnak birleştirme
  const nonEmptyPages = Object.keys(data)
    .filter((k) => /^\d+$/.test(k) && Array.isArray(data[k]) && data[k].length > 0 && !isTocArray(data[k]))
    .map(Number)
    .sort((a, b) => a - b);

  for (let pi = 0; pi < nonEmptyPages.length; pi++) {
    const p = String(nonEmptyPages[pi]);
    const arr = data[p];
    if (!arr || !arr.length) continue;

    for (let i = 0; i < arr.length - 1; i++) {
      if (opens(arr[i]) > closes(arr[i]) && closes(arr[i + 1]) > opens(arr[i + 1])) {
        arr[i] = (arr[i].trim() + ' ' + arr[i + 1].trim()).replace(/\s{2,}/g, ' ');
        report.merged.push(p + ':' + i + ' + ' + (i + 1));
        arr.splice(i + 1, 1);
        i--;
      }
    }

    if (pi + 1 >= nonEmptyPages.length) continue;
    const np = String(nonEmptyPages[pi + 1]);
    const next = data[np];
    if (!next || !next.length) continue;

    const last = arr.length - 1;
    const lastText = arr[last].trim();
    const firstNext = next[0].trim();

    const unbalParen = opens(lastText) > closes(lastText) && closes(firstNext) > opens(firstNext);
    const unbalQuote = curlyCount(lastText) % 2 !== 0 && curlyCount(firstNext) % 2 !== 0;
    const lacksPunct = !TERMINAL_RE.test(lastText);
    const nextStartsLower = /^[a-zçğıöşü,;:\])]/.test(firstNext);

    if (unbalParen || unbalQuote || lacksPunct || nextStartsLower) {
      const [head, tail] = splitLeadingSentence(firstNext, {
        needCloseParen: unbalParen,
        needCloseQuote: unbalQuote || curlyCount(lastText) % 2 !== 0,
      });
      const cleanedLast = nextStartsLower && /[.]\s*$/.test(lastText) ? lastText.replace(/\.\s*$/, '') : lastText;
      const sep = cleanedLast.endsWith('-') ? '' : ' ';
      arr[last] = (cleanedLast + sep + head).replace(/\s{2,}/g, ' ').trim();
      report.merged.push(p + ':' + last + ' ↔ s.' + np);
      if (tail) {
        next[0] = capitalizeTurkishStart(tail);
      } else {
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

  return { data, report };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry') || args.includes('--dry-run');
  const abs = resolveTargetFile(args);
  const rawOrig = fs.readFileSync(abs, 'utf8');
  const indentMatch = rawOrig.match(/^\{\n( +)"/);
  const indent = indentMatch ? indentMatch[1].length : 0;
  const data = JSON.parse(rawOrig);

  const { report } = fixBoundaries(data);

  console.log('birleştirilen:', report.merged.length, '| parantez temizlenen:', report.stripped.length, '| OCR temizlenen:', report.ocr.length);
  report.ocr.forEach((x) => console.log('  ocr  ', x));
  report.merged.slice(0, 20).forEach((x) => console.log('  birleş', x));
  report.stripped.slice(0, 20).forEach((x) => console.log('  temiz ', x));

  if (!dry) {
    const formatted = indent ? JSON.stringify(data, null, indent) + '\n' : JSON.stringify(data);
    fs.writeFileSync(abs, formatted);
    console.log('yazıldı:', abs, '| paragraf:', Object.values(data).flat().length);
  } else {
    console.log('(dry-run, yazılmadı)');
  }
}

module.exports = { fixBoundaries, splitLeadingSentence, capitalizeTurkishStart };
