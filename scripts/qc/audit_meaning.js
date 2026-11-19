// Anlam denetimi: olumsuzluk ve diyalog tutarlılığı (EN kaynak vs TR çeviri)
const fs = require('fs');
const path = require('path');
const { paragraphs, stripTranslatorNotes } = require('../../mt/paragraphs');
const { isUsableSourcePage, resolveVolumeDir } = require('./fidelity');

const ROOT = path.join(__dirname, '..', '..');

const NEG_EN = /\b(not|n't|no|never|none|nothing|nobody|cannot|hardly|neither|nowhere)\b/i;
const NEG_TR =
  /(?:(?<!\p{L})(?:hayır|yok|yoktu|yoktur|yoksa|değil\p{L}*|asla|hiç|hiçbir\p{L}*|kimse\p{L}*|olmaz|olmadan|olmayacak|istemem|istemiyor\p{L}*|sanmıyorum|imkânsız|imkansız|nafile|boşuna|nadiren)(?!\p{L})|(?:ma|me|mı|mi|mu|mü)(?:dı|di|du|dü|tı|ti|tu|tü|mış|miş|muş|müş|yor|yacak|yecek|yabilir|yebil|acak|ecek|z|dık|dik|duk|dük|dığ|diğ|duğ|düğ|yan|yen|yalım|yelim|yın|yin|dan|den|maksızın|meksizin|mak|mek|sın|sin|sa|se|malı|meli|makta|mekte)\p{L}*|(?:ama|eme)(?:dı|di|du|dü|mış|miş|yor|yacak|yecek|z|m|yız|yiz)\p{L}*|(?:sız|siz|suz|süz)\p{L}*)/iu;

function hasEnNeg(text) {
  return NEG_EN.test(String(text || ''));
}

function hasTrNeg(text) {
  return NEG_TR.test(String(text || ''));
}

function evaluateMeaning(src, tr) {
  const rows = [];
  const severePages = [];
  let usablePages = 0;
  let inspectedPages = 0;
  let skippedPages = 0;
  let exactAlignedPages = 0;
  let proportionalPages = 0;

  for (const p of src) {
    if (!isUsableSourcePage(p)) continue;
    usablePages++;

    const k = String(p.page);
    let en = paragraphs(p.text || '')
      .map((s) => stripTranslatorNotes(s))
      .filter(Boolean);

    if (en.length > 0 && /^(?:Prologue|Epilogue|Chapter\s+\d+)\s*[:–—-]/i.test(en[0])) {
      const rest = en[0].replace(/^(?:Prologue|Epilogue|Chapter\s+\d+)\s*[:–—-]\s*/i, '');
      if (!/["“]/.test(rest) && rest.split(/\s+/).length <= 10) {
        en = en.slice(1);
      } else if (rest.trim()) {
        en[0] = rest.trim();
      }
    }

    const t = Array.isArray(tr[k]) ? tr[k].map((s) => String(s || '').trim()).filter(Boolean) : [];
    if (!en.length || !t.length) {
      skippedPages++;
      severePages.push({ page: p.page, reason: 'boş sayfa', pageMismatches: en.length });
      continue;
    }

    inspectedPages++;
    let pageMissingNeg = 0;
    let comparableNegCount = 0;

    if (en.length === t.length) {
      exactAlignedPages++;
      for (let i = 0; i < en.length; i++) {
        const e = hasEnNeg(en[i]);
        const m = hasTrNeg(t[i]);
        if (e && en[i].length > 25) comparableNegCount++;
        if (e && !m && en[i].length > 40) {
          pageMissingNeg++;
          rows.push({ page: p.page, i, en: e, tr: m, mode: 'exact', t: t[i] });
        }
      }
    } else {
      proportionalPages++;
      for (let i = 0; i < en.length; i++) {
        const j = Math.min(t.length - 1, Math.floor((i * t.length) / en.length));
        const windowText = [t[Math.max(0, j - 1)], t[j], t[Math.min(t.length - 1, j + 1)]]
          .filter(Boolean)
          .join(' ');
        const e = hasEnNeg(en[i]);
        const m = hasTrNeg(windowText);
        if (e && en[i].length > 25) comparableNegCount++;
        if (e && !m && en[i].length > 40) {
          pageMissingNeg++;
          rows.push({ page: p.page, i, en: e, tr: m, mode: 'proportional', t: t[j] });
        }
      }
    }

    // Sayfa üzerinde yoğun olumsuzluk kaybı / kurgu sapması kontrolü
    if (pageMissingNeg >= 4 || (comparableNegCount >= 3 && pageMissingNeg === comparableNegCount)) {
      severePages.push({
        page: p.page,
        reason: 'yoğun olumsuzluk/anlam sapması',
        pageMismatches: pageMissingNeg,
      });
    }
  }

  return {
    rows,
    severePages,
    usablePages,
    inspectedPages,
    skippedPages,
    exactAlignedPages,
    proportionalPages,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const volIdx = args.indexOf('--volume') > -1 ? args.indexOf('--volume') : args.indexOf('--vol');
  let vols = [];
  if (volIdx > -1 && args[volIdx + 1]) {
    vols = [args[volIdx + 1]];
  } else {
    const pos = args.find((a) => !a.startsWith('--'));
    if (pos) {
      vols = [pos];
    } else {
      for (const candidate of ['4', '4.5', '5', '6', '7', '8', '9', '9.5', '10', '11', '12']) {
        const d = resolveVolumeDir(candidate);
        if (
          fs.existsSync(path.join(ROOT, d, 'source.json')) &&
          fs.existsSync(path.join(ROOT, d, 'paragraphs_final.json'))
        ) {
          vols.push(candidate);
        }
      }
    }
  }

  for (const vol of vols) {
    const dir = resolveVolumeDir(vol);
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'source.json'), 'utf8'));
    const tr = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'paragraphs_final.json'), 'utf8'));
    const res = evaluateMeaning(src, tr);
    console.log(
      `Cilt ${vol} — incelenen sayfa: ${res.inspectedPages}/${res.usablePages} (atlanan: ${res.skippedPages}, birebir: ${res.exactAlignedPages}, oransal: ${res.proportionalPages}) | olumsuzluk uyuşmazlığı: ${res.rows.length}`
    );
    res.rows
      .slice(0, 8)
      .forEach((r) => console.log(`  s${r.page}.${r.i} en=${r.en} tr=${r.tr} :: ${r.t.slice(0, 100)}`));
    fs.writeFileSync(path.join(ROOT, dir, 'audit_meaning.json'), JSON.stringify(res.rows, null, 1));
  }
}

module.exports = { NEG_EN, NEG_TR, hasEnNeg, hasTrNeg, evaluateMeaning };
