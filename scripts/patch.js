// Elle düzeltmeler: patches.json { "sayfa.index": "yeni metin" }
// Kullanım:
//   node scripts/patch.js [--volume <v>]             # yamaları doğrula ve uygula
//   node scripts/patch.js [--volume <v>] --dry-run   # yalnızca regresyon ve şema kontrolü yap (yazma)
const fs = require('fs');
const path = require('path');
const { score } = require('./qc/quality');
const { words: countWords, cleanSourceProse, isUsablePage, isSkippedCreditPage, isTocPage } = require('./qc/fidelity');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;
const URL_TOKEN_RE = /https?:\s*\/\/\S+/gi;
const FAN_TL_SPAM_RE = /(?:glucosetl|discord\s*\.\s*gg|novelupdates|lightnovelreader|Goldenagato|mp4directs|zerobooks)/gi;

function validatePatches(patches, data, options = {}) {
  const errors = [];
  const warnings = [];
  const applied = [];
  let scoreDiffSum = 0;

  if (typeof patches !== 'object' || patches === null || Array.isArray(patches)) {
    return {
      ok: false,
      errors: ['patches.json kök düğümü geçerli bir JSON nesnesi olmalıdır.'],
      applied: [],
      scoreDiffSum: 0,
    };
  }

  const sourceMap = new Map();
  if (Array.isArray(options.source)) {
    for (const p of options.source) sourceMap.set(String(p.page), p);
  }

  const touchedPages = new Map();

  for (const [key, text] of Object.entries(patches)) {
    // 1. Şema kontrolü: key ^\d+\.\d+$ formatında olmalı
    if (!/^\d+\.\d+$/.test(key)) {
      errors.push(`Geçersiz yama anahtarı: "${key}" (beklenen biçim: ^\\d+\\.\\d+$)`);
      continue;
    }

    if (typeof text !== 'string') {
      errors.push(`Yama metni dize olmalıdır: "${key}"`);
      continue;
    }

    if (!text.trim()) {
      errors.push(`Yama metni boş olamaz: "${key}"`);
      continue;
    }

    const [pg, idxStr] = key.split('.');
    const idx = Number(idxStr);

    // 2. Paragraf varlık kontrolü
    if (!data[pg] || data[pg][idx] === undefined) {
      errors.push(`Hedef paragraf mevcut değil: sayfa ${pg}, indeks ${idx} (anahtar: ${key})`);
      continue;
    }

    // 3. Sıfır tolerans format kontrolleri
    if (/["']/.test(text)) {
      errors.push(`Yama metninde düz tırnak/kesme bulundu: "${key}" -> lütfen kıvrık tırnak (“ ” ’) kullanın.`);
    }

    if (TN_RE.test(text)) {
      errors.push(`Yama metninde çevirmen notu bulundu: "${key}"`);
    }

    const spamMatches = text.match(FAN_TL_SPAM_RE);
    if (spamMatches && spamMatches.length > 0) {
      errors.push(`Yama metninde fan-TL spam alan adı bulundu: "${key}" -> ${spamMatches.join(', ')}`);
    }

    const cleanEn = text.replace(URL_TOKEN_RE, '');
    const enMatches = cleanEn.match(EN_RESIDUE_RE);
    if (enMatches && enMatches.length > 0) {
      errors.push(`Yama metninde İngilizce kalıntı kelime bulundu: "${key}" -> ${enMatches.join(', ')}`);
    }

    // 4. Kırpma / bütünlük ve uzunluk-normalize kalite kontrolü
    const orig = data[pg][idx];
    const wOrig = countWords(orig);
    const wNew = countWords(text);
    const minRatio = options.minWordRatio ?? 0.6;

    if ((wOrig >= 6 && wNew / wOrig < minRatio) || (wOrig >= 3 && wNew < Math.ceil(wOrig * 0.5))) {
      errors.push(
        `Kırpılmış yama hatası: "${key}" paragraf kelime sayısını aşırı düşürüyor (${wOrig} -> ${wNew}, oran ${(wNew / Math.max(wOrig, 1)).toFixed(2)})`
      );
      continue;
    }

    const sBefore = score(pg, idx, orig);
    const sAfter = score(pg, idx, text);
    const diff = sAfter.score - sBefore.score;
    scoreDiffSum += diff;

    if (sAfter.score > sBefore.score) {
      errors.push(
        `Regresyon hatası: "${key}" yaması kusur puanını artırıyor: ${sBefore.score} -> ${sAfter.score} (+${diff}) [notlar: ${sAfter.notes.join(', ')}]`
      );
      continue;
    }

    if (sAfter.score > 0 && sAfter.normScore > sBefore.normScore + 1e-6) {
      errors.push(
        `Uzunluk-normalize regresyon hatası: "${key}" yaması kelime başına kusur yoğunluğunu artırıyor: ${sBefore.normScore} -> ${sAfter.normScore}`
      );
      continue;
    }

    if (!touchedPages.has(pg)) touchedPages.set(pg, data[pg].slice());
    touchedPages.get(pg)[idx] = text;

    applied.push({ key, pg, idx, orig, text, before: sBefore.score, after: sAfter.score, diff });
  }

  // 5. Sayfa bazlı EN-TR kelime oranı bütünlük kontrolü (source.json mevcutsa)
  for (const [pg, patchedArr] of touchedPages.entries()) {
    const srcPage = sourceMap.get(pg);
    if (!srcPage || isSkippedCreditPage(srcPage) || !isUsablePage(srcPage) || isTocPage(srcPage)) continue;
    const wEn = countWords(cleanSourceProse(srcPage.text || ''));
    if (wEn < 45) continue;
    const wTrAfter = countWords(patchedArr.join(' '));
    const ratioAfter = wTrAfter / wEn;
    if (ratioAfter < 0.46) {
      errors.push(
        `Kaynak sadakati hatası: sayfa ${pg} yama sonrası EN-TR kelime oranı sınırın altına düşüyor (${(ratioAfter * 100).toFixed(1)}%, EN ${wEn}, TR ${wTrAfter})`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    applied,
    count: Object.keys(patches).length,
    scoreDiffSum,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--dry');
  const volKey = parseVolumeArg(args, '4');
  const volCfg = resolveVolume(volKey);

  if (!volCfg) {
    console.error(`Hata: Bilinmeyen cilt "${volKey}"`);
    process.exit(1);
  }

  const targetFile = volCfg.finalFile;
  const srcFile = volCfg.sourceFile;
  const patchFileName = volCfg.key === '4' ? 'patches.json' : `patches${volCfg.slug}.json`;
  const patchFile = path.join(__dirname, patchFileName);

  if (!fs.existsSync(targetFile)) {
    console.error(`Hata: Hedef çeviri dosyası bulunamadı: ${volCfg.finalRel}`);
    process.exit(1);
  }

  if (!fs.existsSync(patchFile)) {
    if (volCfg.key === '4') {
      console.error(`Hata: Yama dosyası bulunamadı: ${patchFile}`);
      process.exit(1);
    }
    console.log(`✓ Cilt ${volCfg.key}: ${patchFileName} bulunmuyor (uygulanacak el yaması yok).`);
    process.exit(0);
  }

  const fin = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const patches = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
  const source = fs.existsSync(srcFile) ? JSON.parse(fs.readFileSync(srcFile, 'utf8')) : null;

  const result = validatePatches(patches, fin, { dryRun, source });

  if (!result.ok) {
    console.error(`\n✗ Yama doğrulama başarısız oldu (${result.errors.length} hata):`);
    result.errors.forEach((err) => console.error('  - ' + err));
    process.exit(1);
  }

  if (dryRun) {
    console.log(`✓ Önizleme başarılı (Cilt ${volCfg.key}): ${result.count} yama doğrulandı.`);
    console.log(`  Sıfır regresyon, tüm yama anahtarları geçerli. Toplam puan değişimi: ${result.scoreDiffSum}`);
  } else {
    for (const item of result.applied) {
      fin[item.pg][item.idx] = item.text;
    }
    fs.writeFileSync(targetFile, JSON.stringify(fin) + '\n');
    console.log(`✓ Cilt ${volCfg.key}: ${result.applied.length} yama başarıyla uygulandı.`);
  }
}

module.exports = { validatePatches };
