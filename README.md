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
npm test                                               # tüm birim/entegrasyon testleri + 11 cilt sıkı QC kapısı
node scripts/qc/cli.js --strict --check-regression     # tüm ciltler için sıkı kalite ve regresyon kontrolü
node scripts/patch.js --dry-run                        # el yaması şema ve regresyon doğrulaması
```
