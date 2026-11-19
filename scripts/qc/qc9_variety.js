// 9) tekrar yükünü azalt: ardından / bir şekilde / ancak / gerçekten
const { load, save } = require('./lib');

const data = load();
const st = { ard: 0, sek: 0, ancak: 0, ger: 0 };
let k = 0;

for (const pg of Object.keys(data)) {
  data[pg] = data[pg].map((t) => {
    let out = t;
    // "Ardından" / "ardından": her ikincisini çeşitlendir
    out = out.replace(/(^|[.!?…]\s+|,\s+)Ardından(?!\p{L})/gu, (m, pre) => {
      st.ard++;
      return st.ard % 2 ? pre + (st.ard % 4 === 1 ? 'Sonra' : 'Peşinden') : m;
    });
    out = out.replace(/([a-zçğıöşü]+)\s+ardından(?!\p{L})/gu, (m, w) => {
      st.ard++;
      if (!(st.ard % 2)) return m;
      if (/(?:dan|den|tan|ten)$/iu.test(w)) return w + ' sonra';
      if (/(?:nın|nin|nun|nün|ın|in|un|ün)$/iu.test(w)) return w + ' peşinden';
      return m;
    });
    // "bir şekilde": ikinci ve sonraki kullanımları at (aynı paragrafta)
    let c = 0;
    out = out.replace(/\s*(?<!\p{L})bir şekilde(?!\p{L})(?=\s)/gu, (m) => {
      c++;
      if (c === 1) return m;
      st.sek++;
      return '';
    });
    // cümle içi "ancak" -> "ama"
    out = out.replace(/(\p{L})\s+ancak\s+(?=\p{L})/gu, (m, a) => {
      st.ancak++;
      return a + ' ama ';
    });
    // "gerçekten" yükü: cümlede ikinci geçişi ve fiil öncesi dolguları at
    let g = 0;
    out = out.replace(/(?<!\p{L})gerçekten\s+(?=(olmaz|yok|güzel|çok|mi|mu|mı|mü))/gu, (m) => {
      g++;
      if (g > 1) { st.ger++; return ''; }
      return m;
    });
    out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
    // bağlaç düşünce bozulan cümle başlarını toparla
    out = out.replace(/([.!?…]\s+)([a-zçğıöşü])/gu, (m, a, c2) => {
      k++;
      return a + c2.toLocaleUpperCase('tr');
    });
    return out;
  });
}

save(data);
console.log(`9) ardından ${st.ard} · bir şekilde ${st.sek} · ancak ${st.ancak} · gerçekten ${st.ger} · büyük harf ${k}`);
