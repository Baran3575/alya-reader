// Birleşik konuşma paragraflarını ayırır ve yapışık kesme işaretlerini düzeltir.
// node scripts/fix_dialogue_split.js [--dry]
const fs = require('fs');
const VOLS = {
  '4': 'data/paragraphs_final.json',
  '4.5': 'data45/paragraphs_final.json',
  '5': 'data5/paragraphs_final.json',
  '6': 'data6/paragraphs_final.json',
  '7': 'data7/paragraphs_final.json',
  '8': 'data8/paragraphs_final.json',
  '9': 'data9/paragraphs_final.json',
  '9.5': 'data95/paragraphs_final.json',
  '10': 'data10/paragraphs_final.json',
  '11': 'data11/paragraphs_final.json',
  '12': 'data12/paragraphs_final.json',
};
const dry = process.argv.includes('--dry');

// Kesme işareti yapışmaları: sadece çok emin olduğumuz kalıplar.
const GLUED = /\b(yüzden|Öncelikle|Ayrıca|Tabii|Elbette|Sonuçta|Gerçekten|Aslında|Şimdi|Demek|Ne|Neden|Nerede)’(?=(böyle|şöyle|bu|şu|o|ve|ama|çünkü|eğer|evet|hayır|tamam|işte|sonra|yani|bir|çok|ne|nasıl|neden|sen|ben)\b)/gi;
const GLUED_UP = /\b(neden|yüzden|diye|derken|böylece|sadece)’(?=[A-ZÇĞİÖŞÜ])/g;

function fixApostrophes(t) {
  return t.replace(GLUED, '$1 ’ ').replace(GLUED_UP, '$1 ’ ');
}

function balanced(t) {
  const open = (t.match(/“/g) || []).length;
  const close = (t.match(/”/g) || []).length;
  return open === close;
}

function splitDialogue(t) {
  if (!t.includes('“')) return [t];
  const parts = t.split(/(?<=”)\s+(?=“)/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return [t];
  // parçalar tek tek dengeli değilse dokunma
  if (!parts.every(balanced)) return [t];
  return parts;
}

let totalSplit = 0;
let totalApos = 0;
for (const [vol, file] of Object.entries(VOLS)) {
  if (!fs.existsSync(file)) continue;
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  let split = 0;
  let apos = 0;
  for (const page of Object.keys(book)) {
    const paras = book[page];
    if (!Array.isArray(paras)) continue;
    const out = [];
    for (const p of paras) {
      if (!p) continue;
      let fixed = fixApostrophes(p);
      if (fixed !== p) apos++;
      const parts = splitDialogue(fixed);
      if (parts.length > 1) split++;
      out.push(...parts);
    }
    book[page] = out;
  }
  if (split || apos) {
    totalSplit += split;
    totalApos += apos;
    if (!dry) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n');
    console.log(`Cilt ${vol}: ${split} paragraf ayrıldı, ${apos} kesme düzeltildi ${dry ? '(deneme)' : ''}`);
  }
}
console.log(`Toplam: ${totalSplit} ayırma, ${totalApos} kesme`);
