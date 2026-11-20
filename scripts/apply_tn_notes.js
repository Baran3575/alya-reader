// scripts/tn_notes.json içindeki çevirmen notlarını ilgili ciltlerin kalite dosyalarına ekler.
// Idempotent: aynı not ikinci kez eklenmez.
// node scripts/apply_tn_notes.js [--dry]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAP = {
  '4': 'data/quality/v4.json',
  '4.5': 'data/quality/v4.5.json',
  '5': 'data/quality/v5.json',
  '6': 'data/quality/v6.json',
  '7': 'data/quality/v7.json',
};
const dry = process.argv.includes('--dry');

const notes = JSON.parse(fs.readFileSync(path.join(__dirname, 'tn_notes.json'), 'utf8'));

for (const [vol, file] of Object.entries(MAP)) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  const q = JSON.parse(fs.readFileSync(p, 'utf8'));
  let added = 0;
  let skipped = 0;
  for (const [page, list] of Object.entries(notes[vol] || {})) {
    if (!q[page]) {
      console.log(`  ! Cilt ${vol} s.${page}: sayfa kalite dosyasında yok, atlandı`);
      continue;
    }
    for (const note of list) {
      if (q[page].some((t) => t === note)) {
        skipped++;
        continue;
      }
      q[page].push(note);
      added++;
    }
  }
  if (!dry && added > 0) fs.writeFileSync(p, JSON.stringify(q, null, 2) + '\n');
  console.log(`Cilt ${vol}: ${added} not eklendi, ${skipped} zaten vardı${dry ? ' (dry-run)' : ''}`);
}
