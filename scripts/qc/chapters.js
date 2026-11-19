// Bölüm haritası yardımcıları: sayfa yerine bölüm bazlı çalışmak için.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function chaptersOf(vol) {
  const p = path.join(ROOT, 'public', 'books', `v${vol}.json`);
  if (!fs.existsSync(p)) return [];
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = (b.chapters || []).slice().sort((x, y) => x.page - y.page);
  const total = Number(b.total) || (list.length ? list[list.length - 1].page : 1);
  return list.map((c, i) => ({
    n: i,
    label: c.label || `Bölüm ${i}`,
    title: c.title || '',
    from: c.page,
    to: i + 1 < list.length ? list[i + 1].page - 1 : total,
  }));
}

// spec: "3" (sıra) | "Bölüm 3" | "Sonsöz" | başlık parçası
function findChapter(vol, spec) {
  const chs = chaptersOf(vol);
  if (!chs.length || spec == null) return null;
  const s = String(spec).trim().toLowerCase();
  return (
    chs.find((c) => `${c.label} ${c.title}`.toLowerCase() === s) ||
    chs.find((c) => c.label.toLowerCase() === s) ||
    chs.find((c) => c.label.toLowerCase() === `bölüm ${s}`) ||
    chs.find((c) => String(c.n) === s) ||
    chs.find((c) => `${c.label} ${c.title}`.toLowerCase().includes(s)) ||
    null
  );
}

function range(vol, spec) {
  const c = findChapter(vol, spec);
  return c ? { from: c.from, to: c.to, chapter: c } : null;
}

module.exports = { chaptersOf, findChapter, range };
