// Üslup tiki temizliği: çeviri kokan tekrarları azaltır (anlamı korur).
// 1) cümle başı "Ve" -> önceki cümleyle birleştirme (anlatım paragraflarında)
// 2) cümle başı "Ama/Fakat" -> "Ancak" (yalnızca anlatım paragraflarında)
// 3) "bu yüzden" / "sadece" / "gerçekten de" tekrarlarını eş anlamlıyla döndürme
// node scripts/fix_tics.js [--dry] [--vol 4]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = {
  '4': ['data/paragraphs_final.json', 'data/quality/v4.json'],
  '4.5': ['data45/paragraphs_final.json', 'data/quality/v4.5.json'],
  '5': ['data5/paragraphs_final.json', 'data/quality/v5.json'],
  '6': ['data6/paragraphs_final.json', 'data/quality/v6.json'],
  '7': ['data7/paragraphs_final.json', 'data/quality/v7.json'],
  '8': ['data8/paragraphs_final.json', 'data/quality/v8.json'],
  '9': ['data9/paragraphs_final.json', 'data/quality/v9.json'],
  '9.5': ['data95/paragraphs_final.json', 'data/quality/v9.5.json'],
  '10': ['data10/paragraphs_final.json', 'data/quality/v10.json'],
  '11': ['data11/paragraphs_final.json', 'data/quality/v11.json'],
  '12': ['data12/paragraphs_final.json', 'data/quality/v12.json'],
};
const ALT_YUZDEN = ['bu nedenle', 'dolayısıyla', 'bu sebeple'];
const ALT_SADECE = ['yalnızca', 'bir tek'];
const ALT_GERCEKTEN = ['hakikaten', 'cidden'];

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const show = args.includes('--show') ? Number(args[args.indexOf('--show') + 1]) : 0;
let shown = 0;

function capFirst(s) {
  return s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);
}

function fixParagraph(t, counters) {
  let out = t;
  const isDialogue = /^\s*[“"]/.test(out);

  // 1) anlatımda "… . Ve " -> "… ve "
  if (!isDialogue) {
    out = out.replace(/([^”"…!?])\.\s+Ve\s+/gu, '$1 ve ');
  }

  // 2) anlatım paragrafı cümle başı "Ama/Fakat" -> "Ancak"
  if (!isDialogue) {
    out = out.replace(/(^|[.!?…]\s+)(Ama|Fakat)\s+/gu, (m, p1, p2) => {
      counters.ama = (counters.ama || 0) + 1;
      return `${p1}Ancak `;
    });
  }

  // 3) tekrar eden dolgu sözcüklerini döndür (paragraf içi)
  out = out.replace(/\bgerçekten de\b/giu, (m) => {
    counters.ger = (counters.ger || 0) + 1;
    return m[0] === 'G' ? 'Gerçekten' : 'gerçekten';
  });

  const rotate = (word, list, key, from) => {
    let n = counters[key] || 0;
    out = out.replace(new RegExp(`\\b${word}\\b`, 'giu'), (m) => {
      n += 1;
      counters[key] = n;
      if (n < from) return m;
      const pick = list[(n - from) % list.length];
      return m[0] === m[0].toLocaleUpperCase('tr') ? capFirst(pick) : pick;
    });
  };
  if (!isDialogue) {
    rotate('bu yüzden', ALT_YUZDEN, 'yuzden', 2);
    rotate('sadece', ALT_SADECE, 'sadece', 3);
  }

  return out;
}

for (const [vol, files] of Object.entries(TARGETS)) {
  if (only && vol !== only) continue;
  const counters = {};
  let changed = 0;
  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const book = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const key of Object.keys(book)) {
      const arr = book[key];
      if (!Array.isArray(arr)) continue;
      book[key] = arr.map((raw) => {
        if (typeof raw !== 'string') return raw;
        const t = fixParagraph(raw, counters);
        if (t !== raw) {
          changed++;
          if (show && shown < show) {
            shown++;
            console.log(`  [${vol}/${key}] ÖNCE: ${raw.slice(0, 120)}\n              SONRA: ${t.slice(0, 120)}`);
          }
        }
        return t;
      });
    }
    if (changed && !dry) fs.writeFileSync(p, JSON.stringify(book, null, 2) + '\n');
  }
  const parts = Object.entries(counters).map(([k, v]) => `${k}×${v}`);
  console.log(`Cilt ${vol}: ${changed} paragraf${parts.length ? ' — ' + parts.join(', ') : ''}`);
}
console.log(`${dry ? '(deneme) ' : ''}bitti`);
