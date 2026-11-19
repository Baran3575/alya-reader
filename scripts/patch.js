// Elle ve sürüm kontrollü düzeltmeler: patches.json ({ "sayfa.index": "metin" }) veya sürüm haritası ({ version, volume, patches })
// Kullanım:
//   node scripts/patch.js [--volume <v>]             # yamaları doğrula ve uygula
//   node scripts/patch.js [--volume <v>] --dry-run   # yalnızca regresyon ve şema kontrolü yap (yazma)
const fs = require('fs');
const path = require('path');
const { score } = require('./qc/quality');
const { resolveVolume, parseVolumeArg } = require('./lib/volumes');
const { hasUnbalancedDelim, hasInvertedCurlyQuotes, loadGlossaryTypos } = require('./qc/verify');
const { DETACHED_QUOTE_SUFFIX_RE } = require('./qc/qc6_typography');

const ROOT = path.join(__dirname, '..');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;
const CORNER_QUOTE_RE = /[『』「」]/;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;

function unwrapPatchMap(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Yama dosyası kök düğümü geçerli bir JSON nesnesi olmalıdır.', map: null };
  }
  if ('version' in input || 'patches' in input) {
    const allowedMeta = new Set(['version', 'volume', 'generatedAt', 'description', 'patches']);
    const unknown = Object.keys(input).filter((k) => !allowedMeta.has(k));
    if (
      unknown.length === 0 &&
      Number.isInteger(input.version) &&
      input.version >= 1 &&
      typeof input.patches === 'object' &&
      input.patches !== null &&
      !Array.isArray(input.patches)
    ) {
      return { ok: true, version: input.version, volume: input.volume, map: input.patches };
    }
    if (unknown.length === 0) {
      return { ok: false, error: 'Sürümlü yama haritası geçerli "version" (>=1) ve "patches" nesnesi içermelidir.', map: null };
    }
  }
  return { ok: true, version: null, volume: null, map: input };
}

