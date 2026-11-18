// Merge kuralına göre Google'dan seçilen paragrafları listeler (elle kontrol için)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/bilingual.json'), 'utf8'));
const EN_STOP = /\b(the|and|you|your|was|were|with|that|this|have|has|she|her|his|they|their|from|what|would|could|just|because|about|there|then|when|which|into|been|being|are|but|for|him|how|does|did|of|on|to|so|if|we|my|me|or|an)\b/gi;
const score = (t) => (t ? -(t.match(EN_STOP) || []).length / Math.max(t.split(/\s+/).length, 1) : -1);
const ENDS = /[.!?"”…~)\]»]$/;
const endsOk = (t) => ENDS.test((t || '').trim());
function preferGoogle(d, g) {
  if (!g || g.trim().split(' ').length < 3) return false;
  if (/^(Devamı|Yukarıdaki|Aşağıdaki|Çevirisi|Devam)\b/i.test(g.trim())) return false;
  if (g.length < d.length * 0.8) return false;
  if (!endsOk(d) && endsOk(g)) return true;
  const ld = (d.match(EN_STOP) || []).length;
  const lg = (g.match(EN_STOP) || []).length;
  return ld >= 2 && lg === 0;
}
const rows = [];
for (const [p, arr] of Object.entries(b)) {
  arr.forEach((x, i) => {
    const d = x.d || '';
    const g = x.g || '';
    if (!d || !g) return;
    if (preferGoogle(d, g)) rows.push([p, i, g, d]);
  });
}
console.log('Google seçimi:', rows.length);
for (const r of rows) {
  console.log(` s${r[0]}.${r[1]}`);
  console.log('  G:', r[2].replace(/\s+/g, ' ').slice(0, 160));
  console.log('  D:', r[3].replace(/\s+/g, ' ').slice(0, 160));
}
