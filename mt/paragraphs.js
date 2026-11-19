// Kaynak sayfa metnini paragraflara böler (çeviri ile aynı bölme kuralı)
const NOISE_LINE_RE =
  /(Goldenagato|mp4directs|jnovels|zerobooks|Download all your Favorite|Stay up to date On Light Novels|Join our Discord and meet Thousands|Page\s+\d+)/i;

const TN_BLOCK_RE =
  /\(\s*(?:TN|TL\s*Note|Translator['’]?s?\s*Note)\s*:[\s\S]*?(?:\)|$)|\[\s*(?:TN|TL\s*Note|Translator['’]?s?\s*Note)\s*:[\s\S]*?(?:\]|$)/gi;

function stripTranslatorNotes(text) {
  return String(text || '').replace(TN_BLOCK_RE, ' ').replace(/\s+/g, ' ').trim();
}

function paragraphs(text) {
  const lines = (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !NOISE_LINE_RE.test(s));
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (endPunct.test(prev) && (ln.startsWith('"') || (prev.length < 48 && endPunct.test(prev)))) {
        blocks.push(cur.join(' '));
        cur = [];
      }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));
  const out = [];
  for (const b of blocks) {
    const clean = b
      .replace(/Page\s+\d+/gi, '')
      .replace(NOISE_LINE_RE, '')
      .replace(/\s+/g, ' ')
      .trim();
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

function sourceParagraphs(text) {
  return paragraphs(text)
    .map((p) => stripTranslatorNotes(p))
    .filter(Boolean);
}

module.exports = { paragraphs, sourceParagraphs, stripTranslatorNotes, NOISE_LINE_RE, TN_BLOCK_RE };