function validatePatches(patchesInput, data, options = {}) {
  const errors = [];
  const warnings = [];
  const applied = [];
  let scoreDiffSum = 0;

  const unwrapped = unwrapPatchMap(patchesInput);
  if (!unwrapped.ok) {
    return {
      ok: false,
      errors: [unwrapped.error],
      applied: [],
      scoreDiffSum: 0,
    };
  }
  const patches = unwrapped.map;
  const glossaryTypos = loadGlossaryTypos();

  for (const [key, text] of Object.entries(patches)) {
    // 1. Şema kontrolü: key ^\d+\.\d+$ formatında olmalı
    if (!/^\d+\.\d+$/.test(key)) {
      errors.push(`Geçersiz yama anahtarı: "${key}" (beklenen biçim: ^\\d+\\.\\d+$)`);
      continue;
    }

    if (typeof text !== 'string' || !text.trim()) {
      errors.push(`Yama metni boş olmayan dize olmalıdır: "${key}"`);
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

    if (hasInvertedCurlyQuotes(text)) {
      errors.push(`Yama metninde ters yönlü veya yığılmış kıvrık tırnak bulundu: "${key}"`);
    }

    const openP = (text.match(/\(/g) || []).length;
    const closeP = (text.match(/\)/g) || []).length;
    if (openP !== closeP) {
      errors.push(`Yama metninde dengesiz parantez bulundu (${openP}/${closeP}): "${key}"`);
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

    if (DETACHED_QUOTE_SUFFIX_RE.test(text)) {
      DETACHED_QUOTE_SUFFIX_RE.lastIndex = 0;
      errors.push(`Yama metninde ayrık tırnak eki bulundu: "${key}"`);
    }
    DETACHED_QUOTE_SUFFIX_RE.lastIndex = 0;

    if (/\p{L}yyor/iu.test(text)) {
      errors.push(`Yama metninde bozuk fiil eki (-yyor) bulundu: "${key}"`);
    }

    if (TN_RE.test(text)) {
      TN_RE.lastIndex = 0;
      errors.push(`Yama metninde çevirmen notu bulundu: "${key}"`);
    }
    TN_RE.lastIndex = 0;

    const cleanEn = text.replace(/https?:\s*\/\/[^\n]+/gi, '');
    const enMatches = cleanEn.match(EN_RESIDUE_RE);
    if (enMatches && enMatches.length > 0) {
      errors.push(`Yama metninde İngilizce kalıntı kelime bulundu: "${key}" -> ${enMatches.join(', ')}`);
    }

    for (const g of glossaryTypos) {
      if (g.re.test(text)) {
        g.re.lastIndex = 0;
        errors.push(`Yama metninde sözlük yazım hatası bulundu: "${key}" (${g.from} -> ${g.to})`);
      }
      g.re.lastIndex = 0;
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
    version: unwrapped.version,
    scoreDiffSum,
  };
}

function getPatchFilesForVolume(vol) {
  const volCfg = resolveVolume(vol);
  if (!volCfg) return [];
  const files = [];
  const flatName = volCfg.key === '4' ? 'patches.json' : `patches${volCfg.slug}.json`;
  const flatPath = path.join(__dirname, flatName);
  if (volCfg.key === '4' || fs.existsSync(flatPath)) {
    files.push(flatPath);
  }
  const vFile = path.join(ROOT, volCfg.dataDir, 'patches_v1.json');
  if (fs.existsSync(vFile)) {
    files.push(vFile);
  }
  return files;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--dry');
  const fArg = args.indexOf('--file');
  const volKey = parseVolumeArg(args, '4');
  const volCfg = resolveVolume(volKey);

  if (!volCfg) {
    console.error(`Hata: Bilinmeyen cilt "${volKey}"`);
    process.exit(1);
  }

  const targetFile = volCfg.finalFile;
  const patchFiles = fArg > -1 && args[fArg + 1] ? [path.resolve(args[fArg + 1])] : getPatchFilesForVolume(volCfg.key);

  if (!fs.existsSync(targetFile)) {
    console.error(`Hata: Hedef çeviri dosyası bulunamadı: ${volCfg.finalRel}`);
    process.exit(1);
  }

  if (patchFiles.length === 0) {
    console.log(`✓ Cilt ${volCfg.key}: uygulanacak yama dosyası yok (0 yama).`);
    process.exit(0);
  }

  const fin = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  let totalCount = 0;
  let totalApplied = 0;
  let totalDiff = 0;

  for (const patchFile of patchFiles) {
    if (!fs.existsSync(patchFile)) {
      console.error(`Hata: Yama dosyası bulunamadı: ${patchFile}`);
      process.exit(1);
    }
    const patches = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    const result = validatePatches(patches, fin, { dryRun });

    if (!result.ok) {
      console.error(`\n✗ Yama doğrulama başarısız oldu (${path.relative(ROOT, patchFile)} — ${result.errors.length} hata):`);
      result.errors.forEach((err) => console.error('  - ' + err));
      process.exit(1);
    }

    totalCount += result.count;
    totalDiff += result.scoreDiffSum;
    for (const item of result.applied) {
      fin[item.pg][item.idx] = item.text;
      totalApplied++;
    }
  }

  if (dryRun) {
    console.log(`✓ Önizleme başarılı (Cilt ${volCfg.key}): ${totalCount} yama doğrulandı (${patchFiles.length} dosya).`);
    console.log(`  Sıfır regresyon, tüm yama anahtarları geçerli. Toplam puan değişimi: ${totalDiff}`);
  } else {
    fs.writeFileSync(targetFile, JSON.stringify(fin) + '\n');
    console.log(`✓ Cilt ${volCfg.key}: ${totalApplied} yama başarıyla uygulandı (${volCfg.finalRel}).`);
  }
}

module.exports = { validatePatches, unwrapPatchMap, getPatchFilesForVolume };
