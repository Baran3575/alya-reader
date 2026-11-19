// Argo/sertlik sadakati: kaynak (EN) küfür/argo yoğunluğu ile çevirideki (TR)
// karşılık yoğunluğunu sayfa bazında karşılaştırır. Çeviri yumuşatılmışsa listeler.
// node scripts/qc/argo.js [--vol 4] [--page N] [--md] [--top 12]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MAP = {
  '4': ['data/source.json', 'data/paragraphs_final.json'],
  '4.5': ['data45/source.json', 'data45/paragraphs_final.json'],
  '5': ['data5/source.json', 'data5/paragraphs_final.json'],
  '6': ['data6/source.json', 'data6/paragraphs_final.json'],
  '7': ['data7/source.json', 'data7/paragraphs_final.json'],
  '8': ['data8/source.json', 'data8/paragraphs_final.json'],
  '9': ['data9/source.json', 'data9/paragraphs_final.json'],
  '9.5': ['data95/source.json', 'data95/paragraphs_final.json'],
  '10': ['data10/source.json', 'data10/paragraphs_final.json'],
  '11': ['data11/source.json', 'data11/paragraphs_final.json'],
  '12': ['data12/source.json', 'data12/paragraphs_final.json'],
};

// Ağır hakaretler: bunlar yumuşatılırsa kapı düşer.
const EN_HARD = [
  'bastard', 'bastards', 'bitch', 'bitches', 'fuck', 'fucking', 'fucked', 'motherfucker',
  'cunt', 'asshole', 'dick', 'dumbass', 'prick', 'slut', 'sluts', 'whore',
  'son of a bitch', 'jackass',
];
// Hafif küfür/argo: rapor edilir, kapıyı düşürmez (crap -> "hay aksi" doğaldır).
const EN_MILD = ['shit', 'shitty', 'bullshit', 'crap', 'piss', 'damn', 'damned', 'hell'];
const EN_STRONG = EN_HARD.concat(EN_MILD);
// Hafif küfür için kabul edilen doğal karşılıklar.
const TR_MILD = ['saçmalık', 'saçma', 'hay aksi', 'tüh', 'zırva', 'palavra', 'berbat', 'boş laf', 'edebiyat'];
const TR_STRONG = [
  'piç', 'orospu', 'sürtük', 'kaltak', 'şıllık', 'fahişe', 'kahpe', 'şerefsiz',
  'sik', 'siktir', 'sikeyim', 'siktiğimin', 'sikindirik', 'sikik', 'amına', 'amk', 'bok', 'boktan', 'boku',
  'göt', 'götveren', 'yavşak', 'pislik', 'dallama', 'gerizekalı', 'embesil', 'aptal', 'salak',
  'hıyar', 'dingil', 'angut', 'manyak', 'sapık', 'azgın', 'rezil', 'alçak', 'aşağılık',
  'lanet', 'kahretsin', 'cehennem', 'sikerim', 'pezevenk', 'kaltağın',
  'lan', 'ulan', 'sıçtık', 'sıçtım', 'zırva', 'palavra', 'hay',
  'kahrolası', 'lanet olası', 'siktiriboktan', 'sahtekâr', 'düpedüz',
  'düzenbaz', 'adi', 'bela',
];
// Yumuşatma işaretleri: argo yerine geçmiş zayıf sözcükler.
const TR_WEAK = [
  'velet', 'yaramaz', 'haylaz', 'afacan', 'yumurcak', 'şımarık', 'edepsiz',
  'terbiyesiz', 'utanmaz', 'arsız', 'densiz', 'küstah', 'serseri', 'çapkın',
  'zampara', 'kaba', 'saygısız', 'ahlaksız', 'kötü adam', 'kötü çocuk',
];

// Yapay ("çeviri kokan") karşılıklar: kapıyı düşürmez, uyarı verir.
const TR_ARTIFICIAL = ['siktiriboktan', 'sikindirik', 'amına koyayım', 'siktiğimin'];

const { range } = require('./chapters.js');

const args = process.argv.slice(2);
const only = args.includes('--vol') ? args[args.indexOf('--vol') + 1] : null;
const pageArg = args.includes('--page') ? Number(args[args.indexOf('--page') + 1]) : null;
const chArg = args.includes('--bolum') ? args[args.indexOf('--bolum') + 1] : args.includes('--chapter') ? args[args.indexOf('--chapter') + 1] : null;
const md = args.includes('--md');
const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 12;

function unwrapEN(t) {
  return String(t || '')
    .replace(/Page\s+\d+\s*Goldenagato[^\n]*/giu, ' ')
    .replace(/Goldenagato\s*\|\s*mp4directs\.\s*com/giu, ' ')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
// Türkçe ek alır: sözcük kökü önek olarak eşleşir (hıyar -> hıyarın).
const count = (text, list, stem = false) => {
  let n = 0;
  const hits = [];
  for (const w of list) {
    const re = stem ? new RegExp(`(?<![\\p{L}])${w}`, 'giu') : new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'giu');
    const m = text.match(re);
    if (m) {
      n += m.length;
      hits.push(`${w}×${m.length}`);
    }
  }
  return { n, hits };
};
const dialogues = (t) => t.match(/“[^”]{1,400}”/gu) || [];

