// Anubis SHA-256 Proof-of-Work çözücü ve oturum çerezi yöneticisi (GlucoseTL vb. için)
const crypto = require('crypto');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const originCookies = new Map();

function solveAnubisHash(randomData, difficulty) {
  const targetPrefix = '0'.repeat(difficulty);
  const start = Date.now();
  let nonce = 0;
  while (true) {
    const hash = crypto.createHash('sha256').update(randomData + String(nonce)).digest('hex');
    if (hash.startsWith(targetPrefix)) {
      return { hash, nonce, elapsedTime: Math.max(1, Date.now() - start) };
    }
    nonce++;
  }
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().map((c) => c.split(';')[0]).filter(Boolean);
  }
  const raw = headers.get('set-cookie');
  return raw ? [raw.split(';')[0]] : [];
}

function mergeCookieJar(origin, newCookies) {
  const map = originCookies.get(origin) || new Map();
  for (const kv of newCookies) {
    const eq = kv.indexOf('=');
    if (eq > 0) map.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
  }
  originCookies.set(origin, map);
}

function formatCookieHeader(origin) {
  const map = originCookies.get(origin);
  if (!map || !map.size) return '';
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseAnubisChallenge(html) {
  const m = html.match(/<script[^>]*id=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

async function fetchWithAnubis(url, options = {}) {
  const u = new URL(url);
  const origin = u.origin;
  const extraHeaders = options.headers || {};

  const buildHeaders = () => {
    const cookie = formatCookieHeader(origin);
    const h = {
      'User-Agent': DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...extraHeaders,
    };
    if (cookie) h.Cookie = cookie;
    return h;
  };

  let res = await fetch(url, { headers: buildHeaders(), redirect: 'follow' });
  mergeCookieJar(origin, extractSetCookies(res.headers));
  let text = await res.text();

  const challengePayload = parseAnubisChallenge(text);
  if (!challengePayload || !challengePayload.challenge) {
    return { status: res.status, text, solvedPow: false };
  }

  const difficulty = (challengePayload.rules && challengePayload.rules.difficulty) || 4;
  const { id, randomData } = challengePayload.challenge;
  const { hash, nonce, elapsedTime } = solveAnubisHash(randomData, difficulty);

  const passUrl = new URL('/.within.website/x/cmd/anubis/api/pass-challenge', origin);
  passUrl.searchParams.set('id', id);
  passUrl.searchParams.set('response', hash);
  passUrl.searchParams.set('nonce', String(nonce));
  passUrl.searchParams.set('redir', u.pathname + u.search);
  passUrl.searchParams.set('elapsedTime', String(elapsedTime));

  const passHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: url,
  };
  const existingCookie = formatCookieHeader(origin);
  if (existingCookie) passHeaders.Cookie = existingCookie;

  const passRes = await fetch(passUrl.toString(), {
    headers: passHeaders,
    redirect: 'manual',
  });
  mergeCookieJar(origin, extractSetCookies(passRes.headers));

  res = await fetch(url, { headers: buildHeaders(), redirect: 'follow' });
  mergeCookieJar(origin, extractSetCookies(res.headers));
  text = await res.text();

  if (parseAnubisChallenge(text)) {
    throw new Error(`Anubis PoW çözüldükten sonra bile engel aşılamadı: ${url}`);
  }

  return {
    status: res.status,
    text,
    solvedPow: true,
    difficulty,
    nonce,
  };
}

module.exports = {
  solveAnubisHash,
  parseAnubisChallenge,
  fetchWithAnubis,
};
