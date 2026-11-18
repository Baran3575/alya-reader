// 7) akıcılık: uzun cümle, aşırı virgül, derece yığını, sıkışık isim tamlaması
const { load, save } = require('./lib');

const data = load();
const stat = { long: 0, commas: 0, deg: 0, chain: 0 };

const DEG = [
  [/(?<!\p{L})oldukça(?!\p{L})/gu, 'epey'],
  [/(?<!\p{L})son derece(?!\p{L})/gu, 'fazlasıyla'],
  [/(?<!\p{L})gerçekten çok(?!\p{L})/gu, 'çok'],
  [/(?<!\p{L})gerçekten de(?!\p{L})/gu, 'gerçekten'],
  [/(?<!\p{L})bir hayli(?!\p{L})/gu, 'epey'],
];

for (const pg of Object.keys(data)) {
  data[pg] = data[pg].map((t) => {
    let out = t;
    // derece zarfı çeşitliliği
    for (const [re, to] of DEG) {
      const before = out;
      out = out.replace(re, to);
      if (out !== before) stat.deg++;
    }
    // 2+ virgüllü yan cümleyi noktaya çevir: ", ve " -> ". "
    const b2 = out;
    out = out.replace(/,\s+ve\s+(?=[a-zçğıöşü])/gu, '. ');
    // "…-diği için," zincirlerinde ikinci "için"i temizle
    out = out.replace(/(\p{L})diği için,\s+(?=\p{L})/gu, '$1diği için ');
    if (out !== b2) stat.commas++;
    // büyük harfe çevir (cümle başı olduysa)
    out = out.replace(/([.!?…]\s+)([a-zçğıöşü])/gu, (m, a, c) => a + c.toLocaleUpperCase('tr'));
    return out;
  });
}

save(data);
console.log(`7) akıcılık: derece zarfı ${stat.deg}, ", ve" bölmesi ${stat.commas}`);
