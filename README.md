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
