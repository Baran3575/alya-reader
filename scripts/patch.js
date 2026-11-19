// Elle düzeltmeler: patches.json { "sayfa.index": "yeni metin" }
// Kullanım:
//   node scripts/patch.js             # yamaları doğrula ve uygula
//   node scripts/patch.js --dry-run   # yalnızca regresyon ve şema kontrolü yap (yazma)
const fs = require('fs');
const path = require('path');
const { score } = require('./qc/quality');
const { hasUnbalancedDelim } = require('./qc/verify');

const ROOT = path.join(__dirname, '..');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;
const CORNER_QUOTE_RE = /[『』「」]/;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

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

    if (hasUnbalancedDelim(text, '{', '}')) {
      errors.push(`Yama metninde dengesiz süslü parantez ({…}) bulundu: "${key}"`);
    }

    if (hasUnbalancedDelim(text, '[', ']')) {
      errors.push(`Yama metninde dengesiz köşeli parantez ([…]) bulundu: "${key}"`);
    }

    if (CORNER_QUOTE_RE.test(text)) {
      errors.push(`Yama metninde Japonca köşe tırnağı (『』「」) bulundu: "${key}"`);
    }

    if (CYRILLIC_RE.test(text)) {
      errors.push(`Yama metninde Kiril karakteri bulundu: "${key}"`);
    }

    if (TN_RE.test(text)) {
      errors.push(`Yama metninde çevirmen notu bulundu: "${key}"`);
    }

    const cleanEn = text.replace(/https?:\s*\/\/[^\n]+/gi, '');
    const enMatches = cleanEn.match(EN_RESIDUE_RE);
    if (enMatches && enMatches.length > 0) {
      errors.push(`Yama metninde İngilizce kalıntı kelime bulundu: "${key}" -> ${enMatches.join(', ')}`);
    }

    // 4. Regresyon kontrolü: puan artmamalı (kalite düşmemeli)
    const orig = data[pg][idx];
    const sBefore = score(pg, idx, orig);
    const sAfter = score(pg, idx, text);
    const diff = sAfter.score - sBefore.score;
    scoreDiffSum += diff;

    if (sAfter.score > sBefore.score) {
      errors.push(
        `Regresyon hatası: "${key}" yaması kusur puanını artırıyor: ${sBefore.score} -> ${sAfter.score} (+${diff}) [notlar: ${sAfter.notes.join(', ')}]`
      );
    } else {
      applied.push({ key, pg, idx, orig, text, before: sBefore.score, after: sAfter.score, diff });
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
  const vArg = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vol = vArg > -1 ? args[vArg + 1] : '4';
  const targetRel = vol === '4.5' ? 'data45/paragraphs_final.json' : 'data/paragraphs_final.json';
  const targetFile = path.join(ROOT, targetRel);
  const patchFile = path.join(__dirname, 'patches.json');

  if (!fs.existsSync(targetFile)) {
    console.error(`Hata: Hedef çeviri dosyası bulunamadı: ${targetRel}`);
    process.exit(1);
  }

  if (!fs.existsSync(patchFile)) {
    console.error(`Hata: Yama dosyası bulunamadı: ${patchFile}`);
    process.exit(1);
  }

  const fin = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const patches = JSON.parse(fs.readFileSync(patchFile, 'utf8'));

  const result = validatePatches(patches, fin, { dryRun });

  if (!result.ok) {
    console.error(`\n✗ Yama doğrulama başarısız oldu (${result.errors.length} hata):`);
    result.errors.forEach((err) => console.error('  - ' + err));
    process.exit(1);
  }

  if (dryRun) {
    console.log(`✓ Önizleme başarılı: ${result.count} yama doğrulandı.`);
    console.log(`  Sıfır regresyon, tüm yama anahtarları geçerli. Toplam puan değişimi: ${result.scoreDiffSum}`);
  } else {
    for (const item of result.applied) {
      fin[item.pg][item.idx] = item.text;
    }
    fs.writeFileSync(targetFile, JSON.stringify(fin) + '\n');
    console.log(`✓ ${result.applied.length} yama başarıyla uygulandı.`);
  }
}

module.exports = { validatePatches };