const rows = [];
for (const [vol, [sf, tf]] of Object.entries(MAP)) {
  if (only && vol !== only) continue;
  const srcPath = path.join(ROOT, sf);
  const trPath = path.join(ROOT, tf);
  if (!fs.existsSync(srcPath) || !fs.existsSync(trPath)) continue;
  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const srcArr = Array.isArray(src) ? src : Object.values(src);
  const tr = JSON.parse(fs.readFileSync(trPath, 'utf8'));
  for (let i = 0; i < srcArr.length; i++) {
    const page = i + 1;
    if (pageArg && page !== pageArg) continue;
    if (chArg) {
      const r = range(vol, chArg);
      if (!r || page < r.from || page > r.to) continue;
    }
    const en = unwrapEN(srcArr[i] && srcArr[i].text).replace(/\(TN:[\s\S]*?(?:\)|$)/gu, ' ');
    if (!en) continue;
    const arr = tr[String(page)] || [];
    const trText = arr.filter((t) => !String(t).startsWith('ÇN:')).join('\n');
    const enS = count(en, EN_STRONG);
    if (!enS.n) continue;
    const trS = count(trText, TR_STRONG, true);
    const trW = count(trText, TR_WEAK, true);
    const enH = count(en, EN_HARD);
    const trM = count(trText, TR_MILD, true);
    // Ağır hakaret açığı kapıyı düşürür; hafif küfür açığı yalnızca raporlanır.
    const hardDef = enH.n ? Math.max(0, enH.n - trS.n) : 0;
    const mildDef = Math.max(0, (enS.n - enH.n) - trS.n - trM.n);
    const deficit = hardDef + mildDef;
    if (deficit <= 0) continue;
    rows.push({
      vol,
      page,
      enN: enH.n || enS.n,
      hard: enH.n,
      enHits: (enH.n ? enH.hits : enS.hits).join(' '),
      trN: trS.n,
      trW: trW.hits.join(' '),
      deficit,
      hardDef,
      enDlg: dialogues(en).filter((d) => new RegExp((enH.n ? EN_HARD : EN_STRONG).join('|'), 'iu').test(d)),
      trDlg: dialogues(trText),
    });
  }
}

if (pageArg && rows.length === 0) {
  // tek sayfa modu: eşleşme yoksa da sayfayı dök
  for (const [vol, [sf, tf]] of Object.entries(MAP)) {
    if (only && vol !== only) continue;
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, sf), 'utf8'));
    const srcArr = Array.isArray(src) ? src : Object.values(src);
    const en = unwrapEN(srcArr[pageArg - 1] && srcArr[pageArg - 1].text);
    console.log(`== C${vol} s.${pageArg} ==`);
    console.log('EN argo:', count(en, EN_STRONG).hits.join(' ') || '(yok)');
    dialogues(en).forEach((d) => console.log('  EN| ' + d));
    const tr = JSON.parse(fs.readFileSync(path.join(ROOT, tf), 'utf8'));
    (tr[String(pageArg)] || []).forEach((t, i) => console.log(`  TR${i}| ${t}`));
  }
  process.exit(0);
}

if (pageArg) {
  for (const r of rows) {
    console.log(`== C${r.vol} s.${r.page} · EN argo ${r.enN} (${r.enHits}) · TR sert ${r.trN} ${r.trW ? '· zayıf: ' + r.trW : ''}`);
    r.enDlg.forEach((d) => console.log('  EN| ' + d));
    r.trDlg.forEach((d) => console.log('  TR| ' + d));
  }
  process.exit(0);
}

const total = rows.reduce((a, b) => a + b.deficit, 0);
const hardCount = rows.filter((r) => r.hardDef > 0).length;
const hardRows = rows.filter((r) => r.hardDef > 0);
const artHits = [];
for (const m of TR_ARTIFICIAL) {
  const re = new RegExp(`(?<![\\p{L}])${m}(?![\\p{L}])`, 'giu');
  for (const [vol, pair] of Object.entries(MAP)) {
    const tr = JSON.parse(fs.readFileSync(path.join(ROOT, pair[1]), 'utf8'));
    for (const [pg, arr] of Object.entries(tr)) {
      if (only && vol !== only) continue;
      for (const x of arr) if (re.test(String(x))) artHits.push(`C${vol} s.${pg}: ${m}`);
    }
  }
}
if (artHits.length) console.warn(`! Yapay küfür uyarısı (${artHits.length}): ${artHits.slice(0, 5).join(' · ')}`);
if (args.includes('--check')) {
  if (hardRows.length) {
    console.error(`✗ Argo sadakati: ${hardRows.length} sayfada ağır hakaret yumuşatılmış`);
    for (const r of hardRows.slice(0, 10)) console.error(`   C${r.vol} s.${r.page} EN ${r.enN} -> TR ${r.trN}`);
    process.exit(1);
  }
  console.log('✓ Argo sadakati: yumuşatılmış sayfa yok');
  process.exit(0);
}
console.log(`Ağır hakaret açığı: ${hardCount} sayfa · hafif küfür notu: ${rows.length - hardCount} sayfa · toplam eksiklik: ${total}`);
for (const r of rows.sort((a, b) => b.deficit - a.deficit).slice(0, topN)) {
  console.log(`  C${r.vol} s.${r.page}  EN ${r.enN} (${r.enHits}) -> TR ${r.trN}${r.trW ? ' · zayıf: ' + r.trW : ''}`);
}

if (md) {
  const out = ['# Argo / Sertlik Sadakati', '', `Yumuşatılmış sayfa: **${rows.length}** · eksik sertlik: **${total}**`, ''];
  for (const r of rows.sort((a, b) => a.deficit - b.deficit ? b.deficit - a.deficit : 0)) {
    out.push(`## Cilt ${r.vol} · s.${r.page} (EN ${r.enN} → TR ${r.trN})`, '');
    r.enDlg.forEach((d) => out.push('- EN: ' + d));
    r.trDlg.forEach((d) => out.push('- TR: ' + d));
    out.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'docs/argo-review.md'), out.join('\n'));
  console.log('yazıldı: docs/argo-review.md');
}
