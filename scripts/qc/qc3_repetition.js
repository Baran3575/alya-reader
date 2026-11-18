// 3. GEÇİŞ — kelime tekrarı: aynı paragrafta sık geçen bağlaç/zarfları çeşitlendir
const { run } = require('./lib');

const SYN = {
  ardından: ['sonra', 'peşinden', 'ardından'],
  'bir şekilde': ['bir biçimde', 'öyle', 'bir şekilde'],
  gerçekten: ['cidden', 'hakikaten', 'gerçekten'],
  sadece: ['yalnızca', 'sadece'],
  hemen: ['derhal', 'hemen'],
  aniden: ['birden', 'aniden'],
  biraz: ['azıcık', 'biraz'],
};

function diversify(t) {
  let out = t;
  for (const [word, alts] of Object.entries(SYN)) {
    const re = new RegExp('\\b' + word.replace(' ', '\\s+') + '\\b', 'gi');
    const count = (out.match(re) || []).length;
    if (count < 3) continue;
    let n = 0;
    out = out.replace(re, (m) => {
      n++;
      if (n < 3) return m; // ilk ikisi kalsın
      const alt = alts[(n + m.length) % alts.length];
      if (alt === word) return m;
      return m[0] === m[0].toLocaleUpperCase('tr') ? alt.charAt(0).toLocaleUpperCase('tr') + alt.slice(1) : alt;
    });
  }
  return out;
}

// art arda gelen paragrafların aynı bağlaçla başlamasını engelle
function varyStarts(arr) {
  const CONN = { 'Ardından': ['Sonra', 'Peşinden'], 'Sonra': ['Ardından', 'Ondan sonra'], 'Ancak': ['Ama', 'Yalnız'], 'Ama': ['Ancak', 'Yine de'] };
  let changed = 0;
  for (let i = 1; i < arr.length; i++) {
    const m = arr[i].match(/^(Ardından|Sonra|Ancak|Ama)\b/);
    if (!m) continue;
    const prev = arr[i - 1];
    if (!new RegExp('^' + m[1] + '\\b').test(prev)) continue;
    const alts = CONN[m[1]];
    if (!alts) continue;
    arr[i] = arr[i].replace(m[1], alts[(i + changed) % alts.length]);
    changed++;
  }
  return changed;
}

const { load, save } = require('./lib');
const data = load();
let n = 0;
for (const arr of Object.values(data)) n += varyStarts(arr);
save(data);
console.log('3b) paragraf başı tekrarı:', n, 'düzeltme');

// "Ardından" fazlalığı: cümle/paragraf başındaki her ikinci kullanımı çeşitlendir
let aK = 0;
function varyArdindan(t) {
  return t.replace(/(^|[.!?…]\s+)Ardından(?=[\s,])/g, (m, pre) => {
    aK++;
    if (aK % 2 === 0) return m;
    const alts = ['Sonra', 'Peşinden', 'Ondan sonra'];
    return pre + alts[aK % alts.length];
  });
}

run(varyArdindan, { label: '3c) "Ardından" çeşitleme', show: 3 });
run(diversify, { label: '3) kelime tekrarı' });
