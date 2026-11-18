// 5. GEÇİŞ — gramer/imla: bitişik yazım hataları, ikiz kelimeler, eksik cümle sonu
const { run } = require('./lib');

const SPELL = [
  [/(?<!\p{L})herşey(?!\p{L})/giu, 'her şey'],
  [/(?<!\p{L})birşey(?!\p{L})/giu, 'bir şey'],
  [/(?<!\p{L})hiçbirşey(?!\p{L})/giu, 'hiçbir şey'],
  [/(?<!\p{L})bir çok(?!\p{L})/giu, 'birçok'],
  [/(?<!\p{L})herkez(?!\p{L})/giu, 'herkes'],
  [/(?<!\p{L})yanlız(?!\p{L})/giu, 'yalnız'],
  [/(?<!\p{L})şu an da(?!\p{L})/giu, 'şu anda'],
  [/(?<!\p{L})bir an önce(?!\p{L})/giu, 'bir an önce'],
  [/(?<!\p{L})halbuki(?!\p{L})/giu, 'halbuki'],
  [/(?<!\p{L})neyse ki(?!\p{L})/giu, 'neyse ki'],
  [/(?<!\p{L})her nekadar(?!\p{L})/giu, 'her ne kadar'],
  [/(?<!\p{L})öncelik le(?!\p{L})/giu, 'öncelikle'],
  [/(?<!\p{L})miş gibi(?!\p{L})/giu, 'miş gibi'],
];

function grammar(t, pg) {
  let out = t;
  for (const [re, to] of SPELL) out = out.replace(re, to);
  // ikiz kelime (Türkçede meşru olanlar hariç)
  const legit = new Set(['uzun', 'azar', 'diken', 'yare', 'peki', 'tık', 'tak', 'pat', 'küt', 'hızlı', 'yavaş', 'tek', 'bir', 'sık', 'bol', 'kendi', 'gizli', 'sessiz', 'usul', 'yavaş', 'şöyle', 'böyle', 'öyle', 'güzel', 'iyi']);
  out = out.replace(/(?<!\p{L})([\p{L}]{2,})\s+\1(?!\p{L})/giu, (m, w) => (legit.has(w.toLocaleLowerCase('tr')) ? m : w));
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
