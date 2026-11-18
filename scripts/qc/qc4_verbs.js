// 4. GEÇİŞ — fiil çekimi ve zarf: resmî "-maktadır/-mıştır/-dır" kalıplarını sadeleştir
const { run, harmony } = require('./lib');

function convertFormal(t) {
  let out = t;

  // -maktadır / -mektedir  ->  -yor (ünlü uyumu ile)
  out = out.replace(/(?<!\p{L})([\p{L}]{3,}?)(mak|mek)tadır(?!\p{L})/gu, (m, stem, ek) => {
    const v = harmony(stem);
    const buffer = /[aeıioöuü]$/.test(stem) ? '' : 'y';
    return stem + (v === 'a' || v === 'ı' ? 'ı' : v === 'e' || v === 'i' ? 'i' : v === 'o' || v === 'u' ? 'u' : 'ü') + buffer + 'yor';
  });

  // olmuştur -> oldu, değildir -> değil, bulunmaktadır -> bulunuyor
  out = out.replace(/(?<!\p{L})olmuştur(?!\p{L})/gu, 'oldu');
  out = out.replace(/(?<!\p{L})değildir(?!\p{L})/gu, 'değil');
  out = out.replace(/(?<!\p{L})bulunmaktadır(?!\p{L})/gu, 'bulunuyor');
  out = out.replace(/(?<!\p{L})bulunmaktaydı(?!\p{L})/gu, 'bulunuyordu');
  out = out.replace(/(?<!\p{L})gerekmektedir(?!\p{L})/gu, 'gerekiyor');
  out = out.replace(/(?<!\p{L})\d+[- ]?dir(?!\p{L})/gu, (m) => m.replace(/[- ]?dir$/, ''));

  // zarf yığılması: "gerçekten de çok" -> "gerçekten çok"
  out = out.replace(/(?<!\p{L})(gerçekten|kesinlikle|mutlaka)\s+de(?!\p{L})/giu, (m, a) => a);
  return out;
}

run(convertFormal, { label: '4) fiil/zarf' });

// diyalog başında kaçak küçük harf: "kiminle olmak?" -> "Kiminle olmak?"
run((t) => t.replace(/^"([a-zçğıöşü])/u, (m, ch) => '"' + ch.toLocaleUpperCase('tr')), { label: '4b) diyalog baş harfi', show: 3 });
