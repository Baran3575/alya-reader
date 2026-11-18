// 4. GEÇİŞ — fiil çekimi ve zarf: resmî "-maktadır/-mıştır/-dır" kalıplarını sadeleştir
const { run, harmony } = require('./lib');

function convertFormal(t) {
  let out = t;

  // -maktadır / -mektedir  ->  -yor (ünlü uyumu ile)
  out = out.replace(/\b([\p{L}]{3,}?)(mak|mek)tadır\b/gu, (m, stem, ek) => {
    const v = harmony(stem);
    const buffer = /[aeıioöuü]$/.test(stem) ? '' : 'y';
    return stem + (v === 'a' || v === 'ı' ? 'ı' : v === 'e' || v === 'i' ? 'i' : v === 'o' || v === 'u' ? 'u' : 'ü') + buffer + 'yor';
  });

  // olmuştur -> oldu, değildir -> değil, bulunmaktadır -> bulunuyor
  out = out.replace(/\bolmuştur\b/g, 'oldu');
  out = out.replace(/\bdeğildir\b/g, 'değil');
  out = out.replace(/\bbulunmaktadır\b/g, 'bulunuyor');
  out = out.replace(/\bbulunmaktaydı\b/g, 'bulunuyordu');
  out = out.replace(/\bgerekmektedir\b/g, 'gerekiyor');
  out = out.replace(/\b\d+[- ]?dir\b/g, (m) => m.replace(/[- ]?dir$/, ''));

  // zarf yığılması: "gerçekten de çok" -> "gerçekten çok"
  out = out.replace(/\b(gerçekten|kesinlikle|mutlaka)\s+de\b/gi, (m, a) => a);
  return out;
}

run(convertFormal, { label: '4) fiil/zarf' });

// diyalog başında kaçak küçük harf: "kiminle olmak?" -> "Kiminle olmak?"
run((t) => t.replace(/^"([a-zçğıöşü])/u, (m, ch) => '"' + ch.toLocaleUpperCase('tr')), { label: '4b) diyalog baş harfi', show: 3 });
