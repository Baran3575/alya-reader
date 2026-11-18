// Basit tokenizasyon: küçük harf, kelime + noktalama ayrımı, tırnak/uzun çizgi korunur
const PUNCT = /([.,!?;:()"'…—–~\-])/;

function tokenize(text, side) {
  let t = (text || '').replace(/\u2019/g, "'").replace(/\u201c|\u201d/g, '"');
  if (side === 'tr') {
    t = t.toLocaleLowerCase('tr');
  } else {
    t = t.toLowerCase();
  }
  const rough = t.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of rough) {
    const parts = w.split(PUNCT).filter((x) => x !== '');
    for (const p of parts) out.push(p);
  }
  return out;
}

// Sadece sözcükler (LM için noktalama atılır)
function words(text, side) {
  return tokenize(text, side).filter((t) => /[\p{L}\p{N}]/u.test(t));
}

module.exports = { tokenize, words };
