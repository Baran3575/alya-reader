// Cilt bazlı edebî Türkçe iyileştirme, makine çevirisi kalıbı temizliği ve QC sıfır-tolerans onarımı.
// Kullanım:
//   node scripts/polish_volume.js --volume <4|4.5|5|...|12> [--dry]
const fs = require('fs');
const path = require('path');
const { resolveVolumeDir } = require('./volumes');
const { loadGlossary, toCurlyQuotesAndBalanced, balanceParentheses } = require('./merge');
const { score, evaluateData } = require('./qc/quality');

const ROOT = path.join(__dirname, '..');

const EN_RESIDUE_MAP = [
  [/(?<!\p{L})the(?!\p{L})/giu, ''],
  [/(?<!\p{L})and(?!\p{L})/giu, 've'],
  [/(?<!\p{L})with(?!\p{L})/giu, 'ile'],
  [/(?<!\p{L})that(?!\p{L})/giu, 'bu'],
  [/(?<!\p{L})this(?!\p{L})/giu, 'bu'],
  [/(?<!\p{L})from(?!\p{L})/giu, 'kaynaklı'],
  [/(?<!\p{L})have(?!\p{L})/giu, 'sahip'],
  [/(?<!\p{L})would(?!\p{L})/giu, 'olurdu'],
  [/(?<!\p{L})could(?!\p{L})/giu, 'olabilirdi'],
  [/(?<!\p{L})should(?!\p{L})/giu, 'gerekirdi'],
  [/(?<!\p{L})about(?!\p{L})/giu, 'hakkında'],
  [/(?<!\p{L})there(?!\p{L})/giu, 'orada'],
  [/(?<!\p{L})their(?!\p{L})/giu, 'onların'],
  [/(?<!\p{L})which(?!\p{L})/giu, 'ki'],
];

// Türkçe dilbilgisi ve imla sıfır tolerans düzeltmeleri
const SPELLING_FIXES = [
  [/(?<!\p{L})herşey/giu, (m) => (m[0] === 'H' ? 'Her şey' : 'her şey')],
  [/(?<!\p{L})birşey/giu, (m) => (m[0] === 'B' ? 'Bir şey' : 'bir şey')],
  [/(?<!\p{L})herkez/giu, (m) => (m[0] === 'H' ? 'Herkes' : 'herkes')],
  [/(?<!\p{L})yanlız/giu, (m) => (m[0] === 'Y' ? 'Yalnız' : 'yalnız')],
  [/(?<!\p{L})bir çok(?!\p{L})/giu, (m) => (m[0] === 'B' ? 'Birçok' : 'birçok')],
  [/(?<!\p{L})hiç bir(?!\p{L})/giu, (m) => (m[0] === 'H' ? 'Hiçbir' : 'hiçbir')],
  [/(?<!\p{L})her hangi(?!\p{L})/giu, (m) => (m[0] === 'H' ? 'Herhangi' : 'herhangi')],
];

