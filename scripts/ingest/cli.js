#!/usr/bin/env node
// Modüler Cilt İçe Aktarma (Ingestion) CLI Aracı
// Kullanım:
//   node scripts/ingest/cli.js --volume <5|6|7|8|9|9.5|10|11|12> [--refresh] [--ocr-only]
const { resolveVolume, parseVolumeArg } = require('../lib/volumes');
const { ingestFlipVolume } = require('./adapters/fliphtml5');
const { ingestGlucose95 } = require('./adapters/glucosetl95');
const { ingestEpub11 } = require('./adapters/epub11');
const { ingestSecreftls12 } = require('./adapters/secreftls12');

const ADAPTER_BY_VOL = {
  '5': ingestFlipVolume,
  '6': ingestFlipVolume,
  '7': ingestFlipVolume,
  '8': ingestFlipVolume,
  '9': ingestFlipVolume,
  '9.5': ingestGlucose95,
  '10': ingestFlipVolume,
  '11': ingestEpub11,
  '12': ingestSecreftls12,
};

async function ingestVolume(volKey, opts = {}) {
  const volCfg = resolveVolume(volKey);
  if (!volCfg) {
    throw new Error(`Geçersiz cilt numarası: "${volKey}"`);
  }
  if (volCfg.key === '4' || volCfg.key === '4.5') {
    console.log(`Cilt ${volCfg.key} kanonik arşiv olarak depoda mevcuttur (salt okunur korunuyor).`);
    return null;
  }
  const adapter = ADAPTER_BY_VOL[volCfg.key];
  if (!adapter) {
    throw new Error(`Cilt ${volCfg.key} için kayıtlı kaynak adaptörü bulunamadı.`);
  }
  console.log(`\n=== Cilt ${volCfg.key} İçe Aktarma Başlatıldı ===`);
  return adapter(volCfg, opts);
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
      console.log('Kullanım: node scripts/ingest/cli.js --volume <5|6|7|8|9|9.5|10|11|12> [--refresh] [--ocr-only]');
      process.exit(0);
    }

    const volKey = parseVolumeArg(args, '');
    if (!volKey) {
      console.error('Hata: --volume <v> parametresi zorunludur (örn. --volume 5 veya --volume 9.5).');
      process.exit(1);
    }

    const opts = {
      refresh: args.includes('--refresh'),
      ocrOnly: args.includes('--ocr-only'),
    };

    try {
      await ingestVolume(volKey, opts);
    } catch (err) {
      console.error(`✗ Cilt ${volKey} içe aktarma hatası:`, err.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  ADAPTER_BY_VOL,
  ingestVolume,
};
