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

const LITERARY_RULES = [
  [/(?<!\p{L})çok hızlı bir şekilde(?!\p{L})/giu, 'hızla'],
  [/(?<!\p{L})hızlı bir şekilde(?!\p{L})/giu, 'hızlıca'],
  [/(?<!\p{L})yavaş bir şekilde(?!\p{L})/giu, 'yavaşça'],
  [/(?<!\p{L})sessiz bir şekilde(?!\p{L})/giu, 'sessizce'],
  [/(?<!\p{L})nazik bir şekilde(?!\p{L})/giu, 'nazikçe'],
  [/(?<!\p{L})sakin bir şekilde(?!\p{L})/giu, 'sakince'],
  [/(?<!\p{L})kolay bir şekilde(?!\p{L})/giu, 'kolayca'],
  [/(?<!\p{L})kesin bir şekilde(?!\p{L})/giu, 'kesinlikle'],
  [/(?<!\p{L})dikkatli bir şekilde(?!\p{L})/giu, 'dikkatlice'],
  [/(?<!\p{L})ciddi bir şekilde(?!\p{L})/giu, 'ciddiyetle'],
  [/(?<!\p{L})açık bir şekilde(?!\p{L})/giu, 'açıkça'],
  [/(?<!\p{L})net bir şekilde(?!\p{L})/giu, 'netçe'],
  [/(?<!\p{L})doğal bir şekilde(?!\p{L})/giu, 'doğallıkla'],
  [/(?<!\p{L})düzenli bir şekilde(?!\p{L})/giu, 'düzenlice'],
  [/(?<!\p{L})istekli bir şekilde(?!\p{L})/giu, 'istekle'],
  [/(?<!\p{L})endişeli bir şekilde(?!\p{L})/giu, 'endişeyle'],
  [/(?<!\p{L})öfkeli bir şekilde(?!\p{L})/giu, 'öfkeyle'],
  [/(?<!\p{L})neşeli bir şekilde(?!\p{L})/giu, 'neşeyle'],
  [/(?<!\p{L})üzgün bir şekilde(?!\p{L})/giu, 'üzüntüyle'],
  [/(?<!\p{L})şaşkın bir şekilde(?!\p{L})/giu, 'şaşkınlıkla'],
  [/(?<!\p{L})utangaç bir şekilde(?!\p{L})/giu, 'utangaçça'],
  [/(?<!\p{L})beceriksiz bir şekilde(?!\p{L})/giu, 'beceriksizce'],
  [/(?<!\p{L})umutsuz bir şekilde(?!\p{L})/giu, 'umutsuzca'],
  [/(?<!\p{L})sabırsız bir şekilde(?!\p{L})/giu, 'sabırsızca'],
  [/(?<!\p{L})gergin bir şekilde(?!\p{L})/giu, 'gergince'],
  [/(?<!\p{L})tuhaf bir şekilde(?!\p{L})/giu, 'tuhaf biçimde'],
  [/(?<!\p{L})garip bir şekilde(?!\p{L})/giu, 'tuhaf biçimde'],
  [/(?<!\p{L})normal bir şekilde(?!\p{L})/giu, 'normalce'],
  [/(?<!\p{L})sert bir şekilde(?!\p{L})/giu, 'sertçe'],
  [/(?<!\p{L})kısa bir şekilde(?!\p{L})/giu, 'kısaca'],
  [/(?<!\p{L})yumuşak bir şekilde(?!\p{L})/giu, 'yumuşakça'],
  [/(?<!\p{L})kaba bir şekilde(?!\p{L})/giu, 'kabaca'],
  [/(?<!\p{L})zarif bir şekilde(?!\p{L})/giu, 'zarifçe'],
  [/(?<!\p{L})iyi bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'iyice'],
  [/(?<!\p{L})kötü bir şekilde(?!\p{L})/giu, 'kötü biçimde'],
  [/(?<!\p{L})uygun bir şekilde(?!\p{L})/giu, 'uygun biçimde'],
  [/(?<!\p{L})herhangi bir şekilde(?!\p{L})/giu, 'hiçbir biçimde'],
  [/(?<!\p{L})hiçbir şekilde(?!\p{L})/giu, (m) => (m[0] === 'H' ? 'Hiçbir biçimde' : 'hiçbir biçimde')],
  [/(?<!\p{L})alaycı bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'alaycı bir tavırla'],
  [/(?<!\p{L})şakacı bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'şakacı bir tavırla'],
  [/(?<!\p{L})düzgün bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'düzgünce'],
  [/(?<!\p{L})(?:mükemmel|kusursuz) bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'kusursuzca'],
  [/(?<!\p{L})gelişigüzel bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'kayıtsızca'],
  [/(?<!\p{L})muzip bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'muzipçe'],
  [/(?<!\p{L})sıkı bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'sıkıca'],
  [/(?<!\p{L})çekingen bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'çekingence'],
  [/(?<!\p{L})derin bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'derinden'],
  [/(?<!\p{L})rahat bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'rahatça'],
  [/(?<!\p{L})dalgın bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'dalgınca'],
  [/(?<!\p{L})masum bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'masumca'],
  [/(?<!\p{L})sıcak bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'sıcakça'],
  [/(?<!\p{L})soğuk bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'soğukça'],
  [/(?<!\p{L})tatlı bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'tatlılıkla'],
  [/(?<!\p{L})bariz bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'açıkça'],
  [/(?<!\p{L})kendinden emin bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'kendinden emin bir tavırla'],
  [/(?<!\p{L})emin bir (?:şekilde|yolunu bulup)(?!\p{L})/giu, 'emin bir tavırla'],
  [/(?<!\p{L})([A-Za-zÇĞİÖŞÜçğıöşü]+(?:lı|li|lu|lü|sız|siz|suz|süz|sal|sel|ik|ük|uk|ak|ek)) bir (?:şekilde|yolunu bulup)(?!\p{L})/gu, '$1 biçimde'],
  [
    /(?<!\p{L})(?!(?:ama|fakat|ancak|ve|veya|ya|da|de|ki|sonra|önce|artık|hâlâ|hala|zaten|yine|bile|sadece|yalnızca|bunu|şunu|onu|bu|şu|o|ben|sen|biz|siz|onlar|hepsi|herkes|kimse)(?!\p{L}))([a-zçğıöşü]{3,}) bir (?:şekilde|yolunu bulup)(?!\p{L})/gu,
    '$1 biçimde',
  ],
  [/(?<!\p{L})bir şekilde(?!\p{L})/giu, (m) => (m[0] === 'B' ? 'Bir yolunu bulup' : 'bir yolunu bulup')],
  [/(?<!\p{L})bir nevi(?!\p{L})/giu, (m) => (m[0] === 'B' ? 'Bir tür' : 'bir tür')],
  [/(?<!\p{L})söz konusu olduğunda(?!\p{L})/giu, 'konu bu olunca'],
  [/(?<!\p{L})söz konusu olan(?!\p{L})/giu, 'bahsedilen'],
  [/(?<!\p{L})söz konusu değildi(?!\p{L})/giu, 'düşünülemezdi'],
  [/(?<!\p{L})söz konusu değil(?!\p{L})/giu, 'mümkün değil'],
  [/(?<!\p{L})söz konusuydu(?!\p{L})/giu, 'ortadaydı'],
  [/(?<!\p{L})söz konusuysa(?!\p{L})/giu, 'gündemdeyse'],
  [/(?<!\p{L})söz konusu(?!\p{L})/giu, (m) => (m[0] === 'S' ? 'Bahsedilen' : 'bahsedilen')],
  [/(?<!\p{L})olmasına rağmen(?!\p{L})/giu, 'olsa da'],
  [/(?<!\p{L})açısından(?!\p{L})/giu, 'bakımından'],
  [/(?<!\p{L})konusundaki(?!\p{L})/giu, 'hakkındaki'],
  [/(?<!\p{L})konusunda(?!\p{L})/giu, 'hakkında'],
  [/(?<!\p{L})yönelik(?!\p{L})/giu, 'dair'],
  [/(?<!\p{L})(?:adeta|âdeta)(?!\p{L})/giu, (m) => (m[0] === 'A' || m[0] === 'Â' ? 'Resmen' : 'resmen')],
  [/(?<!\p{L})farkında olmadan(?!\p{L})/giu, (m) => (m[0] === 'F' ? 'Elinde olmadan' : 'elinde olmadan')],
  [/(?<!\p{L})fark etmeden(?!\p{L})/giu, (m) => (m[0] === 'F' ? 'İstemeden' : 'istemeden')],
  [/(?<!\p{L})sanki ([^.!?“”{}]{3,80}?\bgibi\b)/giu, (m, rest) =>
    m[0] === 'S' ? rest.charAt(0).toLocaleUpperCase('tr') + rest.slice(1) : rest
  ],
  [/(?<!\p{L})Sanki ([^.!?“”{}]{3,60})\./gu, 'Görünüşe bakılırsa $1.'],
  [/(?<!\p{L})sanki(?!\p{L})/gu, 'galiba'],
  [/(?<!\p{L})gibi görünüyordu(?!\p{L})/giu, 'gibi duruyordu'],
  [/(?<!\p{L})görünüyordu(?!\p{L})/gu, 'duruyordu'],
  [/(?<!\p{L})gibiydim(?!\p{L})/gu, 'haldeydim'],
  [/(?<!\p{L})gibiydin(?!\p{L})/gu, 'haldeydin'],
  [/(?<!\p{L})gibiydiler(?!\p{L})/gu, 'haldeydiler'],
  [/(?<!\p{L})gibiydi(?!\p{L})/gu, 'haldeydi'],
  [/([a-zçğıöşü])ılmaktadır(?!\p{L})/gu, '$1ılıyor'],
  [/([a-zçğıöşü])ilmektedir(?!\p{L})/gu, '$1iliyor'],
  [/([a-zçğıöşü])ulmaktadır(?!\p{L})/gu, '$1uluyor'],
  [/([a-zçğıöşü])ülmektedir(?!\p{L})/gu, '$1ülüyor'],
  [/([a-zçğıöşü])ılmıştır(?!\p{L})/gu, '$1ıldı'],
  [/([a-zçğıöşü])ilmiştir(?!\p{L})/gu, '$1ildi'],
  [/([a-zçğıöşü])ulmuştur(?!\p{L})/gu, '$1uldu'],
  [/([a-zçğıöşü])ülmüştür(?!\p{L})/gu, '$1üldü'],
  [/(?<!\p{L})gerçekleştirdi(?!\p{L})/giu, 'yaptı'],
  [/(?<!\p{L})gerçekleşti(?!\p{L})/giu, 'oldu'],
  [/(?<!\p{L})ifade etti(?!\p{L})/giu, 'söyledi'],
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

function reduceExcessiveVe(text) {
  const veMatches = [...text.matchAll(/(?<!\p{L})ve(?!\p{L})/gu)];
  if (veMatches.length < 4) return text;
  let count = 0;
  return text.replace(/\s+(?<!\p{L})ve(?!\p{L})\s+/gu, (m) => {
    count++;
    if (count % 2 === 0) return ', ';
    return m;
  });
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
  masked = reduceExcessiveVe(masked);

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
          /(?:senpai|chan|kun|sama)’(?:in|i|e|den|de|le)|Prez|(?:[“]\s+|\s+[”])/.test(orig) &&
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
