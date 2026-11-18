// Çeviri kalite denetimi: uzunluk oranı, İngilizce kalıntı, bozuk paragraf, tırnak, isimler
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source.json'), 'utf8'));
const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paragraphs_final.json'), 'utf8'));

function paragraphs(text) {
  const lines = text.split('\n').map((s) => s.trim()).filter((s) => s && !/(Goldenagato|mp4directs|jnovels|zerobooks)/i.test(s));
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

const EN_STOP = /\b(the|and|you|your|was|were|with|that|this|have|has|she|her|his|they|their|from|what|would|could|just|because|about|there|then|when|which|into|been|being|are|not|but|for|him|how|did|does|is|it|of|on|to|as|at|be|by|do|if|in|my|me|we|or|so|an)\b/gi;

let stats = { pages: 0, paras: 0, empty: 0 };
const issues = [];
for (const p of src) {
  const key = String(p.page);
  const en = paragraphs(p.text || '');
  const tr = fin[key] || [];
  if (!en.length && !tr.length) continue;
  stats.pages++;
  stats.paras += tr.length;
  tr.forEach((t, i) => {
    const e = en[i] || '';
    if (!t) { stats.empty++; issues.push({ p: p.page, i, kind: 'boş', t: '' }); return; }
    const ratio = e ? t.length / e.length : 1;
    if (e && (ratio < 0.55 || ratio > 2.0)) issues.push({ p: p.page, i, kind: 'oran ' + ratio.toFixed(2), t: t.slice(0, 90), e: e.slice(0, 90) });
    const left = (t.match(EN_STOP) || []).length;
    if (left >= 4) issues.push({ p: p.page, i, kind: 'ingilizce ' + left, t: t.slice(0, 110) });
    const q = (t.match(/"/g) || []).length;
    if (q % 2 && !/^["]/.test(t) === false && q > 0) issues.push({ p: p.page, i, kind: 'tırnak', t: t.slice(0, 80) });
    if (/[A-Za-z]{3,}\s*[.,;]\s*[A-Za-z]{3,}/.test(t) && /\b\w+\s\w+\s\w+\s\w+/.test(t) === false) issues.push({ p: p.page, i, kind: 'kırık', t: t.slice(0, 90) });
    if (/(\b\w+\b)(\s+\1\b){1,}/.test(t)) issues.push({ p: p.page, i, kind: 'tekrar', t: t.slice(0, 90) });
  });
}

const byKind = {};
for (const x of issues) {
  const k = x.kind.split(' ')[0];
  byKind[k] = (byKind[k] || 0) + 1;
}
console.log('sayfa:', stats.pages, '| paragraf:', stats.paras, '| boş:', stats.empty);
console.log('sorun türleri:', byKind);
fs.writeFileSync(path.join(ROOT, 'data/audit.json'), JSON.stringify(issues, null, 1));

for (const kind of ['oran', 'ingilizce', 'tekrar']) {
  const list = issues.filter((x) => x.kind.startsWith(kind)).slice(0, 6);
  if (!list.length) continue;
  console.log('\n--- ' + kind);
  for (const x of list) console.log(' s' + x.p + '.' + x.i, x.kind, '|', x.t);
}
