// 5. GEÇİŞ — gramer/imla: bitişik yazım hataları, ikiz kelimeler, eksik cümle sonu
const { run } = require('./lib');

const SPELL = [
  [/\bherşey\b/gi, 'her şey'],
  [/\bbirşey\b/gi, 'bir şey'],
  [/\bhiçbirşey\b/gi, 'hiçbir şey'],
  [/\bbir çok\b/gi, 'birçok'],
  [/\bherkez\b/gi, 'herkes'],
  [/\byanlız\b/gi, 'yalnız'],
  [/\bşu an da\b/gi, 'şu anda'],
  [/\bbir an önce\b/gi, 'bir an önce'],
  [/\bhalbuki\b/gi, 'halbuki'],
  [/\bneyse ki\b/gi, 'neyse ki'],
  [/\bher nekadar\b/gi, 'her ne kadar'],
  [/\böncelik le\b/gi, 'öncelikle'],
  [/\bmiş gibi\b/gi, 'miş gibi'],
];

function grammar(t, pg) {
  let out = t;
  for (const [re, to] of SPELL) out = out.replace(re, to);
  // ikiz kelime (Türkçede meşru olanlar hariç)
  const legit = new Set(['uzun', 'azar', 'diken', 'yare', 'peki', 'tık', 'tak', 'pat', 'küt', 'hızlı', 'yavaş', 'tek', 'bir', 'sık', 'bol', 'kendi', 'gizli', 'sessiz', 'usul', 'yavaş', 'şöyle', 'böyle', 'öyle', 'güzel', 'iyi']);
  out = out.replace(/\b([\p{L}]{2,})\s+\1\b/giu, (m, w) => (legit.has(w.toLocaleLowerCase('tr')) ? m : w));
  // paragraf sonunda noktalama eksikse ekle (yalnızca tam cümlelerde)
  const trimmed = out.trimEnd();
  const words = trimmed.split(/\s+/).length;
  const skipPage = pg === '13' || pg === '12' || pg === '1' || pg === '2' || pg === '3';
  if (!skipPage && words >= 6 && /[\p{L}\p{N}]$/u.test(trimmed) && !/[.!?…~:"»)\]]$/.test(trimmed)) {
    out = trimmed + '.';
  }
  return out;
}

run(grammar, { label: '5) gramer/imla' });
