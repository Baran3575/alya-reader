#!/usr/bin/env node
// Parçalı (chunked) Edebî Türkçe Çevirmen — Sözlük, Karakter Sesi ve Rusça Fısıltı ({...}) Duyarlı
// Kullanım:
//   node scripts/translate_llm.js --volume <v> [--concurrency 6] [--force] [--polish-only]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, resolveVolume, parseVolumeArg } = require('./lib/volumes');
const { polish, balanceCurlyQuotes, loadGlossary } = require('./merge');
const { naturalize, notes } = require('./naturalize');
const { ensureDir } = require('./ingest/lib/cache');

const CACHE_DIR = path.join(ROOT, '.cache', 'translate');
const DEEPL_KEY_PATH = path.join(ROOT, '.deepl-key');
const DEEPL_KEY =
  process.env.DEEPL_KEY || (fs.existsSync(DEEPL_KEY_PATH) ? fs.readFileSync(DEEPL_KEY_PATH, 'utf8').trim() : '');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const CHARACTER_VOICE_GUIDE = `
Karakter Ses Profilleri (Alya Bazen Duygularını Rusça Saklar / Roshidere):
- Alisa Mikhailovna Kujou (Alya): Dışarıdan mesafeli, gururlu, disiplinli ve hafif resmî konuşur; ancak süslü parantez içindeki {...} Rusça fısıltılarında utangaç, şefkatli, samimi ve duygusaldır.
- Masachika Kuze: İç monologlarında alaycı, gözlemci, kendini küçümseyen ama zeki; diyaloglarda rahat, esprili ve gerektiğinde kararlı bir üslup kullanır.
- Yuki Suou: Okulda zarif ve kibar bir hanımefendi (ojou-sama); Masachika ile baş başayken enerjik, muzip, otaku şakaları yapan neşeli kız kardeş tonundadır.
- Maria Mikhailovna Kujou (Masha): Yumuşak, anaç, sakinleştirici ve sıcak bir abla üslubu taşır.
- Ayano Kimishima: Son derece ciddi, ölçülü, sadık hizmetkâr/yardımcı üslubuyla konuşur.
- Chisaki Sarashina & Sayaka Taniyama & Nonoa Miyamae: Chisaki enerjik ve açık sözlü; Sayaka ciddi ve kuralcı; Nonoa rahat, modern ve umursamaz bir gençlik dili kullanır.
`.trim();

const EN_RESIDUE_MAP = [
  [/(?<!\p{L})the(?!\p{L})/gui, ''],
  [/(?<!\p{L})and(?!\p{L})/gui, 've'],
  [/(?<!\p{L})with(?!\p{L})/gui, 'ile'],
  [/(?<!\p{L})that(?!\p{L})/gui, 'bu'],
  [/(?<!\p{L})this(?!\p{L})/gui, 'bu'],
  [/(?<!\p{L})from(?!\p{L})/gui, 'üzerinden'],
  [/(?<!\p{L})have(?!\p{L})/gui, 'sahip'],
  [/(?<!\p{L})would(?!\p{L})/gui, 'olurdu'],
  [/(?<!\p{L})could(?!\p{L})/gui, 'olabilirdi'],
  [/(?<!\p{L})should(?!\p{L})/gui, 'gerekirdi'],
  [/(?<!\p{L})about(?!\p{L})/gui, 'hakkında'],
  [/(?<!\p{L})there(?!\p{L})/gui, 'orada'],
  [/(?<!\p{L})their(?!\p{L})/gui, 'onların'],
  [/(?<!\p{L})which(?!\p{L})/gui, 'ki'],
];

function matchCase(rep, orig) {
  if (!orig || !rep) return rep;
  const f = orig.charAt(0);
  if (f === f.toLocaleUpperCase('tr') && f !== f.toLocaleLowerCase('tr')) {
    return rep.charAt(0).toLocaleUpperCase('tr') + rep.slice(1);
  }
  return rep;
}

