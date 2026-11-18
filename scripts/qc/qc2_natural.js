// 2. GEÇİŞ — doğal ifade: bağlaç tekdüzeliğini kır, makine kalıplarını sadeleştir
const { run } = require('./lib');

const CHOICES = ['Ama', 'Yalnız', 'Ne var ki', 'Ama'];
let k = 0;

function rewrite(t) {
  let out = t;
  // cümle başındaki "Ancak," -> dönüşümlü doğal bağlaç
  out = out.replace(/(^|[.!?…]\s+|\n)Ancak,\s+/g, (m, pre) => {
    const w = CHOICES[k++ % CHOICES.length];
    return pre + w + ' ';
  });
  // "Ancak" (virgülsüz, cümle başı) -> "Ama"
  out = out.replace(/(^|[.!?…]\s+)Ancak\s+(?=[A-ZÇĞİÖŞÜ])/g, (m, pre) => pre + 'Ama ');
  // ayrıca -> üstelik / bir de
  out = out.replace(/(^|[.!?…]\s+)Ayrıca,\s+/g, (m, pre) => pre + (k++ % 2 ? 'Üstelik ' : 'Bir de '));
  // konuşma fiili sadeleşmesi
  out = out.replace(/,\s*diye söyledi\b/g, ', dedi');
  out = out.replace(/,\s*diyerek söyledi\b/g, ', dedi');
  out = out.replace(/,\s*diye ifade etti\b/g, ', dedi');
  out = out.replace(/,\s*diye cevap verdi\b/g, ', diye karşılık verdi');
  // "söz konusu" (isim tamlaması) -> "o"
  out = out.replace(/\bsöz konusu\s+(?=[a-zçğıöşü])/g, 'o ');
  return out;
}

run(rewrite, { label: '2) doğal ifade' });
