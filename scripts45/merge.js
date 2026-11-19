// Cilt 4.5 birleştirme giriş noktası — birleştirilmiş scripts/merge.js modülünü kullanır.
const merge = require('../scripts/merge');
const { runMerge } = merge;

if (require.main === module) {
  const args = process.argv.slice(2);
  const pIdx = args.indexOf('--pages');
  const pages = pIdx > -1 && args[pIdx + 1] ? String(args[pIdx + 1]) : null;
  runMerge({ volume: '4.5', pages });
}

module.exports = {
  ...merge,
  runMerge: (opts = {}) => runMerge({ ...opts, volume: '4.5' }),
};