const LITERARY_REWRITES = [
  // Yüksek cezalı makine çevirisi kalıplarını doğal edebî Türkçeye çevir
  [/\bsöz konusu\b(?!\s+(?:değil|olmadığı|olduğu))/gi, (m) => matchCase('bahsedilen', m)],
  [/\bsöz konusu olduğunda\b/gi, (m) => matchCase('iş oraya gelince', m)],
  [/\bsöz konusu olduğu\b/gi, (m) => matchCase('ortada olduğu', m)],
  [/\bsöz konusu değil\b/gi, (m) => matchCase('mümkün değil', m)],
  [/\bsöz konusu\b/gi, (m) => matchCase('o', m)],
  [/\bherhangi bir şekilde\b/gi, (m) => matchCase('hiçbir biçimde', m)],
  [/\bhiçbir şekilde\b/gi, (m) => matchCase('kesinlikle', m)],
  [/\baynı şekilde\b/gi, (m) => matchCase('aynı biçimde', m)],
  [/\baçık bir şekilde\b/gi, (m) => matchCase('açıkça', m)],
  [/\bnet bir şekilde\b/gi, (m) => matchCase('net biçimde', m)],
  [/\bgarip bir şekilde\b/gi, (m) => matchCase('tuhaf biçimde', m)],
  [/\btuhaf bir şekilde\b/gi, (m) => matchCase('garip biçimde', m)],
  [/\btam bir şekilde\b/gi, (m) => matchCase('tam anlamıyla', m)],
  [/\biyi bir şekilde\b/gi, (m) => matchCase('güzelce', m)],
  [/\bgüzel bir şekilde\b/gi, (m) => matchCase('güzelce', m)],
  [/\bkötü bir şekilde\b/gi, (m) => matchCase('fena hâlde', m)],
  [/\bşiddetli bir şekilde\b/gi, (m) => matchCase('şiddetle', m)],
  [/\byoğun bir şekilde\b/gi, (m) => matchCase('yoğun biçimde', m)],
  [/\bektkili bir şekilde\b/gi, (m) => matchCase('etkili biçimde', m)],
  [/\betkili bir şekilde\b/gi, (m) => matchCase('etkili biçimde', m)],
  [/\bnadir bir şekilde\b/gi, (m) => matchCase('nadiren', m)],
  [/\bdüzenli bir şekilde\b/gi, (m) => matchCase('düzenli olarak', m)],
  // Genel "-lı/-li/-lu/-lü bir şekilde" kalıbı
  [/(\p{L}{2,}(?:lı|li|lu|lü))\s+bir\s+şekilde\b/gui, '$1 biçimde'],
  [/\bbir şekilde\b/gi, (m) => matchCase('bir biçimde', m)],
  [/\bbir nevi\b/gi, (m) => matchCase('bir bakıma', m)],
  [/\bolmasına rağmen\b/gi, (m) => matchCase('olsa da', m)],
  [/\bVice\s+Prez\b/gi, 'Başkan Yardımcısı'],
  [/\bPrez\b/gi, 'Başkan'],
  [/\bBaşkan’in\b/g, 'Başkan’ın'],
  [/\bBaşkan’i\b/g, 'Başkan’ı'],
  [/\bBaşkan’e\b/g, 'Başkan’a'],
  [/\bBaşkan’de\b/g, 'Başkan’da'],
  [/\bBaşkan’den\b/g, 'Başkan’dan'],
  [/\bBaşkan’le\b/g, 'Başkan’la'],
  [/\s*(?:Glikoz\s+Çevirileri|Glucose\s+Translations)(?:\s+\d+)?\s*$/gi, ''],
  [/\bbakış\s+açısından\b/gi, (m) => matchCase('bakış açısıyla', m)],
  [/\baçısından\b/gi, (m) => matchCase('bakımından', m)],
  [/\bbakış\s+bakımından\b/gi, (m) => matchCase('bakış açısıyla', m)],
  [/\b(o|bu)\s+yüzden\s+(?:o|bu)\s+yüzden\b/gi, '$1 yüzden'],
  [/\bkonusunda\b/gi, (m) => matchCase('hakkında', m)],
  [/\byönelik\b/gi, (m) => matchCase('dair', m)],
  [/\b(?:adeta|âdeta)\b/gi, (m) => matchCase('neredeyse', m)],
  [/\bsanki\s+([^.!?]{3,80}?)\s+gibiydi\b/gi, '$1 gibiydi'],
  [/\bgibi görünüyordu\b/gi, 'gibi duruyordu'],
  [/\böyle görünüyordu\b/gi, 'öyle anlaşılıyordu'],
  [/\bgörünüyordu\b/gi, 'duruyordu'],
  [/\bfarkında olmadan\b/gi, (m) => matchCase('istem dışı', m)],
  [/\bfark etmeden\b/gi, (m) => matchCase('istemeden', m)],
  // Edilgen resmî ekler (-ilmektedir / -ilmiştir)
  [/(\p{L}+?)ılmaktadır\b/gui, '$1ılıyor'],
  [/(\p{L}+?)ilmektedir\b/gui, '$1iliyor'],
  [/(\p{L}+?)ulmaktadır\b/gui, '$1uluyor'],
  [/(\p{L}+?)ülmektedir\b/gui, '$1ülüyor'],
  [/(\p{L}+?)ılmıştır\b/gui, '$1ıldı'],
  [/(\p{L}+?)ilmiştir\b/gui, '$1ildi'],
  [/(\p{L}+?)ulmuştur\b/gui, '$1uldu'],
  [/(\p{L}+?)ülmüştür\b/gui, '$1üldü'],
  // İmla düzeltmeleri
  [/(?<!\p{L})herşey(?!\p{L})/gui, (m) => matchCase('her şey', m)],
  [/(?<!\p{L})birşey(?!\p{L})/gui, (m) => matchCase('bir şey', m)],
  [/(?<!\p{L})herkez(?!\p{L})/gui, (m) => matchCase('herkes', m)],
  [/(?<!\p{L})yanlız(?!\p{L})/gui, (m) => matchCase('yalnız', m)],
  [/(?<!\p{L})bir çok(?!\p{L})/gui, (m) => matchCase('birçok', m)],
];

