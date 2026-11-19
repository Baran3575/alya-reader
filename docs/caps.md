# Büyük Harf Sadakati

Kural: **kaynakta ALL CAPS yoksa çeviride de büyük harf yoktur.** Türkçe çeviride
vurgu için büyük harfe kaçmak, metne sadakati bozar ve okumayı sertleştirir.

## Araç

```
node scripts/qc/caps.js          # rapor
node scripts/qc/caps.js --check  # kapı (npm test içinde)
node scripts/qc/caps.js --md     # docs/caps-review.md üret
```

Ölçüt: TR paragrafta geçen 2+ harfli büyük harf öbeği; kaynak sayfada hiç ALL CAPS
yoksa kusur sayılır. Kaynakta vurgu varsa (örn. `ABSOLUTELY FUCKING NOT`) sayfa
bütünüyle muaftır. Kısaltmalar (ABD, DSÖ, MVP, VIP, USB, NTR, TL, 4WD …) muaftır.

## Düzeltilen örnekler

| Cilt | Sayfa | Önce | Şimdi | Kaynak |
|---|---|---|---|---|
| 5 | 131 | `“HAYIR…”` | `“Hayır…”` | `“No...”` |
| 5 | 231 | `HAYIR!` | `Hayır!` | `No, ...` |
| 6 | 82, 138 | `HAYIR.` | `Hayır.` | `"No."` |
| 7 | 267 | `HAYIR.` | `Hayır.` | `No.` |
| 8 | 100, 174 | `“…HAYIR.”` | `“…Hayır.”` | `“…No.”` |
| 9 | 73 | `HAYIR!` | `Hayır!` | `No!` |
| 9 | 87, 114 | `“BEN-”` | `“Ben-”` | `“I-”` |
| 10 | 15 | `’BEN’?` | `’Ben’?` | `’I’?` |
| 10 | 56 | `“HAYIR…!”` | `“Hayır…!”` | `“No...!”` |
| 10 | 240 | `BEN` | `Ben` | `I` |
| 11 | 208 | `“BENCE…!”` | `“Ben…!”` | `“I…!”` |
| 12 | 39 | `{HAYIR…}` | `{Hayır…}` | `“No...”` |

Toplam **17 paragraf** düzeltildi, kalan kusur **0**.

## Korunanlar

Kaynakta gerçekten bağırma olan yerler büyük harf kalır:

- C9 s.159 `“CİDDİ OLARAK, NE BEKLİYORSUNUZ!?”` ← `SERIOUSLY, WHAT THE HELL ARE YOU EXPECTING!?`
- C10 s.30 `“SENİ ÖLDÜRECEĞİM!”` ← `I’LL KILL YOU!!!`
- C9.5 s.175 `GÖZLERİM!` ← `EYES!!`
- C9.5 s.94–95 `SİZ`, `ETMEMENİZİ`, `KENDİNİZİ DEĞİŞTİRİN` ← `YOU`, `NOT`, `CHANGE YOURSELF`
