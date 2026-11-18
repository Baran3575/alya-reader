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
| `data/paragraphs_final.json` | **Cilt 4 Türkçe çeviri** — `{ "sayfa": ["paragraf", ...] }`, 282 sayfa, 3.045 paragraf |
| `data45/paragraphs_final.json` | **Cilt 4.5 Türkçe çeviri** — 347 sayfa, 2.281 paragraf |
| `data/source.json`, `data45/source.json` | İngilizce kaynak katmanı |
| `data/chapters.json`, `data45/chapters.json` | Bölüm başlıkları + sayfa aralıkları |
| `scripts/qc/quality.js` | paragraf kalite puanlayıcı: `node scripts/qc/quality.js data/paragraphs_final.json --top 25` |
| `scripts/qc/verify.js` | imla/noktalama denetimi (`ALYA_TR_FILE` ile dosya seçilir) |
| `scripts/qc/cli.js` | birleşik kalite kapısı (`--volume 4`, `--strict`, `--check-regression`, `--json`, `--update-baseline`) |
| `scripts/patch.js` | yama doğrulama ve uygulama (`--dry-run` ile regresyon kontrolü) |
| `scripts/naturalize.js` | deterministik doğallaştırma: `--context-only` / `--dry` |
| `scripts/norm_typo.js` | dizgi normalizasyonu (noktalama yığılması, tilde, harf uzatma) |
| `scripts/fix_boundaries.js` | sayfa sınırı onarımı, OCR çöpü ayıklama |

Kalite ölçütleri: akıcı edebî Türkçe, kalıp ifade/edilgen zinciri yok, kaynak tonu korunur (küfür yumuşatılmaz), özel adlar tutarlı (Masachika, Kuze, Alisa/Alya, Maria/Masha), kıvrık tırnak, çevirmen notu/İngilizce kalıntı yok.

### Sürekli doğrulama (GitHub Actions)

Pull request ve push işlemlerinde `.github/workflows/qc-matrix.yml` iki cildi paralel matris içinde doğrular:
`scripts/patch.js --dry-run` + `scripts/qc/cli.js --volume <cilt> --strict --check-regression`. Taban çizgisi `data/qc_baseline.json`
(Cilt 4: ortalama 0.15 / 24 bayrak; Cilt 4.5: 0.27 / 53). Kapı kırmızıysa çeviri bozulmuştur.

Yerel çalıştırma:

```bash
npm test                             # test paketi + birleşik QC regresyon kapısı
node scripts/qc/cli.js               # iki cilt
node scripts/qc/cli.js --volume 4 --strict
node scripts/qc/cli.js --volume 4.5 --strict
node scripts/patch.js --dry-run      # yama şeması ve regresyon önizlemesi
```

### Sunucusuz (çevrimdışı) okuma

`scripts/build_bundle.js` iki cildin Türkçe + İngilizce metnini ve **illüstrasyon görsellerini**
tarayıcı paketine gömer:

| Dosya | İçerik | Boyut |
|---|---|---|
| `public/bundle.js` | `window.ALYA_BUNDLE` — iki cildin sayfa/paragraf/EN verisi + bölüm listesi | ~1,5 MB |
| `public/bundle-art.js` | `window.ALYA_ART` — 31 illüstrasyon, `data:image/webp;base64` olarak gömülü | ~4,0 MB |

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
