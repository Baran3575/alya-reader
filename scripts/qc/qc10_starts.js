// 10) paragraf başlarında aynı öznenin tekrarı + "-di" zinciri tekdüzeliği
const { load, save } = require('./lib');

const data = load();
const st = { subj: 0, chain: 0 };

for (const pg of Object.keys(data)) {
  let lastSubj = null;
  data[pg] = data[pg].map((t) => {
    let out = t;
    const m = out.match(/^(Masachika|Alisa|Yuki|Ayano|Maria)(?!\p{L})/u);
    if (m) {
      if (m[1] === lastSubj) {
        st.subj++;
        out = out.replace(/^(Masachika|Alisa|Yuki|Ayano|Maria)(?!\p{L})/u, 'O');
      }
      lastSubj = m[1];
    } else {
      lastSubj = null;
    }
    return out;
  });
}

save(data);
console.log(`10) tekrarlanan paragraf öznesi ${st.subj}`);