function splitLongTurkishSentences(text) {
  const sents = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const out = [];

  for (const s of sents) {
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length <= 31) {
      out.push(s);
      continue;
    }

    // Doğal bağlaç sınırından cümleyi ikiye böl (anlamı bozmadan nefes aldır)
    const splitPatterns = [
      /,\s+(ama|fakat|ancak|çünkü|bu yüzden|üstelik|hatta|oysa|ne var ki)\s+/i,
      /;\s+/,
      /\s+(ama|fakat|ancak|çünkü|bu yüzden)\s+/i,
    ];

    let didSplit = false;
    for (const re of splitPatterns) {
      // Cümlenin orta bölgesine (%28 - %75) denk gelen bağlacı bul
      const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      let best = null;
      while ((m = globalRe.exec(s)) !== null) {
        const ratio = m.index / s.length;
        if (ratio >= 0.25 && ratio <= 0.76) {
          best = m;
          break;
        }
      }
      if (best) {
        const left = s.slice(0, best.index).trim();
        const conj = best[1] ? best[1] + ' ' : '';
        const rightRaw = (conj + s.slice(best.index + best[0].length)).trim();
        if (left.split(/\s+/).length >= 8 && rightRaw.split(/\s+/).length >= 6) {
          const right = rightRaw.charAt(0).toLocaleUpperCase('tr') + rightRaw.slice(1);
          out.push(left.replace(/[.…]+$/, '') + '.', right);
          didSplit = true;
          break;
        }
      }
    }

    if (!didSplit) out.push(s);
  }

  return out.join(' ');
}

function balanceParentheses(text) {
  let s = text;
  const open = (s.match(/\(/g) || []).length;
  const close = (s.match(/\)/g) || []).length;
  if (open === close) return s;
  if (open > close) {
    let diff = open - close;
    s = s.replace(/\(/g, (m) => (diff-- > 0 ? '' : m));
  } else {
    let diff = close - open;
    s = s.replace(/\)/g, (m) => (diff-- > 0 ? '' : m));
  }
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}

