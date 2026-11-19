// Kaynağa sadakat denetimi: sayfa düzeyinde sayı ve özel ad tutarlılığı (Cilt 4 – 12)
const fs = require('fs');
const path = require('path');
const {
  isPendingPage,
  isSkippedCreditPage,
  isUsablePage,
  isTocPage,
  cleanSourceProse,
  resolveVolumeDir,
} = require('./fidelity');

const ROOT = path.join(__dirname, '..', '..');

const ENTITY_NAMES = [
  'Masachika',
  'Alisa',
  'Yuki',
  'Ayano',
  'Maria',
  'Chisaki',
  'Touya',
  'Sayaka',
  'Nonoa',
  'Sarashina',
  'Kuze',
  'Kujou',
  'Suou',
  'Alya',
  'Masha',
];

const NAME_RE = new RegExp(`(?<!\\p{L})(${ENTITY_NAMES.join('|')})(?!\\p{L})`, 'gu');
const nums = (s) => String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
const names = (s) => [...String(s || '').matchAll(NAME_RE)].map((m) => m[1]);

function evaluateEntityParity(src, tr) {
  const rows = [];
  const missingNamePages = [];

  for (const p of src) {
    if (isPendingPage(p) || isSkippedCreditPage(p) || !isUsablePage(p) || isTocPage(p)) continue;
    const en = cleanSourceProse(p.text || '');
    const t = (tr[String(p.page)] || []).join(' ');
    if (!en.trim() || !t.trim()) continue;

    const missNums = nums(en).filter((n) => !t.includes(n));
    const enNames = new Set(names(en));
    const trNames = new Set(names(t));
    const missNames = [...enNames].filter((n) => !trNames.has(n));

    if (missNames.length > 0) {
      missingNamePages.push({
        page: p.page,
        missNames,
        en: en.slice(0, 90),
        tr: t.slice(0, 90),
      });
    }

    if (missNums.length || missNames.length) {
      rows.push({
        page: p.page,
        missNums,
        missNames,
        en: en.slice(0, 90),
        tr: t.slice(0, 90),
      });
    }
  }

  return { rows, missingNamePages };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const volIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vol = volIdx > -1 && args[volIdx + 1] ? args[volIdx + 1] : args.find((a) => !a.startsWith('--')) || '4';
  const dir = resolveVolumeDir(vol);
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'source.json'), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'paragraphs_final.json'), 'utf8'));

  const { rows, missingNamePages } = evaluateEntityParity(src, tr);
  console.log(`Cilt ${vol} — uyuşmazlık olan sayfa: ${rows.length} (eksik özel ad: ${missingNamePages.length})`);
  rows.slice(0, 15).forEach((r) => console.log(` s${r.page} sayı:${JSON.stringify(r.missNums)} isim:${JSON.stringify(r.missNames)}`));
  if (dir === 'data' || args.includes('--write')) {
    fs.writeFileSync(path.join(ROOT, dir, 'faith_en.json'), JSON.stringify(rows, null, 1));
  }
}

module.exports = { ENTITY_NAMES, nums, names, evaluateEntityParity };
