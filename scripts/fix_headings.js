// Bölüm başlığı ilk paragrafa karışmışsa temizler: başlığı çıkarıp kalan metni yeniden çevirir.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEY = fs.readFileSync(path.join(ROOT, '.deepl-key'), 'utf8').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125 Safari/537.36';

// sayfa -> ingilizce başlık (kaynak metindeki haliyle)
const EN_TITLES = {
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
  const r = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { Authorization: 'DeepL-Auth-Key ' + KEY, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ text: [text], source_lang: 'EN', target_lang: 'TR', preserve_formatting: true }),
  });
  const j = await r.json();
  return j.translations[0].text.replace(/\u2019/g, "'").trim();
}

async function google(text) {
  const body = new URLSearchParams({ q: text });
  const r = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json();
  return (Array.isArray(j[0]) ? j[0][0] : j[0]) || '';
}

function paragraphs(text) {
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = ln.startsWith('"');
      const shortPrev = prev.length < 48 && prevEnds;
      if (prevEnds && (newDialogue || shortPrev)) { blocks.push(cur.join(' ')); cur = []; }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));
  const out = [];
  for (const b of blocks) {
    const clean = b.replace(/Page\s+\d+/gi, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length <= 520) { out.push(clean); continue; }
    const sents = clean.match(/[^.!?]+[.!?]+["”]?|\S[^.!?]*$/g) || [clean];
    let buf = '';
    for (const x of sents) {
      if ((buf + x).length > 480 && buf) { out.push(buf.trim()); buf = ''; }
      buf += x;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

(async () => {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source.json'), 'utf8'));
  const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));

  for (const [pageStr, title] of Object.entries(EN_TITLES)) {
    const page = Number(pageStr);
    const p = src.find((x) => x.page === page);
    if (!p) continue;
    const paras = paragraphs(p.text || '');
    if (!paras.length) continue;
    const firstLine = paras[0];
    let rest = firstLine.replace(/^(Chapter\s+\d+|Prologue|Epilogue)\s*:\s*/i, '');
    const q = rest.search(/["“]/);
    if (q > 0 && q < 140) {
      rest = rest.slice(q);
    } else {
      const i = rest.toLowerCase().indexOf(title.toLowerCase());
      if (i >= 0) rest = rest.slice(i + title.length).trim();
    }
    rest = rest.trim();
    if (process.env.DEBUG) console.log(page, 'REST:', rest.slice(0, 120));
    if (rest.replace(/["“”]/g, '').trim().length < 8) {
      fin[pageStr].shift(); // sadece başlıktan oluşuyorsa paragrafı at
      console.log(page, '— paragraf atıldı');
      continue;
    }
    const [d, g] = await Promise.all([deepl(rest).catch(() => ''), google(rest).catch(() => '')]);
    fin[pageStr][0] = (d || g).trim();
    console.log(page, '→', fin[pageStr][0].slice(0, 90));
    await new Promise((r) => setTimeout(r, 300));
  }
  fs.writeFileSync(path.join(ROOT, 'data/paragraphs_final.json'), JSON.stringify(fin));
  console.log('bitti');
})();
