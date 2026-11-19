# Alya Bazen Duygularını Rusça Saklar — Cilt 4 (Türkçe okuyucu)

FlipHTML5 üzerindeki 282 sayfalık Cilt 4 taraması, Google Translate ile sayfa sayfa
Türkçeye çevrildi. Site, çeviriyi ve orijinal sayfa görselini birlikte sunan sade bir
okuyucudur.

## Çalıştırma

```bash
cd ~/alya-reader
node server.js        # http://localhost:3000
```

Farklı port: `PORT=4000 node server.js`

## Yapı

```
server.js              bağımlılıksız HTTP sunucusu (API + statik dosyalar, gzip)
data/source.json       sayfa görsel adları + İngilizce metin katmanı
data/bilingual.json     paragraf başına DeepL + Google çevirisi
data/paragraphs_final.json  sitede gösterilen nihai Türkçe metin
data/glossary.json      isim/terim sözlüğü
data/chapters.json     bölüm başlıklarının Türkçesi
public/index.html      arayüz
public/style.css       tema (koyu varsayılan, açık tema destekli)
public/app.js          okuyucu mantığı
public/pages/NNN.webp  282 sayfa görseli
scripts/translate.js    sayfa bazlı çeviri (ilk sürüm)
scripts/translate2.js   paragraf bazlı Google çevirisi (eski sürüm)
scripts/translate3.js   DeepL + Google çift çeviri (kullanılan sürüm)
scripts/merge.js        iki motoru birleştirir + sözlük/noktalama düzeltmesi
scripts/fix_headings.js bölüm başlıklarını ilk paragraftan temizler
```

### Çeviri metinleri (analiz için başlangıç noktası)

| Dosya | İçerik |
|---|---|
| `data/paragraphs_final.json` | **Cilt 4 Türkçe çeviri** — `{ "sayfa": ["paragraf", ...] }`, 282 sayfa, 3.083 paragraf |
| `data45/paragraphs_final.json` | **Cilt 4.5 Türkçe çeviri** — 347 sayfa, 2.294 paragraf |
| `data5/paragraphs_final.json` | **Cilt 5 Türkçe çeviri** — 275 sayfa, 3.134 paragraf |
| `data6/paragraphs_final.json` | **Cilt 6 Türkçe çeviri** — 278 sayfa, 3.391 paragraf |
| `data*/source.json` | İngilizce kaynak katmanı (salt okunur) |
| `data*/chapters.json` | Bölüm başlıklarının Türkçesi |
| `scripts/qc/quality.js` | paragraf kalite puanlayıcı: `node scripts/qc/quality.js data/paragraphs_final.json --top 25` |
| `scripts/qc/verify.js` | imla/noktalama denetimi (`ALYA_TR_FILE` ile dosya seçilir) |
| `scripts/qc/cli.js` | birleşik kalite kapısı (`--volume <4\|4.5\|5\|6>`, `--strict`, `--check-regression`, `--json`, `--update-baseline`) |
| `scripts/patch.js` | yama doğrulama ve uygulama (`--dry-run` ile regresyon kontrolü) |
| `scripts/naturalize.js` | deterministik doğallaştırma: `--context-only` / `--dry` |
| `scripts/norm_typo.js` | dizgi normalizasyonu (noktalama yığılması, tilde, harf uzatma) |
| `scripts/fix_boundaries.js` | sayfa sınırı onarımı, OCR çöpü ayıklama |

Kalite ölçütleri: akıcı edebî Türkçe, kalıp ifade/edilgen zinciri yok, kaynak tonu korunur (küfür yumuşatılmaz), özel adlar tutarlı (Masachika, Kuze, Alisa/Alya, Maria/Masha), kıvrık tırnak, çevirmen notu/İngilizce kalıntı yok.

### Sürekli doğrulama ve GitHub Pages dağıtımı (GitHub Actions)

Pull request ve push işlemlerinde `.github/workflows/qc-matrix.yml` dört cildi (`4`, `4.5`, `5`, `6`) paralel matris içinde doğrular:
`scripts/patch.js --dry-run` + `scripts/qc/cli.js --volume <cilt> --strict --check-regression`. Taban çizgisi `data/qc_baseline.json`
(Cilt 4: ortalama 0.04 / 0 bayrak; Cilt 4.5: 0.09 / 0 bayrak; Cilt 5: 0.07 / 0 bayrak; Cilt 6: 0.05 / 0 bayrak).

`master`/`main` dalına yapılan push işlemlerinde `.github/workflows/pages.yml` kalite testlerini çalıştırır, `node scripts/build_bundle.js` ile statik paketi üretir ve `public/` dizinini GitHub Pages'e dağıtır.

Yerel çalıştırma:

```bash
npm test                             # test paketi + birleşik QC regresyon kapısı (4 cilt)
node scripts/qc/cli.js               # tüm ciltler (4, 4.5, 5, 6)
node scripts/qc/cli.js --volume 5 --strict
node scripts/qc/cli.js --volume 6 --strict
node scripts/patch.js --dry-run      # yama şeması ve regresyon önizlemesi
```

### Statik (GitHub Pages) ve sunucusuz (çevrimdışı) okuma

`scripts/build_bundle.js` dört cildin Türkçe + İngilizce metnini ve illüstrasyon görsellerini
statik dosyalara paketler:

| Dosya | İçerik |
|---|---|
| `public/books/<cilt>.json` | GitHub Pages / HTTP üzerinde hızlı tek-cilt yükleme için cilt bazlı JSON + `books/index.json` |
| `public/bundle.js` | `window.ALYA_BUNDLE` — `file://` ve çevrimdışı yedek için birleşik veri paketi |
| `public/bundle-art.js` | `window.ALYA_ART` — Cilt 4 ve 4.5'in 31 illüstrasyonu (`data:image/webp;base64`), Cilt 5 ve 6 illüstrasyonları ise `public/pages5/` ve `public/pages6/` altındadır |

Okuyucu veriyi şu sırayla bulur: **localStorage** (`alya4:book:<cilt>`) → gömülü paket → `/api/book`.
Yani ilk açılıştan sonra sunucu kapalı olsa da, hatta `index.html` doğrudan `file://` ile açılsa da okuma sürer.
`public/sw.js` service worker'ı kabuğu, sayfa görsellerini ve `/api/book` yanıtlarını Cache Storage'a yazar.

```bash
node scripts/build_bundle.js   # metin/EN/görsel değişince yeniden üret
```

## Özellikler

- Koyu / açık tema (t), sistem temasına göre başlar
- Çeviri ve Orijinal (görsel) modu (v)
- Bölüm seçici: Önsöz, 10 bölüm, Sonsöz
- Ok tuşları / j-k ile sayfa geçişi, mobilde kaydırma
- Okunduğu yer, tema ve yazı boyutu tarayıcıda hatırlanır
- Görsel sayfalarda çeviri yerine orijinal sayfa gösterilir, görsele dokununca yakınlaşır

## Notlar

- Metin, taramadaki gizli metin katmanından alındı; bozuk çıkan birkaç sayfa
  (kapak, bazı görseller) otomatik olarak "görsel sayfa" kabul edilir.
- Çeviri **DeepL** (birincil) + **Google Translate** (yedek/karşılaştırma) ile yapıldı;
  isim ve terimler `data/glossary.json` sözlüğüyle tek yazıma çekildi.
- `data/bilingual.json` her paragrafın iki motor çevirisini saklar (ileride motor değiştirmek için).
