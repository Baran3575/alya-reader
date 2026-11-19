# Alya Bazen Duygularını Rusça Saklar — Türkçe Okuyucu (Cilt 4 – 12)

Roshidere (*Alya Sometimes Hides Her Feelings in Russian*) hafif roman serisinin **Cilt 4, 4.5, 5, 6, 7, 8, 9, 9.5, 10, 11 ve 12** çevirilerini, illüstrasyonlarını ve sayfa taramalarını sunan bağımlılıksız, çevrimdışı uyumlu Türkçe web okuyucusu.

## Desteklenen Ciltler ve Kaynak Formatları

| Cilt | Format | Durum | Kaynak Dizin / Görseller |
|---|---|---|---|
| **Cilt 4** | Sayfa taraması (FlipHTML5) | Tamamlandı | `data/` · `public/pages/` · `public/art/v4/` |
| **Cilt 4.5** | Sayfa taraması (FlipHTML5) | Tamamlandı | `data45/` · `public/pages45/` · `public/art/v45/` |
| **Cilt 5 – 9** | Sayfa taraması (FlipHTML5) | Tamamlandı | `data5/`..`data9/` · `public/art/v5/`..`v9/` |
| **Cilt 9.5** | Bölüm-yerel (GlucoseTL) | Tamamlandı | `data95/` · `public/art/v95/` |
| **Cilt 10** | Sayfa taraması (FlipHTML5) | Tamamlandı | `data10/` · `public/art/v10/` |
| **Cilt 11** | Bölüm-yerel (EPUB) | Tamamlandı | `data11/` · `public/art/v11/` |
| **Cilt 12** | Bölüm-yerel (SecreFTLs) | **Devam Ediyor** | `data12/` · `public/art/v12/` |

> **Not:** Bölüm-yerel (*chapter-native*) ciltlerde (**9.5, 11, 12**) taranmış sayfa görüntüsü bulunmadığı için arayüzdeki **Orijinal** sayfa görünümü düğmesi otomatik olarak gizlenir; metin içi illüstrasyonlar tam genişlikte kartlar halinde gösterilir. **Cilt 12** çevirisi kaynakta devam ettiği için yalnızca yayımlanmış bölümler dahil edilir (`[Translation In Progress]` yer tutucuları otomatik atlanır).

## Çalıştırma

```bash
node server.js        # http://localhost:3000
```

Farklı port: `PORT=4000 node server.js`

## Mimari ve Dosya Yapısı

```
server.js                      bağımlılıksız HTTP sunucusu (/api/catalog, /api/book, /volumes/<cilt>.json)
data*/source.json              kaynak metin ve görsel katmanı (salt okunur)
data*/paragraphs_final.json    yayında gösterilen edebî Türkçe metin
data*/chapters.json            Türkçe bölüm başlıkları
data/glossary.json             tüm ciltler için ortak özel ad ve terim sözlüğü
data/qc_baseline.json          cilt bazlı kalite puanı ve bayrak taban çizgisi
public/bundle.js               hafif katalog bildirimi (window.ALYA_CATALOG, ~2 KB)
public/volumes/<cilt>.json     cilt bazlı tembel yüklenen (lazy-loaded) statik veri paketleri
public/art/v<cilt>/*.webp      optimize edilmiş WebP illüstrasyonlar
scripts/volumes.js             11 cildin merkezi yapılandırması ve URL normalleştiricisi
scripts/ingest/fliphtml5.js    FlipHTML5 WASM config çözücü + görsel/metin içe aktarıcı (Cilt 5–10)
scripts/ingest/glucosetl_v95.py GlucoseTL Anubis PoW + OCR/görsel içe aktarıcı (Cilt 9.5)
scripts/ingest/epub_v11.py     EPUB XHTML + illüstrasyon içe aktarıcı (Cilt 11)
scripts/ingest/secreftls_v12.py SecreFTLs API içe aktarıcı, yarım bölümleri atlar (Cilt 12)
scripts/translate3.js          --volume destekli DeepL + Google çift motorlu çeviri boru hattı
scripts/merge.js               --volume destekli birleştirme, sözlük ve tipografi normalizasyonu
scripts/polish_volume.js       edebî Türkçe doğallaştırma ve sıfır tolerans kalite onarımı
```

## Kalite Kapısı ve Testler

Pull request ve push işlemlerinde `.github/workflows/qc-matrix.yml` 11 cildin tamamını paralel matris içinde doğrular:

```bash
npm test                                                  # tüm birim testleri + 11 cilt sıkı QC kapısı
node scripts/qc/cli.js --strict --check-regression        # tüm ciltlerde sıfır tolerans + regresyon kontrolü
node scripts/qc/cli.js --volume 12 --strict               # tek cilt kontrolü
node scripts/patch.js --dry-run                           # Cilt 4 yama regresyon önizlemesi
```

## Statik Paketleme ve GitHub Pages Dağıtımı

`node scripts/build_bundle.js` komutu her cildi `public/volumes/<cilt>.json` altına ayrı JSON dosyası olarak yazar ve `public/bundle.js` içine yalnızca hafif katalog bildirimini (`~2 KB`) gömer. Böylece ilk açılış anında yalnızca aktif cilt indirilir; hem `https://baran3575.github.io/alya-reader/` alt dizininde hem de yerel sunucuda aynı hızda çalışır.

`.github/workflows/deploy-pages.yml` iş akışı `main` / `master` dalına yapılan her gönderimde:
1. `npm test` ile 11 cildin kalite kapısını doğrular,
2. `node scripts/build_bundle.js` ile statik paketleri üretir,
3. `public/` dizinini (`public/.nojekyll` dahil) GitHub Pages'e otomatik olarak dağıtır.
