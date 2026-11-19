// Cilt bazlı edebî Türkçe iyileştirme, makine çevirisi kalıbı temizliği ve QC sıfır-tolerans koruyucusu.
// Kullanım:
//   node scripts/polish_volume.js --volume <4|4.5|5|...|12> [--dry]
//   node scripts/polish_volume.js --all [--dry]
const fs = require('fs');
const path = require('path');
const { ROOT, VOLUME_KEYS, resolveVolume } = require('./lib/volumes');
const { loadGlossary } = require('./merge');
const { hasUnbalancedDelim } = require('./qc/verify');
const { score, evaluateData } = require('./qc/quality');

const SPELLING_FIXES = [
  [/(?<!\p{L})herşey/giu, (m) => (m[0] === 'H' ? 'Her şey' : 'her şey')],
  [/(?<!\p{L})birşey/giu, (m) => (m[0] === 'B' ? 'Bir şey' : 'bir şey')],
  [/(?<!\p{L})herkez/giu, (m) => (m[0] === 'H' ? 'Herkes' : 'herkes')],
  [/(?<!\p{L})yanlız/giu, (m) => (m[0] === 'Y' ? 'Yalnız' : 'yalnız')],
  [/(?<!\p{L})bir çok(?!\p{L})/giu, (m) => (m[0] === 'B' ? 'Birçok' : 'birçok')],
  [/(?<!\p{L})hiç bir(?!\p{L})/giu, (m) => (m[0] === 'H' ? 'Hiçbir' : 'hiçbir')],
  [/(?<!\p{L})her hangi(?!\p{L})/giu, (m) => (m[0] === 'H' ? 'Herhangi' : 'herhangi')],
];

function matchCase(source, replacement) {
  if (!source || !replacement) return replacement;
  const first = source.charAt(0);
  if (first !== first.toLocaleLowerCase('tr')) {
    return replacement.charAt(0).toLocaleUpperCase('tr') + replacement.slice(1);
  }
  return replacement;
}