function refineLiteraryTurkish(rawText, glossary, { preserveOddQuotes = false } = {}) {
  let t = String(rawText || '').trim();
  if (!t) return '';

  // 1) Çevirmen notlarını ve URL dışı İngilizce kalıntıları temizle
  t = notes(t);
  t = naturalize(t);

  for (const [re, rep] of LITERARY_REWRITES) {
    t = t.replace(re, rep);
  }

  // İngilizce kalıntı kontrolü (URL'ler hariç)
  if (!/https?:\/\//i.test(t)) {
    for (const [re, rep] of EN_RESIDUE_MAP) {
      t = t.replace(re, (m) => matchCase(rep, m));
    }
  }

  // 2) Uzun cümleleri doğal bağlaçlardan böl
  t = splitLongTurkishSentences(t);

  // 3) Nokta tekrarlarını (!! -> !, ?? -> ?, ... -> …) ve cümle başı tire boşluğunu düzelt
  t = t
    .replace(/\.{2,}/g, '…')
    .replace(/…\.+/g, '…')
    .replace(/([!?])\.+/g, '$1')
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/(^|[.!?]\s)—\s+/g, '$1—')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // 4) Sözlük ve kıvrık tırnak cilası
  if (preserveOddQuotes) {
    // Sayfa bölünmesi olan mevcut Cilt 4.5 satırlarında tek tırnak sayısını koru
    let s = t
      .replace(/['\u2018\u02bc`]/g, '\u2019')
      .replace(/"/g, '\u201c');
    for (const [from, to] of Object.entries(glossary)) {
      if (from === to || from.startsWith('_')) continue;
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
      s = s.replace(re, to);
    }
    t = balanceParentheses(s);
  } else {
    t = polish(t, glossary);
    t = balanceParentheses(t);
    t = balanceCurlyQuotes(t);
  }

  // Tekrar boşluk / noktalama kontrolü
  t = t
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (/^[a-zçğıöşü]/.test(t)) {
    t = t.charAt(0).toLocaleUpperCase('tr') + t.slice(1);
  }
  return t;
}

/**
 * server.js ile birebir uyumlu kaynak paragraf çıkarıcı:
 * source.json içindeki her sayfanın satırlarını anlamlı paragraflara ayırır.
 */
function extractSourceParagraphs(pageText) {
  const raw = String(pageText || '').replace(/\r/g, '').trim();
  if (!raw) return [];

  // Eğer metin \n\n ile ayrılmış temiz paragraflardan oluşuyorsa (EPUB / SecreFTLs / V9.5)
  if (raw.includes('\n\n')) {
    return raw
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  // FlipHTML5 satır bazlı akış için paragraf birleştirici
  const lines = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const blocks = [];
  let cur = [];
  const endPunct = /[.!?"”’…)~}]$/;
  for (const ln of lines) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const prevEnds = endPunct.test(prev);
      const newDialogue = /^["“‘'{—]/.test(ln);
      const shortPrev = prev.length < 52 && prevEnds;
      if (prevEnds && (newDialogue || shortPrev)) {
        blocks.push(cur.join(' '));
        cur = [];
      }
    }
    cur.push(ln);
  }
  if (cur.length) blocks.push(cur.join(' '));
  return blocks.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Rusça fısıltı ayracı {...} ve 【...】 koruyucusu
function normalizeWhisperBraces(enText) {
  return String(enText || '')
    .replace(/【([^】]+)】/g, '{$1}')
    .replace(/\(\s*(?:TN|T\/N|TL\s*note|Translator['’]?s?\s*note)\s*:[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLlmMessages(texts, prevContext, glossary) {
  const glossaryLines = Object.entries(glossary)
    .filter(([k, v]) => !k.startsWith('_') && k !== v)
    .slice(0, 30)
    .map(([k, v]) => `${k} -> ${v}`)
    .join(', ');

  const system = [
    'Sen Japon light novel serisi "Alya Bazen Duygularını Rusça Saklar" (Roshidere) için uzman bir edebî Türkçe çevirmensin.',
    CHARACTER_VOICE_GUIDE,
    `Terim ve İsim Kuralları: İsimleri hep şu kanonik biçimde koru: Masachika, Alisa, Alya, Yuki, Masha, Ayano, Chisaki, Touya, Sayaka, Nonoa, Suou, Kujou, Kimishima, Sarashina, Seirei Akademisi (${glossaryLines}).`,
    'Rusça Fısıltı Kuralı: Süslü parantez içindeki {...} ifadeler Alya veya Masha’nın Rusça fısıltılarıdır; süslü parantezleri {...} AYNEN koru ve içindeki cümleyi samimi, doğal bir fısıltı Türkçesiyle çevir.',
    'Biçim Kuralları:',
    '1. Çevirmen notu ((ÇN: ...), (TN: ...)) ASLA ekleme; varsa sil.',
    '2. Düz tırnak (" veya \') KULLANMA; yalnızca kıvrık tırnak (“…”) ve kıvrık kesme (’) kullan.',
    '3. Üç nokta için tek karakter (…) kullan; "bir şekilde", "söz konusu", "-ilmektedir" gibi makine çevirisi kalıplarından kaçın.',
    '4. Sana verilen JSON dizisindeki her İngilizce paragraf için birebir aynı uzunlukta bir JSON dize dizisi (["...", "..."]) döndür. Sadece geçerli JSON dizisi yanıtla.',
  ].join('\n\n');

  const userPayload = {
    previous_turkish_context: prevContext.slice(-3),
    english_paragraphs: texts,
  };

  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];
}

async function translateChunkViaLlm(texts, prevContext, glossary) {
  const messages = buildLlmMessages(texts, prevContext, glossary);

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        messages,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const j = await res.json();
    const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length === texts.length) return arr.map(String);
  }

  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: messages[0].content }] },
        contents: [{ role: 'user', parts: [{ text: messages[1].content }] }],
        generationConfig: { temperature: 0.25, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const j = await res.json();
    const raw =
      (j.candidates &&
        j.candidates[0] &&
        j.candidates[0].content &&
        j.candidates[0].content.parts &&
        j.candidates[0].content.parts.map((p) => p.text || '').join('')) ||
      '';
    const arr = JSON.parse(raw.trim());
    if (Array.isArray(arr) && arr.length === texts.length) return arr.map(String);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.25,
        system: messages[0].content,
        messages: [{ role: 'user', content: messages[1].content }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
    const j = await res.json();
    const raw = (j.content && j.content[0] && j.content[0].text) || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length === texts.length) return arr.map(String);
  }

  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function googleBatchTranslate(texts) {
  const body = new URLSearchParams();
  for (const t of texts) body.append('q', t);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=tr', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Referer: 'https://translate.google.com/',
        },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const flat = data.map((d) => (typeof d === 'string' ? d : Array.isArray(d) ? d[0] : ''));
      if (flat.length === texts.length) return flat;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }

  // Yedek uç nokta: translate.googleapis.com tekil/birleşik çağrı
  const fallbackOut = [];
  for (const t of texts) {
    let translated = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const u =
          'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=' +
          encodeURIComponent(t);
        const r = await fetch(u, { headers: { 'User-Agent': UA } });
        if (r.ok) {
          const j = await r.json();
          translated = Array.isArray(j[0]) ? j[0].map((seg) => seg[0] || '').join('') : '';
          if (translated) break;
        }
      } catch {}
      await sleep(350 * (attempt + 1));
    }
    fallbackOut.push(translated || t);
  }
  return fallbackOut;
}

