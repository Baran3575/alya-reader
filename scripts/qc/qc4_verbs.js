// 4. GEÇİŞ — fiil çekimi ve zarf: resmî "-maktadır/-mıştır/-dır" kalıplarını sadeleştir
const { run, harmony } = require('./lib');

const SOFT_T_STEMS = new Set(['et', 'git', 'tat', 'güt']);

function conjugateYor(stem) {
  const lower = stem.toLocaleLowerCase('tr');
  // Ünlüyle biten gövdeler: geniş ünlü (a/e) daralır, dar ünlü (ı/i/u/ü) korunur
  if (/[ae]$/u.test(lower)) {
    const base = stem.slice(0, -1);
    const v = harmony(base || stem);
    return base + v + 'yor';
  }
  if (/[ıiuü]$/u.test(lower)) {
    return stem + 'yor';
  }
  // Ünsüz yumuşaması gereken tek heceli/bileşik fiiller (etmek -> ediyor, gitmek -> gidiyor)
  let s = stem;
  for (const root of SOFT_T_STEMS) {
    if (lower === root || (lower.endsWith(root) && lower !== 'işit' && lower !== 'anlat' && lower !== 'kapat' && lower !== 'uzat')) {
      s = stem.slice(0, -1) + 'd';
      break;
    }
  }
  // Ünsüzle biten gövdelerde yalnızca dar yardımcı ünlü gelir ('y' kaynaştırma ünsüzü gelmez)
  const v = harmony(s);
  return s + v + 'yor';
}

function convertFormal(t) {
  let out = t;

  // Önce açık/özel fiil kuralları (genel -maktadır kuralından önce çalışmalı)
  out = out.replace(/(?<!\p{L})olmuştur(?!\p{L})/gu, 'oldu');
  out = out.replace(/(?<!\p{L})değildir(?!\p{L})/gu, 'değil');
  out = out.replace(/(?<!\p{L})bulunmaktadır(?!\p{L})/gu, 'bulunuyor');
  out = out.replace(/(?<!\p{L})bulunmaktaydı(?!\p{L})/gu, 'bulunuyordu');
  out = out.replace(/(?<!\p{L})gerekmektedir(?!\p{L})/gu, 'gerekiyor');
  out = out.replace(/(?<!\p{L})etmektedir(?!\p{L})/gu, 'ediyor');
  out = out.replace(/(?<!\p{L})gitmektedir(?!\p{L})/gu, 'gidiyor');

  // -maktadır / -mektedir -> -yor (ünlü uyumu ile, y kaynaştırmasız)
  out = out.replace(/(?<!\p{L})([\p{L}]{2,}?)(mak|mek)tadır(?!\p{L})/gu, (m, stem) => conjugateYor(stem));

  // Daha önce bozulmuş -yyor kalıntılarını da onar
  out = out.replace(/(\p{L})yyor/gu, '$1yor');

  out = out.replace(/(?<!\p{L})\d+[- ]?dir(?!\p{L})/gu, (m) => m.replace(/[- ]?dir$/, ''));

  // zarf yığılması: "gerçekten de çok" -> "gerçekten çok"
  out = out.replace(/(?<!\p{L})(gerçekten|kesinlikle|mutlaka)\s+de(?!\p{L})/giu, (m, a) => a);
  return out;
}

if (require.main === module) {
  run(convertFormal, { label: '4) fiil/zarf' });

  // diyalog başında kaçak küçük harf: "kiminle olmak?" -> "Kiminle olmak?"
  run((t) => t.replace(/^([“"])([a-zçğıöşü])/u, (m, q, ch) => q + ch.toLocaleUpperCase('tr')), {
    label: '4b) diyalog baş harfi',
    show: 3,
  });
}

module.exports = { convertFormal, conjugateYor };