const LITERARY_RULES = [
  [/(?<!\p{L})çok hızlı bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'hızla')],
  [/(?<!\p{L})hızlı bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'hızlıca')],
  [/(?<!\p{L})yavaş bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'yavaşça')],
  [/(?<!\p{L})sessiz bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'sessizce')],
  [/(?<!\p{L})nazik bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'nazikçe')],
  [/(?<!\p{L})sakin bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'sakince')],
  [/(?<!\p{L})kolay bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kolayca')],
  [/(?<!\p{L})kesin bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kesinlikle')],
  [/(?<!\p{L})dikkatli bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'dikkatlice')],
  [/(?<!\p{L})ciddi bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'ciddiyetle')],
  [/(?<!\p{L})açık bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'açıkça')],
  [/(?<!\p{L})net bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'netçe')],
  [/(?<!\p{L})doğal bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'doğallıkla')],
  [/(?<!\p{L})düzenli bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'düzenlice')],
  [/(?<!\p{L})istekli bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'istekle')],
  [/(?<!\p{L})endişeli bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'endişeyle')],
  [/(?<!\p{L})öfkeli bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'öfkeyle')],
  [/(?<!\p{L})neşeli bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'neşeyle')],
  [/(?<!\p{L})üzgün bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'üzüntüyle')],
  [/(?<!\p{L})şaşkın bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'şaşkınlıkla')],
  [/(?<!\p{L})utangaç bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'utangaçça')],
  [/(?<!\p{L})beceriksiz bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'beceriksizce')],
  [/(?<!\p{L})umutsuz bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'umutsuzca')],
  [/(?<!\p{L})sabırsız bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'sabırsızca')],
  [/(?<!\p{L})gergin bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'gergince')],
  [/(?<!\p{L})yorgun bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'yorgunca')],
  [/(?<!\p{L})içten bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'içtenlikle')],
  [/(?<!\p{L})tuhaf bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'tuhaf biçimde')],
  [/(?<!\p{L})garip bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'tuhaf biçimde')],
  [/(?<!\p{L})normal bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'normalce')],
  [/(?<!\p{L})sert bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'sertçe')],
  [/(?<!\p{L})kısa bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kısaca')],
  [/(?<!\p{L})yumuşak bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'yumuşakça')],
  [/(?<!\p{L})kaba bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kabaca')],
  [/(?<!\p{L})zarif bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'zarifçe')],
  [/(?<!\p{L})iyi bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'iyice')],
  [/(?<!\p{L})kötü bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kötü biçimde')],
  [/(?<!\p{L})uygun bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'uygun biçimde')],
  [/(?<!\p{L})herhangi bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'hiçbir biçimde')],
  [/(?<!\p{L})hiçbir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'hiçbir biçimde')],
  [/(?<!\p{L})alaycı bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'alaycı bir tavırla')],
  [/(?<!\p{L})şakacı bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'şakacı bir tavırla')],
  [/(?<!\p{L})düzgün bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'düzgünce')],
  [/(?<!\p{L})(?:mükemmel|kusursuz) bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kusursuzca')],
  [/(?<!\p{L})gelişigüzel bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kayıtsızca')],
  [/(?<!\p{L})muzip bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'muzipçe')],
  [/(?<!\p{L})sıkı bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'sıkıca')],
  [/(?<!\p{L})çekingen bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'çekingence')],
  [/(?<!\p{L})derin bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'derinden')],
  [/(?<!\p{L})rahat bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'rahatça')],
  [/(?<!\p{L})dalgın bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'dalgınca')],
  [/(?<!\p{L})masum bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'masumca')],
  [/(?<!\p{L})sıcak bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'sıcakça')],
  [/(?<!\p{L})soğuk bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'soğukça')],
  [/(?<!\p{L})tatlı bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'tatlılıkla')],
  [/(?<!\p{L})bariz bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'açıkça')],
  [/(?<!\p{L})kendinden emin bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'kendinden emin bir tavırla')],
  [/(?<!\p{L})emin bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'emin bir tavırla')],
  [/(?<!\p{L})([A-Za-zÇĞİÖŞÜçğıöşü]+(?:lı|li|lu|lü|sız|siz|suz|süz|sal|sel|ik|ük|uk|ak|ek|gın|gin|gun|gün|kın|kin|kun|kün)) bir şekilde(?!\p{L})/gu, '$1 biçimde'],
  [
    /(?<!\p{L})(?!(?:ama|fakat|ancak|ve|veya|ya|da|de|ki|sonra|önce|artık|hâlâ|hala|zaten|yine|bile|sadece|yalnızca|bunu|şunu|onu|bu|şu|o|ben|sen|biz|siz|onlar|hepsi|herkes|kimse)(?!\p{L}))([a-zçğıöşü]{3,}) bir şekilde(?!\p{L})/gu,
    '$1 biçimde',
  ],
  [
    /(?<!\p{L})bir şekilde ([^.!?“”{}]{2,45}?(?:lazım|gerek\p{L}*|zorunda\p{L}*|başar\p{L}*|kurtul\p{L}*|kaç\p{L}*))(?!\p{L})/giu,
    (m, rest) => matchCase(m, `bir yolunu bulup ${rest}`),
  ],
  [/(?<!\p{L})bir şekilde(?!\p{L})/giu, (m) => matchCase(m, 'her nasılsa')],
  [/(?<!\p{L})bir nevi(?!\p{L})/giu, (m) => matchCase(m, 'bir tür')],
  [/(?<!\p{L})söz konusu olduğunda(?!\p{L})/giu, (m) => matchCase(m, 'konu bu olunca')],
  [/(?<!\p{L})söz konusu olan(?!\p{L})/giu, (m) => matchCase(m, 'bahsedilen')],
  [/(?<!\p{L})söz konusu değildi(?!\p{L})/giu, (m) => matchCase(m, 'düşünülemezdi')],
  [/(?<!\p{L})söz konusu değil(?!\p{L})/giu, (m) => matchCase(m, 'mümkün değil')],
  [/(?<!\p{L})söz konusuydu(?!\p{L})/giu, (m) => matchCase(m, 'ortadaydı')],
  [/(?<!\p{L})söz konusuysa(?!\p{L})/giu, (m) => matchCase(m, 'gündemdeyse')],
  [/(?<!\p{L})söz konusu(?!\p{L})/giu, (m) => matchCase(m, 'bahsedilen')],
  [/(?<!\p{L})olmasına rağmen(?!\p{L})/giu, 'olsa da'],
  [/(?<!\p{L})açısından(?!\p{L})/giu, 'bakımından'],
  [/(?<!\p{L})konusundaki(?!\p{L})/giu, 'hakkındaki'],
  [/(?<!\p{L})konusunda(?!\p{L})/giu, 'hakkında'],
  [/(?<!\p{L})yönelik(?!\p{L})/giu, 'dair'],
  [/(?<!\p{L})(?:adeta|âdeta)(?!\p{L})/giu, (m) => matchCase(m, 'resmen')],
  [/(?<!\p{L})farkında olmadan(?!\p{L})/giu, (m) => matchCase(m, 'elinde olmadan')],
  [/(?<!\p{L})fark etmeden(?!\p{L})/giu, (m) => matchCase(m, 'istemeden')],
  [
    /(?<!\p{L})sanki\s+((?:[^.!?“”{}]|“[^”]{0,160}”){2,130}?(?:\bgibi(?:ydi|ydim|ydin|ydiler|sin|yim|yiz)?\b|\p{L}+(?:casına|cesine|çasına|çesine)\b))/giu,
    (m, rest) => matchCase(m, rest),
  ],
  [/(?<!\p{L})Sanki ([^.!?“”{}]{3,60})\./gu, 'Görünüşe bakılırsa $1.'],
  [/(?<!\p{L})loş bir ışık görünüyordu(?!\p{L})/giu, (m) => matchCase(m, 'loş bir ışık süzülüyordu')],
  [/(?<!\p{L})net biçimde görünüyordu(?!\p{L})/giu, (m) => matchCase(m, 'net biçimde seçiliyordu')],
  [/(?<!\p{L})Gözlerinde sadece ([^.!?]{2,40}?) görünüyordu(?!\p{L})/gu, 'Görüş alanında sadece $1 vardı'],
  [/(?<!\p{L})yürek burkan ve geçici görünüyordu(?!\p{L})/giu, 'yürek burkan ve geçici geliyordu'],
  [/(?<!\p{L})gibi görünüyordu(?!\p{L})/giu, 'gibi duruyordu'],
  [/(?<!\p{L})görünüyordu(?!\p{L})/gu, 'duruyordu'],
  [/“([^”]{1,140})”\s+(?:der|diyor)\s+gibiydi(?!\p{L})/gu, '“$1” der gibi duruyordu'],
  [/(\p{L}+yor)\s+gibiydiler(?!\p{L})/gu, '$1 gibi duruyorlardı'],
  [/(\p{L}+yor)\s+gibiydi(?!\p{L})/gu, '$1 gibi duruyordu'],
  [/(\p{L}+(?:mış|miş|muş|müş))\s+gibiydi(?!\p{L})/gu, '$1 gibi duruyordu'],
  [/([a-zçğıöşü])ılmaktadır(?!\p{L})/gu, '$1ılıyor'],
  [/([a-zçğıöşü])ilmektedir(?!\p{L})/gu, '$1iliyor'],
  [/([a-zçğıöşü])ulmaktadır(?!\p{L})/gu, '$1uluyor'],
  [/([a-zçğıöşü])ülmektedir(?!\p{L})/gu, '$1ülüyor'],
  [/([a-zçğıöşü])ılmıştır(?!\p{L})/gu, '$1ıldı'],
  [/([a-zçğıöşü])ilmiştir(?!\p{L})/gu, '$1ildi'],
  [/([a-zçğıöşü])ulmuştur(?!\p{L})/gu, '$1uldu'],
  [/([a-zçğıöşü])ülmüştür(?!\p{L})/gu, '$1üldü'],
  [/(?<!\p{L})gerçekleştirdi(?!\p{L})/giu, (m) => matchCase(m, 'yaptı')],
  [/(?<!\p{L})gerçekleşti(?!\p{L})/giu, (m) => matchCase(m, 'oldu')],
  [/(?<!\p{L})ifade etti(?!\p{L})/giu, (m) => matchCase(m, 'söyledi')],
  [/(?<!\p{L})diye söyledi(?!\p{L})/giu, 'dedi'],
  [/(?<!\p{L})Prez[’']in(?!\p{L})/gu, 'Başkan’ın'],
  [/(?<!\p{L})Prez[’']i(?!\p{L})/gu, 'Başkan’ı'],
  [/(?<!\p{L})Prez[’']e(?!\p{L})/gu, 'Başkan’a'],
  [/(?<!\p{L})Prez[’']den(?!\p{L})/gu, 'Başkan’dan'],
  [/(?<!\p{L})Prez[’']de(?!\p{L})/gu, 'Başkan’da'],
  [/(?<!\p{L})Prez[’']le(?!\p{L})/gu, 'Başkan’la'],
  [/(?<!\p{L})Prez(?!\p{L})/gu, 'Başkan'],
  [/senpai’in(?!\p{L})/giu, 'senpai’nin'],
  [/senpai’i(?!\p{L})/giu, 'senpai’yi'],
  [/senpai’e(?!\p{L})/giu, 'senpai’ye'],
  [/chan’in(?!\p{L})/giu, 'chan’ın'],
  [/chan’i(?!\p{L})/giu, 'chan’ı'],
  [/chan’e(?!\p{L})/giu, 'chan’a'],
  [/chan’den(?!\p{L})/giu, 'chan’dan'],
  [/chan’de(?!\p{L})/giu, 'chan’da'],
  [/chan’le(?!\p{L})/giu, 'chan’la'],
  [/kun’in(?!\p{L})/giu, 'kun’un'],
  [/kun’i(?!\p{L})/giu, 'kun’u'],
  [/kun’e(?!\p{L})/giu, 'kun’a'],
  [/kun’den(?!\p{L})/giu, 'kun’dan'],
  [/kun’de(?!\p{L})/giu, 'kun’da'],
  [/kun’le(?!\p{L})/giu, 'kun’la'],
  [/sama’in(?!\p{L})/giu, 'sama’nın'],
  [/sama’i(?!\p{L})/giu, 'sama’yı'],
  [/sama’e(?!\p{L})/giu, 'sama’ya'],
  [/hime’(?:ın|in)(?!\p{L})/giu, 'hime’nin'],
  [/hime’(?:ı|i)(?!\p{L})/giu, 'hime’yi'],
  [/hime’(?:e|a)(?!\p{L})/giu, 'hime’ye'],
  [/(Sumire|Ayame|Kanae)’(?:ın|in)(?!\p{L})/gu, '$1’nin'],
  [/(Sumire|Ayame|Kanae)’(?:ı|i)(?!\p{L})/gu, '$1’yi'],
  [/(Sumire|Ayame|Kanae)’(?:e|a)(?!\p{L})/gu, '$1’ye'],
  [/(?<!\p{L})bir hoge’um(?!\p{L})/gu, 'bir ahoge’m'],
];

function splitOverlongSentences(text) {
  const sents = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let modified = false;
  const outSents = [];

  for (const s of sents) {
    const wc = s.split(/\s+/).filter(Boolean).length;
    if (wc <= 32) {
      outSents.push(s);
      continue;
    }
    const splitRe =
      /,\s+(ama|fakat|ancak|çünkü|bu yüzden|bu nedenle|böylece|bu arada|üstelik|hatta|ayrıca|oysa|bunun üzerine|ne var ki|öte yandan|sonra da|ardından|daha sonra|hem de|yine de|dolayısıyla|nitekim|neyse ki|ve)\s+/iu;
    const m = splitRe.exec(s);
    if (m && m.index > 35) {
      const left = s.slice(0, m.index).trim();
      const rawConj = m[1].toLocaleLowerCase('tr');
      const restSlice = s.slice(m.index + m[0].length).trim();
      const right =
        rawConj === 've'
          ? restSlice.charAt(0).toLocaleUpperCase('tr') + restSlice.slice(1)
          : m[1].charAt(0).toLocaleUpperCase('tr') + m[1].slice(1) + ' ' + restSlice;
      const balanced =
        (left.match(/[“”]/g) || []).length % 2 === 0 &&
        (right.match(/[“”]/g) || []).length % 2 === 0 &&
        (left.match(/\(/g) || []).length === (left.match(/\)/g) || []).length &&
        (right.match(/\(/g) || []).length === (right.match(/\)/g) || []).length &&
        !hasUnbalancedDelim(left, '{', '}') &&
        !hasUnbalancedDelim(right, '{', '}') &&
        !hasUnbalancedDelim(left, '[', ']') &&
        !hasUnbalancedDelim(right, '[', ']');
      if (balanced && left.split(/\s+/).length >= 8 && right.split(/\s+/).length >= 8) {
        outSents.push(left + '.');
        outSents.push(right);
        modified = true;
        continue;
      }
    }
    outSents.push(s);
  }
  return modified ? outSents.join(' ') : text;
}

// Rusça fısıltı bloklarını ({...}) ve köşeli parantez bloklarını ([...]) koruyarak yalnızca dış/uygun metni işle
function polishPreservingDelims(text, glossary) {
  const protectedSpans = [];
  let masked = String(text || '').replace(/\{[^{}]+\}/g, (m) => {
    const idx = protectedSpans.length;
    protectedSpans.push(m);
    return `\uE000${idx}\uE001`;
  });

  for (const [from, to] of Object.entries(glossary)) {
    if (from === to) continue;
    const re = new RegExp(
      '(?<![\\p{L}\\p{N}])' + from.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])',
      'gu'
    );
    masked = masked.replace(re, to);
  }
  for (const [re, rep] of SPELLING_FIXES) masked = masked.replace(re, rep);
  for (const [re, rep] of LITERARY_RULES) masked = masked.replace(re, rep);

  masked = splitOverlongSentences(masked);

  masked = masked
    .replace(/\.{2,}/g, '…')
    .replace(/…+\.+/g, '…')
    .replace(/\.+…+/g, '…')
    .replace(/[!?]\.+/g, (m) => m[0])
    .replace(/([,.;:!?…~])\s+([”])/g, '$1$2')
    .replace(/([“])\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  let restored = masked.replace(/\uE000(\d+)\uE001/g, (_, idx) => protectedSpans[Number(idx)]);
  if (/^[a-zçğıöşü]/.test(restored)) {
    restored = restored.charAt(0).toLocaleUpperCase('tr') + restored.slice(1);
  }
  return restored;
}

function isSafeCandidate(orig, cand) {
  if (!cand || !cand.trim()) return false;
  if (/["']/.test(cand)) return false;
  if (/[『』「」]/.test(cand)) return false;
  if (/\p{Script=Cyrillic}/u.test(cand)) return false;
  if (hasUnbalancedDelim(cand, '{', '}')) return false;
  if (hasUnbalancedDelim(cand, '[', ']')) return false;
  if ((cand.match(/\(/g) || []).length !== (cand.match(/\)/g) || []).length) return false;
  if (((cand.match(/[“”]/g) || []).length % 2) !== ((orig.match(/[“”]/g) || []).length % 2)) return false;
  if (/\s+[,.;:!?]/.test(cand) || /\.{2,}/.test(cand) || /[!?]\./.test(cand)) return false;
  if (/(?<!\p{L})(?:the|and|with|that|this|from|have|would|could|should|about|there|their|which)(?!\p{L})/iu.test(cand.replace(/https?:\s*\/\/[^\n]+/gi, ''))) return false;
  if (/(?<!\p{L})(?:ÇN|TN)\s*:/u.test(cand)) return false;
  return true;
}

function polishVolume(volKey, { dry = false } = {}) {
  const cfg = resolveVolume(volKey);
  if (!cfg) throw new Error(`Bilinmeyen cilt: ${volKey}`);
  const filePath = cfg.finalFile;
  const rawOrigFile = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(rawOrigFile);
  const glossary = loadGlossary();

  const patchesFile = path.join(ROOT, 'scripts', 'patches.json');
  const patches = volKey === '4' && fs.existsSync(patchesFile)
    ? JSON.parse(fs.readFileSync(patchesFile, 'utf8'))
    : null;

  const beforeEval = evaluateData(data);
  let changed = 0;

  for (const [pg, arr] of Object.entries(data)) {
    const nextArr = [];
    for (let i = 0; i < arr.length; i++) {
      const orig = arr[i];
      if (!orig || !orig.trim()) continue;
      const key = `${pg}.${i}`;
      const candidate = polishPreservingDelims(orig, glossary);
      if (candidate !== orig && isSafeCandidate(orig, candidate)) {
        const sBefore = score(pg, i, orig).score;
        const sAfter = score(pg, i, candidate).score;
        // Yalnızca kusur puanını düşüren veya açık ek/tırnak pürüzünü puan artırmadan düzelten adayları kabul et
        const fixedHarmonyOrSpace =
          /(?:senpai|chan|kun|sama|hime|Sumire|Ayame|Kanae)’(?:ın|in|ı|i|e|a|den|de|le)|bir hoge’um|Prez|(?:[“]\s+|\s+[”])/.test(orig) &&
          sAfter <= sBefore;
        if (sAfter < sBefore || fixedHarmonyOrSpace) {
          nextArr.push(candidate);
          if (patches && patches[key] !== undefined) {
            patches[key] = candidate;
          }
          changed++;
          continue;
        }
      }
      nextArr.push(orig);
    }
    data[pg] = nextArr;
  }

  const afterEval = evaluateData(data);
  console.log(
    `[${cfg.dataDir}] Edebî iyileştirme (${dry ? 'dry-run' : 'yazıldı'}): değişen=${changed} | ort: ${beforeEval.avg.toFixed(2)} -> ${afterEval.avg.toFixed(2)} | 3+ puanlı: ${beforeEval.flagged} -> ${afterEval.flagged}`
  );

  if (!dry) {
    const isMultiline = rawOrigFile.includes('\n ');
    const serialized = isMultiline ? JSON.stringify(data, null, 1) : JSON.stringify(data);
    fs.writeFileSync(filePath, rawOrigFile.endsWith('\n') ? serialized + '\n' : serialized);
    if (patches) {
      fs.writeFileSync(patchesFile, JSON.stringify(patches, null, 1) + '\n');
    }
  }
  return { before: beforeEval, after: afterEval, changed };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  if (args.includes('--all')) {
    for (const v of VOLUME_KEYS) polishVolume(v, { dry });
  } else {
    const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
    const vols = vIdx > -1 && args[vIdx + 1] ? args[vIdx + 1].split(',') : ['4'];
    for (const v of vols) polishVolume(v.trim(), { dry });
  }
}

module.exports = { polishParagraph: polishPreservingDelims, polishVolume };
