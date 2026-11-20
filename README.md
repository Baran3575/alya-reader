# Alya Bazen Duygularını Rusça Saklar — Cilt 4 – 12 (Türkçe Web Okuyucu)

Japon light novel serisi *Alya Sometimes Hides Her Feelings in Russian* (*Roshidere*) için **Cilt 4, 4.5, 5, 6, 7, 8, 9, 9.5, 10, 11 ve 12**’yi (toplam 11 cilt) temiz illüstrasyonlar ve edebî Türkçe çeviriyle sunan sade, çevrimdışı destekli web okuyucu.

## Çalıştırma

```bash
node server.js          # http://localhost:3000 (sıfır harici npm bağımlılığı)
PORT=4000 node server.js
```

Statik GitHub Pages paketini derlemek için:

```bash
npm run build:site      # dist/ altında statik site (.nojekyll + bundle.js + pages* + books/*.json)
```

## Modüler İçe Aktarma ve Edebî Çeviri Hattı

```bash
# 1. Cilt kaynak metnini ve temiz WebP illüstrasyonlarını çek
node scripts/ingest/cli.js --volume <5|6|7|8|9|9.5|10|11|12>

# 2. Sözlük, karakter sesi ve Rusça fısıltı ({...}) bağlamıyla edebî Türkçeye çevir
node scripts/translate_llm.js --volume <4..12>

# 3. Son işleme ve sıkı kalite kapısı (QC)
node scripts/fix_headings.js --volume <4..12>
node scripts/naturalize.js --volume <4..12>
node scripts/norm_typo.js --volume <4..12>
node scripts/fix_boundaries.js --volume <4..12>
node scripts/qc/cli.js --volume <4..12> --strict --check-regression
```

### Kaynak Adaptörleri (`scripts/ingest/adapters/`)

| Cilt | Kaynak Adaptörü | Açıklama |
|---|---|---|
| **Cilt 4 & 4.5** | Kanonik depo arşivi | Salt okunur kaynak katmanı + gömülü WebP sanat paketi |
| **Cilt 5 – 10** | `fliphtml5.js` | FlipHTML5 & AnyFlip `search_config.js` metin dizini (Scribd Fastly ve WASM `deString.js` atlanır, katalog URL’leri normalize edilir) + GlucoseTL arşivlerinden filigransız WebP illüstrasyonlar |
| **Cilt 9.5** | `glucosetl95.js` | GlucoseTL Anubis SHA-256 PoW (`difficulty: 4`) çözümü + 7 renkli illüstrasyon + 16 kısa hikâye PNG klasörünün görsel LLM / yerel Tesseract OCR dökümü (~1.400 kr/sayfa) |
| **Cilt 11** | `epub11.js` | Google Drive EPUB paketi (22 XHTML + gömülü illüstrasyonlar, ~1.400 kr/sayfa) |
| **Cilt 12** | `secreftls12.js` | SecreFTLs REST API (`Illustrations`, `Prologue`, `Chapter 1` tam çeviri + `Chapter 2` `[Translation In Progress]` için uydurma metin üretmeden `pending: true` durumu) |

## Sürekli Doğrulama ve Kalite Kapısı (QC)

Pull request ve push işlemlerinde `.github/workflows/qc-matrix.yml` 11 cildin tamamını paralel matris içinde doğrular (`ortalama puan <= 0.20`, düz tırnak `0`, çevirmen notu `0`, İngilizce kalıntı `0`, kapanmamış tırnak `0`, sayısal sayfa anahtarları `^\d+$`). Ana dala (`main`/`master`) yapılan push işlemlerinde `.github/workflows/deploy-pages.yml` statik okuyucuyu GitHub Pages’e yayınlar.

```bash
npm test                                               # tüm birim/entegrasyon testleri + sadakat kapısı + 11 cilt sıkı QC
node scripts/qc/cli.js --strict --check-regression     # tüm ciltler için sıkı kalite ve regresyon kontrolü
npm run fidelity                                       # metne sadakat raporu (cilt ortalamaları + en kötü sayfalar)
npm run deep                                           # bölüm bazlı derin denetim (kelime seçimi, gramer, noktalama, ani düşüş)
npm run fix:style -- --dry                             # yazım/noktalama onarımı (deneme), --vol 4 ile tek cilt
npm run clean                                          # nesnel kusur taraması -> docs/clean-list.md (0 olmalı)
npm run argo            # argo/sertlik sadakati: kaynak küfür çeviride yumuşatılmış mı
npm run fix:dialog                                     # sayfa sonunda yarım kalan replikleri birleştirir
npm run fix:quotes                                     # iç içe alıntı açılışlarını onarır
npm run fidelity -- --vol 4 --top 12 --md              # tek cilt, en kötü 12 sayfa, docs/fidelity.md üret
node scripts/patch.js --dry-run                        # el yaması şema ve regresyon doğrulaması
```

### Metne Sadakat (`scripts/qc/fidelity.js`)

