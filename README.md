# Alya Bazen Duygularını Rusça Saklar — Cilt 4 – 12 (Türkçe Web Okuyucu)

Japon light novel serisi *Alya Sometimes Hides Her Feelings in Russian* (*Roshidere*) için **Cilt 4, 4.5, 5, 6, 7, 8, 9, 9.5, 10, 11 ve 12**’yi (toplam 11 cilt) temiz illüstrasyonlar ve edebî Türkçe çeviriyle sunan sade, çevrimdışı destekli web okuyucu.

## Çalıştırma

```bash
node server.js          # http://localhost:3000 (sıfır harici npm bağımlılığı)
PORT=4000 node server.js
```

Tembel yüklenen cilt JSON paketlerini ve GitHub Pages statik sitesini derlemek için:

```bash
npm run build           # public/bundles/{manifest,vol-*,bundle-en-*}.json ve public/art/ çıktılarını üret
npm run build:site      # dist/ altında statik site (.nojekyll + bundles/ + art/) üret ve doğrula
```

### Çevrimdışı okuma ve tembel yüklenen paketler

`volumes.json` ve `scripts/volumes.js`, Cilt `4` ile `12` arasındaki tüm 11 cildi tek merkezden yönetir.
`scripts/build_bundle.js` aktif her cilt için Türkçe metin parçalarını, ayrı İngilizce kaynak parçalarını ve ikili `.webp` illüstrasyonları üretir:

| Dosya | İçerik |
|---|---|
| `volumes.json` | Cilt `4`–`12` kayıt defteri, sıkı QC eşikleri ve yama yolları |
| `public/bundles/manifest.json` | Aktif cilt listesi, sayfa/bölüm sayıları, Türkçe ve İngilizce içerik özetleri (`?v=<hash>`) |
| `public/bundles/vol-<slug>.json` | İlgili cildin `p.en` arındırılmış Türkçe sayfa ve bölüm verisi (varsayılan **Çeviri** modunda yüklenir) |
| `public/bundles/bundle-en-<slug>.json` | İlgili cildin ayrı İngilizce kaynak paragrafları (yalnız **Orijinal** moduna geçildiğinde tembel yüklenir) |
| `public/art/vol-<slug>/NNN.webp` | Bağımsız ikili `.webp` illüstrasyon görselleri |

Okuyucu başlangıçta yalnızca `manifest.json` ve seçili cildin `vol-<slug>.json` parçasını indirir (**Çeviri** modunda hiçbir İngilizce parça indirilmez); kullanıcı **Orijinal** görünümüne geçtiğinde ilgili cildin `bundle-en-<slug>.json` parçası talep üzerine indirilir. `localStorage` yalnız okuma ilerlemesini ve tercihleri (`< 2 KB`) saklar. `public/sw.js` Service Worker’ı kabuğu, hem `vol-*` hem `bundle-en-*` JSON parçalarını ve `.webp` görsellerini Cache Storage’a yazar.

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
| **Cilt 4 & 4.5** | Kanonik depo arşivi | Salt okunur kaynak katmanı + bağımsız WebP sanat paketi |
| **Cilt 5 – 10** | `fliphtml5.js` | FlipHTML5 & AnyFlip `search_config.js` metin dizini (Scribd Fastly ve WASM `deString.js` atlanır, katalog URL’leri normalize edilir) + GlucoseTL arşivlerinden filigransız WebP illüstrasyonlar |
| **Cilt 9.5** | `glucosetl95.js` | GlucoseTL Anubis SHA-256 PoW (`difficulty: 4`) çözümü + 7 renkli illüstrasyon + 16 kısa hikâye PNG klasörünün görsel LLM / yerel Tesseract OCR dökümü (~1.400 kr/sayfa) |
| **Cilt 11** | `epub11.js` | Google Drive EPUB paketi (22 XHTML + gömülü illüstrasyonlar, ~1.400 kr/sayfa) |
| **Cilt 12** | `secreftls12.js` | SecreFTLs REST API (`Illustrations`, `Prologue`, `Chapter 1` tam çeviri + `Chapter 2` `[Translation In Progress]` için uydurma metin üretmeden `pending: true` durumu) |

## Sürekli Doğrulama ve Kalite Kapısı (QC)

Pull request ve push işlemlerinde `.github/workflows/qc-matrix.yml` aktif tüm ciltleri paralel matris içinde doğrular (`ortalama puan <= 0.20`, düz tırnak `0`, çevirmen notu `0`, İngilizce kalıntı `0`, kapanmamış tırnak `0`, sayısal sayfa anahtarları `^\d+$`). Ana dala (`main`/`master`) yapılan push işlemlerinde `.github/workflows/deploy-pages.yml` statik okuyucuyu GitHub Pages’e yayınlar.

```bash
npm test                                               # tüm birim/entegrasyon testleri + 11 cilt sıkı QC kapısı
node scripts/qc/cli.js --strict --check-regression     # tüm ciltler için sıkı kalite ve regresyon kontrolü
node scripts/patch.js --dry-run                        # el yaması şema ve regresyon doğrulaması
```

### Arayüz

- Üst çubuk tek satır: yerel **Cilt seçici** (`<select id="volSelect">`) + **bölüm/cilt çekmecesi** (`#chBtn` → `#libView`) kombinasyonu · Çeviri/Orijinal · tema. Yazı boyutu düğmeleri kaldırıldı, metin sabit boyutta.
- Bölüm düğmesine dokununca sayfa içi çekmece/kütüphane (`#libView`) açılır: bölümlerde **bölüm adı + sayfa aralığı**, `‹ Ciltler` görünümünde tüm 11 cilt için bölüm ve okundu sayısı, `Kapat` ile okumaya dönüş; çekmece açıkken üstteki `<select>` değiştiğinde ilgili cildin bölüm listesi anında güncellenir.
- Okundu sistemi elle: her bölüm satırındaki ✓ ile işaretlenir (`alya4:read:<cilt>`), "Hepsini okundu say" / "İşaretleri temizle" düğmeleri vardır. Otomatik işaretleme yok.
- Alt çubuk: ‹ › düğmeleri, bölüm adı, sayfa aralığı, kaydırıcı. Görsele dokununca tam ekran.
