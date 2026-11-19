// Elle düzeltmeler: patches.json { "sayfa.index": "yeni metin" }
// Kullanım:
//   node scripts/patch.js                        # mevcut tüm cilt yamalarını doğrula ve uygula
//   node scripts/patch.js --dry-run              # regresyon ve şema önizlemesi (yazma)
//   node scripts/patch.js --volume <cilt> [--dry-run]
const fs = require('fs');
const path = require('path');
const { score } = require('./qc/quality');
const { getVolume, getActiveVolumeList } = require('./volumes');

const DEFAULT_ROOT = path.join(__dirname, '..');

const EN_RESIDUE_RE = /(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/gui;
const TN_RE = /(?<!\p{L})(?:ÇN|TN)\s*:/gu;

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

function runVolumePatch(cfg, { dryRun = false, explicitVolume = false } = {}) {
  const targetFile = cfg.absTrFile;
  const patchFile = cfg.absPatchesFile;

  if (!fs.existsSync(targetFile)) {
    console.error(`Hata: Hedef çeviri dosyası bulunamadı: ${cfg.trFile}`);
    return false;
  }

  if (!fs.existsSync(patchFile)) {
    if (dryRun || !explicitVolume) {
      console.log(`✓ ${cfg.label}: yama dosyası yok (${cfg.patchesFile}), atlandı.`);
      return true;
    }
    console.error(`Hata: Yama dosyası bulunamadı: ${cfg.patchesFile}`);
    return false;
  }

  const fin = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const patches = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
  const result = validatePatches(patches, fin, { dryRun });

  if (!result.ok) {
    console.error(`\n✗ ${cfg.label} (${cfg.patchesFile}) yama doğrulama başarısız oldu (${result.errors.length} hata):`);
    result.errors.forEach((err) => console.error('  - ' + err));
    return false;
  }

  if (dryRun) {
    console.log(`✓ ${cfg.label} önizleme başarılı: ${result.count} yama doğrulandı (${cfg.patchesFile}).`);
    console.log(`  Sıfır regresyon, tüm yama anahtarları geçerli. Toplam puan değişimi: ${result.scoreDiffSum}`);
  } else {
    for (const item of result.applied) {
      fin[item.pg][item.idx] = item.text;
    }
    fs.writeFileSync(targetFile, JSON.stringify(fin) + '\n');
    console.log(`✓ ${cfg.label}: ${result.applied.length} yama başarıyla uygulandı (${cfg.trFile}).`);
  }
  return true;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--dry');
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx > -1 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : DEFAULT_ROOT;
  const vArg = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');

  if (vArg > -1) {
    const vol = args[vArg + 1];
    const cfg = getVolume(vol, rootDir);
    if (!cfg) {
      console.error(`Hata: Bilinmeyen cilt: ${vol}`);
      process.exit(1);
    }
    const ok = runVolumePatch(cfg, { dryRun, explicitVolume: true });
    process.exit(ok ? 0 : 1);
  }

  const targets = getActiveVolumeList(rootDir).filter((v) => fs.existsSync(v.absPatchesFile));
  if (targets.length === 0) {
    console.log('✓ Uygulanacak yama dosyası bulunamadı.');
    process.exit(0);
  }

  let allOk = true;
  for (const cfg of targets) {
    if (!runVolumePatch(cfg, { dryRun, explicitVolume: false })) {
      allOk = false;
    }
  }
  process.exit(allOk ? 0 : 1);
}

module.exports = { validatePatches, runVolumePatch };
