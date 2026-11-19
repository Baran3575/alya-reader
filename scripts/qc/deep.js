// Derin denetim: bölüm bazlı kelime seçimi, gramer, noktalama, ani kalite düşüşü ve sadakat.
// node scripts/qc/deep.js [--vol 4] [--md] [--examples 3]
const fs = require('fs');
const path = require('path');
const { analyze } = require('./fidelity.js');

const ROOT = path.join(__dirname, '..', '..');
const BOOKS = {
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
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const md = args.includes('--md');
const pageArg = args.includes('--page') ? Number(args[args.indexOf('--page') + 1]) : null;
const EX = args.includes('--examples') ? Number(args[args.indexOf('--examples') + 1]) : 2;

const NAMES = [
  'Alya', 'Alisa', 'Masachika', 'Yuki', 'Ayano', 'Maria', 'Sayaka', 'Nonoa',
  'Chisaki', 'Touya', 'Masha', 'Takeshi', 'Kenzaki', 'Suou', 'Kuze', 'Yumi',
  'Elena', 'Hikaru', 'Rir', 'Kyotarou', 'Sarashina', 'Miyamae', 'Kimishima',
];
const NAMERE = new RegExp(`\\b(${NAMES.join('|')})(?![A-Za-zÇĞİÖŞÜçğıöşü])`, 'gu');

// Kural tanımları: [ad, regex, ağırlık, açıklama]
const RULES = [
  ['birleşik yazım', /\b(birşey|birşeyler|herşey|hiçbirşey|yanlız|herkez|birçok|birdaha|farketmez|suçüstü|bir an önce)\b/giu, 3],
  ['"bir çok/her şey" ayrık', /\b(bir çok|hiç bir|bir kaç)\b/giu, 2],
  ['yanlış özel ad yazımı', /\b(Arisa|Alissa|Maşaçika|Masaçika|Çisaki|Şisaki|Toya|Kuze-kun’a|Masachikaya)\b/gu, 3],
  ['özel ad eki kesme yok', new RegExp(`\\b(${NAMES.join('|')})(ya|ye|yı|yi|da|de|dan|den|nın|nin|nun|nün|lar|ler|la|le|sı|si)\\b`, 'gu'), 3],
  ['kesme öncesi boşluk', /\s+['’]/gu, 3],
  ['çift noktalama', /([,;:])\1|(?<!\.)\.\.(?!\.)|[!?]\s*[.,]|,\s*[!?]/gu, 3],
  ['sondaki nokta eksik', null, 0],
  ['tire aralığı tutarsız', /(?<=\S)—(?=\S)|(?<=\s)—|—(?=\s)/gu, 0],
  ['"diye" öncesi virgül yok', /[”"]\s*diye/gu, 3],
  ['tırnak bitişikliği', /[”“]{2}/gu, 3],
  ['üç nokta karışık', /\.\s*…|…\s*\.|\.\.\./gu, 3],
  ['parantez dengesiz', null, 5],
  ['köşeli parantez dengesiz', null, 5],
  ['süslü parantez dengesiz', null, 5],
  ['edilgen "tarafından"', /\btarafından\b/gu, 2],
  ['ağır isimleştirme', /\b\w+(mek|mak)te(dir|ydi)?\b|\bgerçekleştir(ir|di|miş)\b|\bsöz konusu\b/gu, 2],
  ['cümle başı "Ve"', /(?:^|[.!?…]\s+)Ve\s/gu, 3],
  ['cümle başı "Ama/Fakat"', /(?:^|[.!?…]\s+)(Ama|Fakat)\s/gu, 2],
  ['"gerçekten"', /\bgerçekten\b/giu, 2],
  ['"sadece"', /\bsadece\b/giu, 2],
  ['"bir şekilde"', /\bbir şekilde\b/giu, 3],
  ['"yani"', /\byani\b/giu, 1],
  ['"işte"', /\bişte\b/giu, 1],
  ['"kendi"', /\bkendi\b/giu, 1],
  ['"olduğunu" zinciri', /\bolduğunu\b/giu, 1],
  ['"ise"', /\bise\b/giu, 1],
  ['"bu yüzden"', /\bbu yüzden\b/giu, 1],
  ['"ayrıca"', /\bayrıca\b/giu, 2],
  ['aşırı "ve" (cümlede 4+)', /(?:\bve\b[^.!?…]{0,120}){4,}/gu, 3],
  ['"hem…hem…hem"', /\bhem\b[^.!?…]{0,60}\bhem\b[^.!?…]{0,60}\bhem\b/gu, 3],
  ['gereksiz iyelik', /\b(senin|benim|onun)\b/giu, 1],
  ['ardışık aynı kelime', /(?<![A-Za-zÇĞİÖŞÜçğıöşü])(?!hadi hadi|uzun uzun|sessiz sessiz|evet evet|vay vay|peki peki|tek tek|tir tir|yavaş yavaş|azar azar|birer birer|için için|kendi kendine|bacak bacak|göz göz|diş diş|yüz yüz|el ele|diz dize|omuz omuza|sırt sırta)([A-Za-zÇĞİÖŞÜçğıöşü]{5,})\s+\1(?![A-Za-zÇĞİÖŞÜçğıöşü])/giu, 4],
  ['İngilizce kalıntı', /(?<![A-Za-zÇĞİÖŞÜçğıöşü])(the|and|with|that|you|from|about|because|something|really)(?![A-Za-zÇĞİÖŞÜçğıöşü])/gu, 8],
  ['Kiril', /[\u0400-\u04FF]/gu, 8],
  ['Japonca köşe tırnak', /[『』「」]/gu, 5],
  ['düz tırnak', /["']/gu, 4],
  ['çift boşluk', /[^\s] {2,}[^\s]/gu, 4],
  ['noktalama öncesi boşluk', /\s+[,.!?;:]/gu, 4],
];

function words(t) {
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

function sentences(t) {
  return t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

function countBr(s, open, close) {
  let d = 0;
  for (const ch of s) {
    if (ch === open) d++;
    else if (ch === close) d--;
  }
  return d;
}

function pageText(arr) {
  return arr.filter((t) => !String(t).startsWith('ÇN:')).join('\n');
}

// --page: tek sayfa için kural dökümü
if (pageArg) {
  const vol = only || '4';
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, BOOKS[vol]), 'utf8'));
  const arr = book[String(pageArg)] || [];
  const text = pageText(arr);
  console.log(`== Cilt ${vol} s.${pageArg} (${words(text).length} kelime) ==`);
  arr.forEach((t, i) => console.log(`${String(i).padStart(2)}| ${t}`));
  console.log('\n-- kural isabetleri --');
  for (const [name, re, weight] of RULES) {
    if (!re) continue;
    const hits = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (!hits) continue;
    const uniq = [...new Set(hits)];
    console.log(`${name} ×${hits.length} (ağırlık ${weight}) -> ${uniq.slice(0, 8).join(' | ')}`);
  }
  process.exit(0);
}

// --- ana döngü -------------------------------------------------------------
const report = [];
for (const vol of Object.keys(BOOKS)) {
  if (only && vol !== only) continue;
  const bookPath = path.join(ROOT, BOOKS[vol]);
  if (!fs.existsSync(bookPath)) continue;
  const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));

  let chapters = null;
  const chPath = path.join(ROOT, 'public', 'books', `v${vol}.json`);
  if (fs.existsSync(chPath)) chapters = JSON.parse(fs.readFileSync(chPath, 'utf8')).chapters || null;
  if (!chapters || !chapters.length) {
    chapters = [{ title: '(tek bölüm)', page: 1 }];
  }

  const pages = Object.keys(book).map(Number).sort((a, b) => a - b);
  const fid = analyze(vol);
  const fidByPage = new Map((fid ? fid.rows : []).map((r) => [r.page, r]));
  const maxPage = pages[pages.length - 1] || 1;

  const chRows = [];
  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const from = (Number(ch.page) || 1) - 1;
    const to = ci + 1 < chapters.length ? Number(chapters[ci + 1].page) - 1 : maxPage;
    const chPages = pages.filter((p) => p > from && p <= to);
    if (!chPages.length) continue;

    const stats = new Map(); // kural -> {n, ex:[]}
    let totalWords = 0;
    let totalSents = 0;
    const lemmaSet = new Set();
    let dlgLines = 0;
    const pageDefects = new Map(); // sayfa -> ağırlıklı kusur
    const pageDensity = new Map();

    for (const p of chPages) {
      const arr = book[String(p)];
      if (!Array.isArray(arr)) continue;
      const text = pageText(arr);
      const toks = words(text).map((x) => x.toLocaleLowerCase('tr'));
      const w = toks.length;
      totalWords += w;
      for (const t of toks) lemmaSet.add(t);
      if (!w) continue;
      const sents = sentences(text);
      totalSents += sents.length;
      dlgLines += arr.filter((t) => /^\s*[“"]/.test(String(t))).length;

      let pageScore = 0;
      for (const [name, re, weight] of RULES) {
        if (!re) continue;
        const hits = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
        if (!hits) continue;
        const rec = stats.get(name) || { n: 0, ex: [] };
        rec.n += hits.length;
        for (const h of hits) {
          if (rec.ex.length < EX) {
            const i = text.indexOf(h);
            rec.ex.push(text.slice(Math.max(0, i - 45), i + h.length + 45).replace(/\s+/g, ' '));
          }
        }
        stats.set(name, rec);
        pageScore += hits.length * weight;
      }
      // yapısal kurallar
      const issues = [];
      if (countBr(text, '(', ')') !== 0) issues.push(['parantez dengesiz', 5]);
      if (countBr(text, '[', ']') !== 0) issues.push(['köşeli parantez dengesiz', 5]);
      if (countBr(text, '{', '}') !== 0) issues.push(['süslü parantez dengesiz', 5]);
      for (const s of sents) {
        if (words(s).length > 45) issues.push(['uzun cümle', 2]);
      }
      for (const [name, weight] of issues) {
        const rec = stats.get(name) || { n: 0, ex: [] };
        rec.n += 1;
        if (rec.ex.length < EX) rec.ex.push(`${p}. sayfa`);
        stats.set(name, rec);
        pageScore += weight;
      }
      // sayfa bazlı cümle uzunluğu: çeviri kokusu (translationese) göstergesi
      const sLen = sents.length ? w / sents.length : 0;
      if (sLen > 22) pageScore += 3;
      pageDefects.set(p, pageScore);
      pageDensity.set(p, pageScore / (w / 100 || 1));
    }

    // ani düşüş: bölüm içi yoğunluk medyanının 2 katından fazla ve en az 3 kusur
    const densities = [...pageDensity.values()].filter((d) => d > 0).sort((a, b) => a - b);
    const median = densities.length ? densities[Math.floor(densities.length / 2)] : 0;
    const dips = [...pageDefects.entries()]
      .filter(([p, d]) => d >= 3 && pageDensity.get(p) >= Math.max(median * 2, 4))
      .sort((a, b) => pageDefects.get(b[0]) - pageDefects.get(a[0]))
      .slice(0, 8);

    const fidRows = chPages.map((p) => fidByPage.get(p)).filter(Boolean);
    const fidAvg = fidRows.length ? fidRows.reduce((a, r) => a + r.score, 0) / fidRows.length : null;
    const worstFid = fidRows.slice().sort((a, b) => a.score - b.score).slice(0, 3);

    const top = [...stats.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 6)
      .map(([name, r]) => ({ name, n: r.n, ex: r.ex }));

    chRows.push({
      index: ci,
      title: `${ch.label ? ch.label + ' · ' : ''}${String(ch.title || '').replace(/\s+/g, ' ').trim()}`,
      from,
      to,
      pages: chPages.length,
      words: totalWords,
      ttr: totalWords ? (lemmaSet.size / totalWords).toFixed(2) : '0',
      avgSentence: totalSents ? totalWords / totalSents : 0,
      dialogueShare: totalWords ? (dlgLines / chPages.length).toFixed(1) : '0',
      fidAvg,
      worstFid,
      defects: [...stats.values()].reduce((a, r) => a + r.n, 0),
      density: totalWords ? ([...pageDefects.values()].reduce((a, b) => a + b, 0) / (totalWords / 100)).toFixed(1) : '0',
      mainIssue: top[0] ? top[0].name : '—',
      top,
      dips,
    });
  }

  report.push({ vol, chapters: chRows });
}

// --- çıktı -----------------------------------------------------------------
const lines = [];
if (md) lines.push('# Derin Denetim Raporu (bölüm bazlı)', '');

for (const r of report) {
  lines.push(`\n## Cilt ${r.vol}`);
  lines.push('');
  if (md) {
    lines.push('| Böl. | Başlık | Sayfa | Kelime | Cümle ort. | Kusur/100k | Sadakat | Ana sorun |');
    lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const c of r.chapters) {
      lines.push(
        `| ${c.index} | ${c.title.slice(0, 42)} | ${c.pages} | ${c.words} | ${c.avgSentence.toFixed(1)} | ${c.density} | ${
          c.fidAvg === null ? '—' : c.fidAvg.toFixed(0)
        } | ${c.mainIssue} |`
      );
    }
    lines.push('');
  } else {
    for (const c of r.chapters) {
      lines.push(
        `${String(c.index).padStart(2)} ${c.title.slice(0, 40).padEnd(42)} s.${c.from}-${c.to}  ` +
          `kelime ${c.words}  cümle ${c.avgSentence.toFixed(1)}  sadakat ${c.fidAvg === null ? '—' : c.fidAvg.toFixed(0)}  ` +
          `kusur ${c.density}/100k`
      );
    }
  }

  const interesting = r.chapters.filter((c) => c.dips.length || c.top.some((t) => t.ex.length));
  if (md) {
    for (const c of interesting) {
      lines.push(`### Cilt ${r.vol} · ${c.index}. ${c.title} (s.${c.from}–${c.to})`);
      lines.push('');
      if (c.fidAvg !== null) {
        const wf = c.worstFid
          .filter((x) => x.score < 80)
          .map((x) => `s.${x.page} (${x.score}: ${(x.notes || []).join(' ')})`);
        if (wf.length) lines.push(`- **Sadakat**: ort ${c.fidAvg.toFixed(1)}; zayıf: ${wf.join('; ')}`);
      }
      lines.push(
        `- **Kelime/cümle**: ort ${c.avgSentence.toFixed(1)} kelime/cümle · tip/örnek oranı ${c.ttr} · diyalog satırı/sayfa ${c.dialogueShare}`
      );
      for (const t of c.top) {
        lines.push(`- **${t.name}**: ${t.n}`);
        for (const e of t.ex) lines.push(`  - “…${e}…”`);
      }
      if (c.dips.length) {
        const d = c.dips.map(([p, s]) => `s.${p}(${s})`).join(', ');
        lines.push(`- **Ani düşüş**: ${d}`);
      }
      lines.push('');
    }
  }
}

if (md) {
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/deep-review.md'), lines.join('\n'));
  console.log('yazıldı: docs/deep-review.md');
} else {
  console.log(lines.join('\n'));
}
