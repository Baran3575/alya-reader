// Cilt 4.5 çeviri giriş noktası — birleştirilmiş bölüm dikişli boru hattını (scripts/translate3.js) kullanır.
// Kullanım: node scripts45/translate.js
const translate3 = require('../scripts/translate3');
const { runTranslate } = translate3;

if (require.main === module) {
  runTranslate({ volume: '4.5' }).catch((err) => {
    console.error('Çeviri durduruldu:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  ...translate3,
  runTranslate: (opts = {}) => runTranslate({ ...opts, volume: '4.5' }),
};