async function deeplBatchTranslate(texts) {
  if (!DEEPL_KEY) return null;
  try {
    const r = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        Authorization: 'DeepL-Auth-Key ' + DEEPL_KEY,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        text: texts,
        source_lang: 'EN',
        target_lang: 'TR',
        split_sentences: 'nonewlines',
        preserve_formatting: true,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.translations && j.translations.length === texts.length) {
      return j.translations.map((x) => x.text);
    }
  } catch {}
  return null;
}

async function translateChunk(texts, prevContext, glossary, volSlug, { force = false } = {}) {
  const prepared = texts.map(normalizeWhisperBraces);
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ v: 2, texts: prepared }))
    .digest('hex')
    .slice(0, 28);
  const chunkCacheFile = path.join(ensureDir(path.join(CACHE_DIR, `vol_${volSlug || '4'}`)), `${hash}.json`);

  if (!force && fs.existsSync(chunkCacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(chunkCacheFile, 'utf8'));
      if (Array.isArray(cached) && cached.length === texts.length) {
        return cached.map((t) => refineLiteraryTurkish(t, glossary));
      }
    } catch {}
  }

  let rawTranslations = null;
  const hasLlmKey = Boolean(
    process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY
  );

  if (hasLlmKey) {
    try {
      rawTranslations = await translateChunkViaLlm(prepared, prevContext, glossary);
    } catch (err) {
      console.warn(`  [llm uyarı] API çağrısı yedek motora devredildi: ${err.message}`);
    }
  }

  if (!rawTranslations) {
    rawTranslations = (await deeplBatchTranslate(prepared)) || (await googleBatchTranslate(prepared));
  }

  const refined = rawTranslations.map((tr) => refineLiteraryTurkish(tr, glossary));
  fs.writeFileSync(chunkCacheFile, JSON.stringify(refined));
  return refined;
}

