// novzon.net referans metni: bölüm listesi + paragraflar (yalnızca doğruluk kontrolü için)
const fs = require('fs');
const path = require('path');

const BASE = 'https://novzon.net/novel/alya-sometimes-hides-her-feelings-in-russian-cilt-4/';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36';
const ROOT = path.join(__dirname, '..');

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'tr' } });
  if (!r.ok) throw new Error(url + ' -> ' + r.status);
  return r.text();
}

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&([a-z]+);/g, ' ');
}

function paragraphs(html) {
  const m = html.match(/<div[^>]*id="chapter-content"[^>]*>([\s\S]*?)<\/div>\s*<div class="chapter-nav"/);
  const body = m ? m[1] : '';
  const paras = body
    .split(/<\/(?:p|h\d|li|div)>/i)
    .map((chunk) => decode(chunk.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 1);
  return paras;
}

(async () => {
  const idx = await get(BASE);
  const seen = new Map();
  for (const x of idx.matchAll(/href="([^"]*\/chapter\/([^"\/]+)\/?)"/g)) {
    const slug = decodeURIComponent(x[2]);
    if (!seen.has(slug)) seen.set(slug, x[1].startsWith('http') ? x[1] : 'https://novzon.net' + x[1]);
  }
  const order = [...seen.keys()].filter((s) => s !== 'telif-hakki-90');
  const out = [];
  for (const [i, slug] of order.entries()) {
    const html = await get(seen.get(slug));
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const paras = paragraphs(html);
    out.push({ n: i + 1, slug, title: decode(title).replace(/\s*\|\s*NovZon\s*$/, ''), paras });
    process.stdout.write(`${i + 1}/${order.length} ${slug} (${paras.length} paragraf)\n`);
  }
  fs.writeFileSync(path.join(ROOT, 'data/ref_novzon.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı: data/ref_novzon.json');
})();