Her sayfa kaynak İngilizce metinle yapısal olarak karşılaştırılır: diyalog satırı sayısı
(`“ ”` / `『 』`), Rusça `{…}` / `【…】` blokları, özel adlar, sayılar, TR/EN kelime oranı ve
paragraf oranı. 100 = yapı birebir; `<70` inceleme, `<45` kelime oranı içerik atlandığı anlamına
gelir. `test/fidelity.test.js` bu eşikleri `npm test` içinde zorunlu kılar:

| Kural | Eşik |
|---|---|
| Cilt ortalaması | ≥ 80 |
| Tek sayfa puanı | ≥ 30 |
| TR/EN kelime oranı | ≥ 0.45 (OCR çöpü olan sayfalarda atlanır) |

Elle çeviri yaparken kural: **kaynak sayfadaki her diyalog satırı ve her anlatım beat’i
karşılanmalı**; iki konuşma tek paragrafta birleştirilmez, cümle atlanmaz, özetlenmez.

### Arayüz

- Üst çubuk tek satır: **Cilt 4** · bölüm adı · Çeviri/Orijinal · tema. Yazı boyutu düğmeleri kaldırıldı, metin sabit boyutta.
- Cilt ya da bölüm düğmesine dokununca alttan liste açılır: ciltlerde bölüm/okundu sayısı, bölümlerde **bölüm adı + sayfa aralığı**.
- Okundu sistemi elle: her bölüm satırındaki ✓ ile işaretlenir (`alya4:read:<cilt>`), "Hepsini okundu say" / "İşaretleri temizle" düğmeleri vardır. Otomatik işaretleme yok.
- Alt çubuk: ‹ › düğmeleri, bölüm adı, sayfa aralığı, kaydırıcı. Görsele dokununca tam ekran.

Bölüm bölüm ilerleme (sayfa sayfa değil):

```
npm run chapter                        # bölüm bazlı kalite tablosu
npm run next                           # sıradaki sorunlu bölüm
node scripts/qc/deep.js --vol 4 --bolum 8
node scripts/qc/argo.js --vol 10 --bolum "Bölüm 8"
node scripts/qc/caps.js --vol 9 --bolum 3
node scripts/qc/clean.js --vol 4 --bolum 8
```

Ayrıntı: `docs/chapters.md`

## Orijinal (EN) görünüm: OCR yok, çoklu kaynak + metin yedeği

Sıra: **yerel/PDF taraması → flipbook (iframe) → kaynak metin → kart**.
Flipbook açılmazsa her sayfada **"Metni göster"** düğmesi kaynak (EN) metni açar; metin hiçbir ciltte kaybolmaz.

Kaynak listesi tek dosyada: **`data/sources.json`** (`{ label, url, embed }`).

| Cilt | Sayfa görüntüsü | Diğer kaynaklar |
|---|---|---|
| 4 | `pages/` 282 tarama | — |
| 4.5 | `pages45/` 347 tarama | — |
| 5 | `pages5/scan/` 278 PDF sayfası | FlipHTML5 · Scribd · AnyFlip |
| 6 | `pages6/scan/` 278 PDF sayfası | FlipHTML5 · Scribd · AnyFlip |
| 7 | `pages7/scan/` 287 PDF sayfası | FlipHTML5 · Scribd · AnyFlip |
| 8 | `pages8/scan/` 285 PDF sayfası | FlipHTML5 · Scribd · AnyFlip |
| 9 | `pages9/scan/` 270 PDF sayfası | FlipHTML5 · Scribd · AnyFlip |
| 9.5 | illüstrasyonlar | kaynak metin (Glucose) |
| 10 | `pages10/scan/` 272 PDF sayfası | FlipHTML5 · Scribd · AnyFlip |
| 11 | `pages11/scan/` 281 PDF sayfası | Google Drive klasörü |
| 12 | illüstrasyonlar (1500 px) | SecreFTLs cilt + illüstrasyonlar; metin |

Tarama hizalaması: `data<N>/scan_map.json`, her kitap sayfası PDF'te kendi sayfasına eşlenir
(`node scripts/align_scan.js --vol N --pdf-text ... --count ...`). PDF → WebP: `scripts/pdf2webp.py`.
Kaynak PDF'ler: Cilt 5–7 `archive.org/details/roshidere-vol.-1234567`, Cilt 8–9
`archive.org/details/roshidere-vol.-8-glucose-translations_202411`, Cilt 10
`archive.org/details/roshidere-vol.-10-glucose-translations_202609`, Cilt 11 (Drive).

- Cilt 11 taramaları: Drive'daki `Roshidere, Vol. 11 - Glucose Translations.pdf` (281 s.) indirilip
  `scripts/pdf2webp.py` ile WebP'ye çevrildi; her kitap sayfası kendi PDF sayfasına hizalandı
  (monoton eşleme, 312/312 sayfa dolu).
- API: `sources`, `flip`, `source`, `scan`, `pages[].hasImg`, `pages[].scan` (tam sayfa tarama yolu).
- `VOL_ORDER` = `4 · 4.5 · 5 · 6 · 7 · 8 · 9 · 9.5 · 10 · 11 · 12`.