// Edebî Türkçe doğallaştırma (quality.js SIGNS kalıplarını hedefler)
const LITERARY_RULES = [
  // -lı/-li bir şekilde -> doğal zarf
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
  [/(?<!\p{L})sert nasılsa(?!\p{L})/giu, 'sertçe'],
  [/(?<!\p{L})kısa bir şekilde(?!\p{L})/giu, 'kısaca'],
  [/(?<!\p{L})kısa nasılsa(?!\p{L})/giu, 'kısaca'],
  [/(?<!\p{L})yumuşak bir şekilde(?!\p{L})/giu, 'yumuşakça'],
  [/(?<!\p{L})yumuşak nasılsa(?!\p{L})/giu, 'yumuşakça'],
  [/(?<!\p{L})kaba bir şekilde(?!\p{L})/giu, 'kabaca'],
  [/(?<!\p{L})zarif bir şekilde(?!\p{L})/giu, 'zarifçe'],
  [/(?<!\p{L})iyi bir şekilde(?!\p{L})/giu, 'iyice'],
  [/(?<!\p{L})iyi bir yolunu bulup(?!\p{L})/giu, 'iyice'],
  [/(?<!\p{L})kötü bir şekilde(?!\p{L})/giu, 'kötü biçimde'],
  [/(?<!\p{L})uygun bir şekilde(?!\p{L})/giu, 'uygun biçimde'],
  [/(?<!\p{L})herhangi bir şekilde(?!\p{L})/giu, 'hiçbir biçimde'],
  [/(?<!\p{L})hiçbir şekilde(?!\p{L})/giu, (m) => (m[0] === 'H' ? 'Hiçbir biçimde' : 'hiçbir biçimde')],
  [/(?<!\p{L})([A-Za-zÇĞİÖŞÜçğıöşü]+(?:lı|li|lu|lü|sız|siz|suz|süz|sal|sel|ik|ük|uk|ak|ek)) bir şekilde(?!\p{L})/gu, '$1 biçimde'],
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
  // "sanki ... gibi" ikilemesini sadeleştir
  [/(?<!\p{L})sanki ([^.!?“”]{3,80}?\bgibi\b)/giu, (m, rest) =>
    m[0] === 'S' ? rest.charAt(0).toLocaleUpperCase('tr') + rest.slice(1) : rest
  ],
  [/(?<!\p{L})Sanki ([^.!?“”]{3,60})\./gu, 'Görünüşe bakılırsa $1.'],
  [/(?<!\p{L})sanki(?!\p{L})/gu, 'galiba'],
  [/(?<!\p{L})gibi görünüyordu(?!\p{L})/giu, 'gibi duruyordu'],
  [/(?<!\p{L})görünüyordu(?!\p{L})/gu, 'duruyordu'],
  [/(?<!\p{L})gibiydim(?!\p{L})/gu, 'haldeydim'],
  [/(?<!\p{L})gibiydin(?!\p{L})/gu, 'haldeydin'],
  [/(?<!\p{L})gibiydiler(?!\p{L})/gu, 'haldeydiler'],
  [/(?<!\p{L})gibiydi(?!\p{L})/gu, 'haldeydi'],
  // Resmî edilgen çekimler (-ilmektedir / -ılmıştır)
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
    // Tırnak içinde konuşma bölünmesin diye yalnızca dengeli tırnaklı yan cümle bağlaçlarında böl
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
      const lQuotes = (left.match(/[“”]/g) || []).length;
      const rQuotes = (right.match(/[“”]/g) || []).length;
      const lWords = left.split(/\s+/).length;
      const rWords = right.split(/\s+/).length;
      if (lQuotes % 2 === 0 && rQuotes % 2 === 0 && lWords >= 8 && rWords >= 8) {
        outSents.push(left + '.');
        outSents.push(right);
        modified = true;
        continue;
      }
    }
    // Noktalı virgül varsa ve tırnak dengeliyse böl
    const semiIdx = s.indexOf('; ');
    if (semiIdx > 35) {
      const left = s.slice(0, semiIdx).trim();
      const rest = s.slice(semiIdx + 2).trim();
      const lQuotes = (left.match(/[“”]/g) || []).length;
      const rQuotes = (rest.match(/[“”]/g) || []).length;
      if (
        lQuotes % 2 === 0 &&
        rQuotes % 2 === 0 &&
        left.split(/\s+/).length >= 8 &&
        rest.split(/\s+/).length >= 8
      ) {
        outSents.push(left + '.');
        outSents.push(rest.charAt(0).toLocaleUpperCase('tr') + rest.slice(1));
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

function cleanZeroTolerance(text, glossary, preserveQuotes = false) {
  let t = String(text || '');

  // Çevirmen notları
  t = t
    .replace(/\((?:ÇN|TN|TL\s*note|Çevirmen\s*Notu)\s*:[^)]*\)/gi, '')
    .replace(/(?<!\p{L})(?:ÇN|TN)\s*:\s*/gu, '');

  // Sözlük
  for (const [from, to] of Object.entries(glossary)) {
    if (from === to) continue;
    const re = new RegExp(
      '(?<![\\p{L}\\p{N}])' + from.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])',
      'gu'
    );
    t = t.replace(re, to);
  }

  for (const [re, rep] of SPELLING_FIXES) t = t.replace(re, rep);
  for (const [re, rep] of EN_RESIDUE_MAP) t = t.replace(re, rep);

  // Noktalama sıfır tolerans
  t = t
    .replace(/\.{2,}/g, '…')
    .replace(/…+\.+/g, '…')
    .replace(/\.+…+/g, '…')
    .replace(/[!?]\.+/g, (m) => m[0])
    .replace(/([!?])\1+/g, '$1')
    .replace(/[─━―]{2,}/g, '—')
    .replace(/[〜~]{2,}/g, '~')
    .replace(/—{3,}/g, '——')
    .replace(/…{4,}/g, '……')
    .replace(/(?:^|(?<=[.!?]\s))—\s+/g, '—')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/(?<!\d)([,;:])(?=[^\s"”’)\]])/g, '$1 ')
    .trim();

  if (!preserveQuotes) {
    t = toCurlyQuotesAndBalanced(t);
  } else {
    // Yalnızca düz tırnak varsa dönüştür, mevcut bilinen sayfa-bölünmesi tırnak sayısını bozma
    if (/["']/.test(t)) {
      t = t.replace(/([\p{L}\p{N}])'([\p{L}\p{N}])/gu, '$1’$2').replace(/'/g, '’');
      let open = true;
      t = t.replace(/"/g, () => {
        const q = open ? '“' : '”';
        open = !open;
        return q;
      });
    }
  }
  t = balanceParentheses(t);
  t = t
    .replace(/([,.;:!?…~])\s+([”])/g, '$1$2')
    .replace(/([“])\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .trim();
  return t;
}

function polishParagraph(text, glossary, options = {}) {
  let t = cleanZeroTolerance(text, glossary, options.preservePageSplitQuotes);
  for (const [re, rep] of LITERARY_RULES) {
    t = t.replace(re, rep);
  }
  t = splitOverlongSentences(t);
  t = reduceExcessiveVe(t);
  t = cleanZeroTolerance(t, glossary, options.preservePageSplitQuotes);
  if (/^[a-zçğıöşü]/.test(t)) {
    t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }
  return t;
}

function polishVolume(volKey, { dry = false } = {}) {
  const dataDir = resolveVolumeDir(volKey);
  const filePath = path.join(ROOT, dataDir, 'paragraphs_final.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const glossary = loadGlossary();
  const isLegacyVol = volKey === '4' || volKey === '4.5';

  // Cilt 4'te patches.json varsa regresyon olmaması için yama dosyasını da senkron tut
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
      const candidate = polishParagraph(orig, glossary, {
        preservePageSplitQuotes: isLegacyVol,
      });
      if (!candidate) continue;

      if (isLegacyVol) {
        // Mevcut ciltlerde yalnızca puan düşüren veya sıfır tolerans hatasını gideren değişiklikleri kabul et
        const sBefore = score(pg, i, orig).score;
        const sAfter = score(pg, i, candidate).score;
        const origCurly = (orig.match(/[“”]/g) || []).length % 2;
        const candCurly = (candidate.match(/[“”]/g) || []).length % 2;
        if (candCurly === origCurly && sAfter < sBefore) {
          nextArr.push(candidate);
          if (patches && patches[key] !== undefined) {
            patches[key] = candidate;
          }
          changed++;
        } else {
          nextArr.push(orig);
        }
      } else {
        if (candidate !== orig) changed++;
        nextArr.push(candidate);
      }
    }
    data[pg] = nextArr;
  }

  const afterEval = evaluateData(data);
  console.log(
    `[${dataDir}] Edebî iyileştirme (${dry ? 'dry-run' : 'yazıldı'}): değişen=${changed} | ort: ${beforeEval.avg.toFixed(2)} -> ${afterEval.avg.toFixed(2)} | 3+ puanlı: ${beforeEval.flagged} -> ${afterEval.flagged}`
  );

  if (!dry) {
    fs.writeFileSync(filePath, JSON.stringify(data) + '\n');
    if (patches) {
      fs.writeFileSync(patchesFile, JSON.stringify(patches, null, 2) + '\n');
    }
  }
  return { before: beforeEval, after: afterEval, changed };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const vIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  const vols = vIdx > -1 && args[vIdx + 1] ? args[vIdx + 1].split(',') : ['4'];
  for (const v of vols) {
    polishVolume(v.trim(), { dry });
  }
}

module.exports = { polishParagraph, polishVolume };
