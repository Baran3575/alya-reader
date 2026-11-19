// Kaynak sayfa metnini paragraflara böler (çeviri ile aynı bölme kuralı)
const NOISE_LINE_RE =
  /(Goldenagato|mp4directs|jnovels|zerobooks|Download all your Favorite|Stay up to date On Light Novels|Join our Discord and meet Thousands|Page\s+\d+)/i;

const TN_BLOCK_RE =
  /\(\s*(?:TN|T\/N|TL\s*Note|Translator['’]?s?\s*Note)\s*:[\s\S]*?(?:\)|$)|\[\s*(?:TN|T\/N|TL\s*Note|Translator['’]?s?\s*Note)\s*:[\s\S]*?(?:\]|$)|(?:^|\n)\s*(?:TN|T\/N|TL\s*Note|Translator['’]?s?\s*Note)\s*:[^\n]*/gi;

function stripTranslatorNotes(text) {
  return String(text || '').replace(TN_BLOCK_RE, ' ').replace(/\s+/g, ' ').trim();
}

// Glucosetl/HTML kaynaklarındaki illüstrasyon üstü OCR çöpü ve bozuk sahne ayraçları ({2 wh ok, wf k vb.)
function isOcrNoise(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(?:\{\d+\s+wh\s+ok|wf\s+k|I\s+y)$/i.test(t)) return true;
  if (t.length < 12) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters / t.length < 0.25 && t.length > 30) return true;
  const junkSymbols = (t.match(/[\\/|<>@=~^_]/g) || []).length;
  if (junkSymbols >= 3) {
    const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
    const short = words.filter((w) => w.replace(/[^\p{L}]/gu, '').length <= 2).length;
    if (words.length >= 6 && short / words.length > 0.5) return true;
  }
  return false;
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

function sourceParagraphs(text, vol = '4') {
  const v = String(vol || '4');
  if (v === '4' || v === '4.5') {
    return paragraphs(text)
      .map((p) => stripTranslatorNotes(p))
      .filter(Boolean);
  }

  const cleanedLines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((ln) => !NOISE_LINE_RE.test(ln))
    .join('\n')
    .trim();
  if (!cleanedLines) return [];

  let rawBlocks;
  if (cleanedLines.includes('\n\n')) {
    rawBlocks = cleanedLines.split(/\n{2,}/);
  } else {
    const lines = cleanedLines
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    rawBlocks = [];
    let cur = [];
    const endPunct = /[.!?"”’…)~}]$/;
    for (const ln of lines) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const prevEnds = endPunct.test(prev);
        const newDialogue = /^["“‘'{—]/.test(ln);
        const shortPrev = prev.length < 52 && prevEnds;
        if (prevEnds && (newDialogue || shortPrev)) {
          rawBlocks.push(cur.join(' '));
          cur = [];
        }
      }
      cur.push(ln);
    }
    if (cur.length) rawBlocks.push(cur.join(' '));
  }

  return rawBlocks
    .map((b) => stripTranslatorNotes(b.replace(/\s+/g, ' ').trim()))
    .filter((s) => s && !/^[,;:.~`´\s-]+$/.test(s) && !isOcrNoise(s));
}

module.exports = { paragraphs, sourceParagraphs, stripTranslatorNotes, isOcrNoise, NOISE_LINE_RE, TN_BLOCK_RE };