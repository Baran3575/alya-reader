// 8) uzun cümleleri noktalı virgülden böl, aşırı "ancak/gerçekten" yükünü azalt
const { load, save } = require('./lib');

const data = load();
const st = { split: 0, ancak: 0, ger: 0 };

const cap = (s) => s.replace(/^(["“”'‘’(]*)([a-zçğıöşü])/u, (m, q, c) => q + c.toLocaleUpperCase('tr'));

for (const pg of Object.keys(data)) {
  data[pg] = data[pg].map((t) => {
    let out = t;
    // 24+ kelimelik cümlelerde "; " -> ". " (yan cümleleri ayır)
    out = out.replace(/([^.!?…]{60,});\s+/g, (m, head) => {
      if (head.split(/\s+/).length < 16) return m;
      st.split++;
      return head + '. ';
    });
    // cümle başı "Ancak," çeşitliliği
    out = out.replace(/([.!?…]\s+)Ancak,\s+/g, (m, pre) => {
      st.ancak++;
      return pre + (st.ancak % 2 ? 'Ne var ki ' : 'Ama ');
    });
    // dolgu "gerçekten" (yanında başka pekiştirme varsa) at
    out = out.replace(/\b(çok|epey|fazlasıyla|son derece)\s+gerçekten\s+/g, '$1 ');
    out = out.replace(/\bgerçekten\s+(çok|epey|fazlasıyla)\s+/g, '$1 ');
    if (out.match(/\bgerçekten\b/g)?.length < t.match(/\bgerçekten\b/g)?.length) st.ger++;
    out = out.replace(/([.!?…]\s+)([a-zçğıöşü])/gu, (m, a, c) => a + c.toLocaleUpperCase('tr'));
    return out;
  });
}

save(data);
console.log(`8) bölme ${st.split} · "Ancak" ${st.ancak} · "gerçekten" ${st.ger}`);
