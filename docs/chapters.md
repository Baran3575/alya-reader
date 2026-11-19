# Bölüm Bölüm İlerleme

İnceleme artık **sayfa sayfa değil, bölüm bölüm** yürür. Bölüm haritası
`public/books/v<cilt>.json` içindeki `chapters` alanından okunur
(`label` + `title` + başlangıç `page`).

## Komutlar

```
npm run chapter                 # tüm ciltlerde bölüm bazlı özet tablo
npm run chapter -- --vol 4      # tek cilt
npm run next                    # sıradaki sorunlu bölüm
node scripts/qc/chapter.js --md # docs/chapter-review.md üretir
```

Sütunlar: sayfa aralığı, sadakat ortalaması, en düşük sayfa, `<70` sayfa sayısı,
kelime toplamı, kısa sayfa sayısı.

## Araçlara bölüm filtresi

Tüm denetim araçları `--bolum` (veya `--chapter`) alır:

```
node scripts/qc/deep.js    --vol 4 --bolum 8      # Bölüm 8: üslup/gramer/noktalama
node scripts/qc/argo.js    --vol 10 --bolum "Bölüm 8"
node scripts/qc/caps.js    --vol 9 --bolum 3
node scripts/qc/clean.js   --vol 4 --bolum 8
node scripts/qc/fidelity.js --vol 4              # sayfa bazlı (bozmadık)
```

`--bolum` değeri şunlardan biri olabilir: `8` (Bölüm 8), `Bölüm 8`, `Sonsöz`,
`Önsöz`, ya da başlığın bir parçası (`Deliryum`).

## İş akışı (bölüm bazlı)

1. `npm run next` → sıradaki sorunlu bölümü söyler.
2. `node scripts/qc/deep.js --vol X --bolum N` → bölümün kusur listesi.
3. `node scripts/qc/argo.js --vol X --bolum N` → bölümde küfür sadakati.
4. Düzeltmeler `data/textfix.json` + `scripts/text_patch.js` ile.
5. `node scripts/fix_quality.js --vol X` → `npm test` → `npm run build:bundle`.

Bölüm bitmeden sonraki bölüme geçilmez; böylece "ani düşüş" tek tek bölüm
içinde yakalanır ve ilerleme raporu bölüm bazında okunur.
