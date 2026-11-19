// Bölüm başlığı ilk paragrafa karışmışsa temizler: başlığı çıkarıp kalan metni korur/yeniden çevirir.
// Kullanım: node scripts/fix_headings.js [--volume <v>] [--dry]
const fs = require('fs');
const path = require('path');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');
const { polish, loadGlossary } = require('./merge');
const { naturalize } = require('./naturalize');

const KEY_FILE = path.join(ROOT, '.deepl-key');
const KEY = process.env.DEEPL_KEY || (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36';

// Cilt 4 için kaynak metindeki başlık eşlemesi (geriye dönük uyumluluk)
const EN_TITLES_V4 = {
  14: 'The Past I Want to Forget',
  20: "I've Never Heard of a Belly Fetish",
  47: 'Otakus are really annoying',
  72: 'Eh? Really?',
  101: "No, that's not the case",
  121: "That's not Sumo",
  152: 'I want to be a turtle',
  172: "Looks Like It's Floating",
  194: 'Unexpected surprises during delirium?',
  217: "I don't want to be called a tyrant by you",
  239: 'Feelings of Love',
  271: 'A Past That Must Not Be Forgotten',
};

async function deepl(text) {
  if (!KEY) return '';
  const r = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { Authorization: 'DeepL-Auth-Key ' + KEY, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ text: [text], source_lang: 'EN', target_lang: 'TR', preserve_formatting: true }),
  });
  if (!r.ok) return '';
  const j = await r.json();
  return ((j.translations && j.translations[0] && j.translations[0].text) || '').trim();
}

async function google(text) {
  const body = new URLSearchParams({ q: text });
  const r = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) return '';
  const j = await r.json();
  return ((Array.isArray(j[0]) ? j[0][0] : j[0]) || '').trim();
}

function paragraphs(text) {
  const lines = String(text || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = ln.startsWith('"') || ln.startsWith('“');
      const shortPrev = prev.length < 48 && prevEnds;
      if (prevEnds && (newDialogue || shortPrev)) {
        blocks.push(cur.join(' '));
        cur = [];
      }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));
  const out = [];
  for (const b of blocks) {
    const clean = b.replace(/Page\s+\d+/gi, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length <= 520) {
      out.push(clean);
      continue;
    }
    const sents = clean.match(/[^.!?]+[.!?]+["”]?|\S[^.!?]*$/g) || [clean];
    let buf = '';
    for (const x of sents) {
      if ((buf + x).length > 480 && buf) {
        out.push(buf.trim());
        buf = '';
      }
      buf += x;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

const HEADING_RE = /^(?:Chapter\s+\d+|Prologue|Epilogue|Afterword|Interlude|Short\s+Story\s*\d*|Bonus\s+Short\s+Story|New\s+SS\s*\d*|Bölüm\s+\d+|Prolog|Epilog|Sonsöz|Ara\s+Bölüm)\s*(?:[:—–-]\s*|$)/i;

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const volKey = parseVolumeArg(args, '4');
    const volCfg = resolveVolume(volKey);
    if (!volCfg) {
      console.error(`Bilinmeyen cilt: ${volKey}`);
      process.exit(1);
    }

    if (!fs.existsSync(volCfg.sourceFile) || !fs.existsSync(volCfg.finalFile)) {
      console.log(`Cilt ${volCfg.key}: kaynak veya çeviri dosyası henüz mevcut değil, atlanıyor.`);
      process.exit(0);
    }

    const src = JSON.parse(fs.readFileSync(volCfg.sourceFile, 'utf8'));
    const fin = JSON.parse(fs.readFileSync(volCfg.finalFile, 'utf8'));
    const chaptersMeta = fs.existsSync(volCfg.titlesFile)
      ? JSON.parse(fs.readFileSync(volCfg.titlesFile, 'utf8'))
      : {};
    const trTitles = chaptersMeta.titles || {};
    const glossary = loadGlossary();

    const candidatePages = new Map();
    if (volCfg.key === '4') {
      for (const [pg, title] of Object.entries(EN_TITLES_V4)) candidatePages.set(String(pg), title);
    }
    if (Array.isArray(chaptersMeta.chapters)) {
      for (const ch of chaptersMeta.chapters) {
        if (ch && ch.startPage) {
          candidatePages.set(String(ch.startPage), ch.enTitle || ch.title || '');
        }
      }
    }
    for (const p of src) {
      const first = String(p.text || '').trim().split('\n')[0] || '';
      if (HEADING_RE.test(first) && !candidatePages.has(String(p.page))) {
        candidatePages.set(String(p.page), first.replace(HEADING_RE, '').trim());
      }
    }

    let modified = 0;
    for (const [pageStr, enTitle] of candidatePages.entries()) {
      const trArr = fin[pageStr];
      if (!Array.isArray(trArr) || !trArr.length) continue;

      const firstTr = trArr[0];
      const trTitle = trTitles[pageStr] || '';
      // Yalnızca ilk Türkçe paragraf gerçekten gömülü başlık taşıyorsa müdahale et
      const hasTrHeading =
        HEADING_RE.test(firstTr) ||
        (trTitle && firstTr.toLocaleLowerCase('tr').startsWith(trTitle.toLocaleLowerCase('tr')));
      if (!hasTrHeading) continue;

      // Türkçe paragraf sadece başlıktan ibaretse doğrudan sil
      let strippedTr = firstTr.replace(HEADING_RE, '').trim();
      if (trTitle && strippedTr.toLocaleLowerCase('tr').startsWith(trTitle.toLocaleLowerCase('tr'))) {
        strippedTr = strippedTr.slice(trTitle.length).replace(/^[\s:—–-]+/, '').trim();
      }
      if (strippedTr.replace(/[“”"']/g, '').trim().length < 6) {
        trArr.shift();
        modified++;
        console.log(`Sayfa ${pageStr} — salt başlık paragrafı kaldırıldı`);
        continue;
      }

      // Kaynaktan kalan gövdeyi kontrol et; yoksa mevcut Türkçe gövdeyi temizleyip koru
      const p = src.find((x) => String(x.page) === pageStr);
      const paras = p ? paragraphs(p.text || '') : [];
      let updated = polish(naturalize(strippedTr), glossary);

      if (paras.length && KEY) {
        let rest = paras[0].replace(HEADING_RE, '');
        if (enTitle) {
          const idx = rest.toLowerCase().indexOf(enTitle.toLowerCase());
          if (idx >= 0 && idx < 40) rest = rest.slice(idx + enTitle.length).trim();
        }
        if (rest.length >= 8) {
          const [d, g] = await Promise.all([deepl(rest).catch(() => ''), google(rest).catch(() => '')]);
          if (d || g) updated = polish(naturalize(d || g), glossary);
        }
      }

      if (updated && updated !== trArr[0]) {
        trArr[0] = updated;
        modified++;
        console.log(`Sayfa ${pageStr} → ${updated.slice(0, 90)}`);
      }
    }

    if (!dry && modified > 0) {
      fs.writeFileSync(volCfg.finalFile, JSON.stringify(fin));
    }
    console.log(`Cilt ${volCfg.key} | fix_headings tamamlandı (${modified} başlık düzeltildi, DeepL anahtarı: ${KEY ? 'var' : 'yok'}).`);
  })();
}
