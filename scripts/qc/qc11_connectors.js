// 11) bağlaç tekdüzeliği: cümle başı "Ama" → Ne var ki / Yine de (anlam korunarak)
const { load, save } = require('./lib');

const data = load();
let n = 0;

for (const pg of Object.keys(data)) {
  data[pg] = data[pg].map((t) => {
    // paragraf içi cümle başları (satır başı "Ama" hariç: o diyalog tonu)
    return t.replace(/([.!?…]\s+)Ama\s+/g, (m, pre) => {
      n++;
      if (n % 3 === 1) return pre + 'Ne var ki ';
      if (n % 3 === 2) return pre + 'Yine de ';
      return m;
    });
  });
}

save(data);
console.log(`11) bağlaç çeşitleme: ${n} cümle başı`);
