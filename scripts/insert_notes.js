// Kaynak metindeki çevirmen notlarını (TN -> ÇN) sayfa sonlarına ekler.
// Tek doğruluk kaynağı: scripts/tn_notes.json
// Kullanım: node scripts/insert_notes.js [--dry] [--vol 4]
// Idempotent: aynı not ikinci kez eklenmez.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;

const notes = JSON.parse(fs.readFileSync(path.join(__dirname, 'tn_notes.json'), 'utf8'));

for (const [vol, file] of Object.entries(VOLS)) {
  if (only && vol !== only) continue;
  const map = notes[vol];
  if (!map) continue;
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const book = JSON.parse(fs.readFileSync(p, 'utf8'));
  let added = 0;
  let missing = 0;
  for (const [page, list] of Object.entries(map)) {
    const entry = book[page];
    if (!entry) {
      missing++;
      continue;
    }
    const paras = entry.p || entry.paragraphs || entry;
    if (!Array.isArray(paras)) {
      missing++;
      continue;
    }
    for (const note of list) {
      if (paras.some((t) => String(t).trim() === note)) continue;
      paras.push(note);
      added++;
    }
  }
  if (!dry && added) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  console.log(`Cilt ${vol}: ${added} not eklendi${missing ? `, ${missing} sayfa bulunamadı` : ''}${dry ? ' (dry-run)' : ''}`);
}