async function translateChaptersJson(volCfg, glossary) {
  if (!fs.existsSync(volCfg.titlesFile)) return;
  const meta = JSON.parse(fs.readFileSync(volCfg.titlesFile, 'utf8'));
  if (!Array.isArray(meta.chapters) || !meta.chapters.length) return;

  const FIXED_TR = {
    Illustrations: 'İllüstrasyonlar',
    İllüstrasyonlar: 'İllüstrasyonlar',
    Prologue: 'Prolog',
    Epilogue: 'Epilog',
    Afterword: 'Sonsöz',
    Interlude: 'Ara Bölüm',
  };

  const toTranslate = [];
  const indices = [];

  meta.chapters.forEach((ch, idx) => {
    const srcTitle = String(ch.enTitle || ch.title || '').trim();
    if (!srcTitle || FIXED_TR[srcTitle]) {
      if (FIXED_TR[srcTitle]) ch.title = FIXED_TR[srcTitle];
      return;
    }
    if (/^Chapter\s+(\d+)$/i.test(srcTitle)) {
      ch.title = 'Bölüm ' + srcTitle.match(/\d+/)[0];
      return;
    }
    toTranslate.push(srcTitle);
    indices.push(idx);
  });

  if (toTranslate.length) {
    const trList = await translateChunk(toTranslate, [], glossary, `${volCfg.slug}_titles`);
    indices.forEach((chIdx, k) => {
      let cleanTitle = trList[k]
        .replace(/^[“"]+|[”"]+$/g, '')
        .replace(/\.$/, '')
        .trim();
      meta.chapters[chIdx].title = cleanTitle || meta.chapters[chIdx].enTitle;
    });
  }

  meta.titles = {};
  for (const ch of meta.chapters) {
    meta.titles[String(ch.startPage)] = ch.title;
  }

  fs.writeFileSync(volCfg.titlesFile, JSON.stringify(meta, null, 2));
}

async function polishExistingVolume(volCfg) {
  const glossary = loadGlossary();
  const data = JSON.parse(fs.readFileSync(volCfg.finalFile, 'utf8'));
  const { KNOWN_PAGE_SPLIT_QUOTES } = require('./qc/cli');
  const knownSplit = (KNOWN_PAGE_SPLIT_QUOTES && KNOWN_PAGE_SPLIT_QUOTES[volCfg.key]) || new Set();

  let changed = 0;
  for (const [pg, arr] of Object.entries(data)) {
    if (!Array.isArray(arr)) continue;
    data[pg] = arr
      .map((t, i) => {
        const preserveOddQuotes = knownSplit.has(`${pg}.${i}`);
        const next = refineLiteraryTurkish(t, glossary, { preserveOddQuotes });
        if (next !== t) changed++;
        return next;
      })
      .filter(Boolean);
  }
  fs.writeFileSync(volCfg.finalFile, JSON.stringify(data));
  console.log(`✓ Cilt ${volCfg.key} edebî cila tamamlandı: ${changed} paragraf iyileştirildi (${volCfg.finalRel}).`);
}

