// 10) paragraf başlarında özne denetimi ("O" zamir enjeksiyonu kaldırıldı: özel adları korur)
const { load, save } = require('./lib');

function processPageStarts(paragraphs) {
  let repeated = 0;
  let repaired = 0;
  let lastSubj = null;

  const out = paragraphs.map((t) => {
    let s = t;
    // Eski "O’nin" / "O’nın" zamir bozulmalarını Türkçe "Onun" biçimine düzelt
    const before = s;
    s = s.replace(/^O[’'](nin|nın|nun|nün)(?!\p{L})/u, 'Onun');
    if (s !== before) repaired++;

    const m = s.match(/^(Masachika|Alisa|Yuki|Ayano|Maria)(?!\p{L})/u);
    if (m) {
      if (m[1] === lastSubj) repeated++;
      lastSubj = m[1];
    } else {
      lastSubj = null;
    }
    return s;
  });

  return { paragraphs: out, repeated, repaired };
}

if (require.main === module) {
  const data = load();
  let subj = 0;
  let repaired = 0;
  for (const pg of Object.keys(data)) {
    const res = processPageStarts(data[pg]);
    data[pg] = res.paragraphs;
    subj += res.repeated;
    repaired += res.repaired;
  }
  save(data);
  console.log(`10) korunan tekrarlı paragraf öznesi: ${subj}, onarılan zamir eki: ${repaired}`);
}

module.exports = { processPageStarts };
