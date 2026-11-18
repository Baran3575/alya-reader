// 6) tipografi: düz tırnak -> “ ” , kesme -> ’ , iç alıntı -> ‘ ’
const { load, save } = require('./lib');

const data = load();
let dq = 0;
let sq = 0;

for (const pg of Object.keys(data)) {
  data[pg] = data[pg].map((t) => {
    let out = '';
    let open = false;
    const chars = [...t];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '"') {
        out += open ? '”' : '“';
        open = !open;
        dq++;
        continue;
      }
      if (ch === "'") {
        const prev = chars[i - 1] || '';
        const next = chars[i + 1] || '';
        const letter = /[\p{L}\p{N}]/u;
        if (letter.test(prev) && letter.test(next)) out += '’';
        else if (!prev || /[\s(“«(\[]/.test(prev)) out += '‘';
        else out += '’';
        sq++;
        continue;
      }
      out += ch;
    }
    return out;
  });
}

save(data);
console.log(`6) tipografi: ${dq} çift tırnak, ${sq} kesme düzeltildi`);