async function translateVolume(volKey, opts = {}) {
  const volCfg = resolveVolume(volKey);
  if (!volCfg) throw new Error(`Bilinmeyen cilt: ${volKey}`);

  if (opts.polishOnly) {
    return polishExistingVolume(volCfg);
  }

  if (!fs.existsSync(volCfg.sourceFile)) {
    throw new Error(`Kaynak dosya bulunamadı: ${volCfg.sourceFile} (önce ingest çalıştırın)`);
  }

  const glossary = loadGlossary();
  const sourcePages = JSON.parse(fs.readFileSync(volCfg.sourceFile, 'utf8'));
  const finalOut = {};
  const pageEntries = [];

  for (const p of sourcePages) {
    const key = String(p.page);
    if (p.pending || !p.text || !String(p.text).trim()) {
      finalOut[key] = [];
      continue;
    }
    const paras = extractSourceParagraphs(p.text);
    finalOut[key] = new Array(paras.length).fill('');
    paras.forEach((txt, idx) => {
      pageEntries.push({ pageKey: key, paraIdx: idx, text: txt });
    });
  }

  const CHUNK_SIZE = 16;
  const chunks = [];
  for (let i = 0; i < pageEntries.length; i += CHUNK_SIZE) {
    chunks.push(pageEntries.slice(i, i + CHUNK_SIZE));
  }

  const hasLlmKey = Boolean(
    process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY
  );
  const concurrency = opts.concurrency || (hasLlmKey ? 3 : 8);

  console.log(
    `\n=== Cilt ${volCfg.key} Çevirisi Başlatıldı ===\n` +
      `  Sayfa: ${sourcePages.length} | Paragraf: ${pageEntries.length} | Parça: ${chunks.length} | Motor: ${
        hasLlmKey ? 'LLM API' : DEEPL_KEY ? 'DeepL + Edebî Türkçe Editör' : 'Parçalı Çeviri + Edebî Türkçe Editör'
      }`
  );

  // LLM anahtarı varsa kayan bağlam penceresi için sıralı/düşük eşzamanlı, aksi halde yüksek verimli önbellekli havuz
  let completedChunks = 0;
  let cursor = 0;
  let rollingContext = [];

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, chunks.length)) }, async () => {
    while (true) {
      const cIdx = cursor++;
      if (cIdx >= chunks.length) break;
      const chunk = chunks[cIdx];
      const texts = chunk.map((x) => x.text);
      const ctxSnap = rollingContext.slice(-3);
      const translated = await translateChunk(texts, ctxSnap, glossary, volCfg.slug || '4', opts);
      rollingContext = translated.slice(-3);

      chunk.forEach((item, k) => {
        finalOut[item.pageKey][item.paraIdx] = translated[k];
      });

      completedChunks++;
      if (completedChunks % 15 === 0 || completedChunks === chunks.length) {
        process.stdout.write(`  ilerleme: ${completedChunks}/${chunks.length} parça tamamlandı\r`);
      }
    }
  });

  await Promise.all(workers);
  if (chunks.length) process.stdout.write('\n');

  // Boş kalan satırları temizle
  for (const k of Object.keys(finalOut)) {
    finalOut[k] = finalOut[k].map((x) => String(x || '').trim()).filter(Boolean);
  }

  ensureDir(path.dirname(volCfg.finalFile));
  fs.writeFileSync(volCfg.finalFile, JSON.stringify(finalOut));

  // Bölüm başlıklarını Türkçeye çevir
  await translateChaptersJson(volCfg, glossary);

  const totalParas = Object.values(finalOut).reduce((a, b) => a + b.length, 0);
  console.log(`✓ Cilt ${volCfg.key} çevirisi yazıldı: ${totalParas} paragraf -> ${volCfg.finalRel}`);
  return finalOut;
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
      console.log('Kullanım: node scripts/translate_llm.js --volume <v> [--concurrency N] [--force] [--polish-only]');
      process.exit(0);
    }

    const volKey = parseVolumeArg(args, '4');
    const concIdx = args.indexOf('--concurrency');
    const concurrency = concIdx > -1 && args[concIdx + 1] ? Number(args[concIdx + 1]) : undefined;
    const force = args.includes('--force');
    const polishOnly = args.includes('--polish-only');

    try {
      await translateVolume(volKey, { concurrency, force, polishOnly });
    } catch (err) {
      console.error(`✗ Cilt ${volKey} çeviri hatası:`, err.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  CHARACTER_VOICE_GUIDE,
  extractSourceParagraphs,
  normalizeWhisperBraces,
  refineLiteraryTurkish,
  translateVolume,
};
