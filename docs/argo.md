# Argo / Sertlik Sadakati

Kaynak metindeki küfür ve argonun çeviride yumuşatılmadan karşılanmasını denetler.
Çeviri ilkesi: **birebir ve kaliteli** — küfür, argo ve fan service sahneleri
olduğu gibi aktarılır; "velet / yaramaz / serseri" gibi yumuşatmalar kullanılmaz.

## Kullanım

```bash
npm run argo                       # özet: yumuşatılmış sayfalar
node scripts/qc/argo.js --vol 4    # cilt bazlı
node scripts/qc/argo.js --vol 4 --page 216   # tek sayfa dökümü (EN argo + TR paragraflar)
node scripts/qc/argo.js --check    # kapı: yumuşatma varsa çıkış kodu 1
```

`npm test` içinde `--check` çalışır. Kapı **ağır hakaret** (bastard/bitch/fuck/cunt/
asshole/slut/whore/dick/prick) açığına bakar ve **0** olmalıdır. `shit/crap/bullshit/
damn/hell` gibi hafif küfürler yalnızca **not** olarak listelenir: "What the hell" →
"Bu da ne…", "crap" → "Hay aksi" gibi doğal karşılıklar yumuşatma sayılmaz.

## Eşleştirme

- **EN sert argo**: bastard, bitch, fuck(ing), shit(ty), bullshit, asshole, dick, prick,
  slut, whore, crap, son of a bitch, jackass, dumbass, piss. `(TN: …)` notları sayılmaz.
- **TR kabul edilen karşılıklar**: piç, orospu, sürtük, kaltak, şıllık, fahişe, şerefsiz,
  sik/siktir/sikindirik, bok/boktan, göt, yavşak, pislik, dallama, gerizekalı, embesil,
  aptal, salak, hıyar, manyak, sapık, azgın, lanet, kahretsin, cehennem, lan/ulan, sıçtık…
- **Zayıf (yumuşatma) işaretleri**: velet, yaramaz, haylaz, afacan, şımarık, edepsiz,
  terbiyesiz, utanmaz, arsız, densiz, küstah, çapkın, kaba.
- Türkçe ek aldığı için kök eşleşmesi kullanılır (`hıyar` → `hıyarın`).
- Anatomik `ass` sayılmaz (kalça çevirisi doğrudur); yalnızca `asshole/dumbass` sayılır.

## Nüans: her küfür tek karşılıkla çevrilmez

| Kaynak | Karşılıklar (bağlama göre) |
|---|---|
| bastard | piç · şerefsiz · alçak · herif |
| dick | hıyar · pislik · herif |
| fucking | sikindirik · kahrolası · lanet olası · düpedüz |
| cunt | orospu · orospu çocuğu (ağır hakaret) |
| bullshit | boktan bahane · palavra · zırva · saçmalık |
| cheat (ilişki) | sahtekâr · düzenbaz |
| shit / crap | bok · kahretsin · zırva |
| damn fucking … | **lanet siktiriboktan …** (damn=lanet, fucking=siktiriboktan, birebir) |
| cheat / deceiver | sahtekâr · düzenbaz · aldatıcı (ilişki bağlamında) |
| victim mentality | mağdur edebiyatı · kurban psikolojisi |

Kural: **sertlik korunur, doğallık bozulmaz**. Aynı sayfada aynı küfür hep aynı
sözcükle karşılanmaz; konuşanın tonuna ve cümlenin ritmine göre seçilir. Denetim
"yumuşatma" arar — sertlik eşdeğeri olan doğal karşılıklar geçerlidir
(`kahrolası`, `lanet olası`, `zırva`, `palavra`, `düpedüz` sayılır).

## Düzeltilen örnekler

| Kaynak | Eski | Yeni |
|---|---|---|
| "Don't run away, you bastard!" | Kaçma, seni velet! | Kaçma, seni piç! |
| "You wicked bastard…" | Seni alçak herif… | Seni şerefsiz piç… |
| "a bit of a dick" | biraz gıcığın teki | biraz hıyarın teki |
| "you fucking virgin" | kahrolası bir bakire | sikindirik bir bakire |
| "That bald cunt!" | O kel pislik! | O kel orospu! |
| "your damn fucking fault" | kahrolası hatan | siktiriboktan hatan |
| "Don't give me that shit!" | Bana bu saçmalığı söyleme! | Bana bok yedirme! |

## Kural: kaynağa sadakat

- Küfür **birebir** çevrilir: kaynakta "damn fucking" varsa çeviride de iki ayrı
  küfür karşılığı bulunur (`lanet siktiriboktan`), biri düşürülmez.
- Kaynakta olmayan kültürel ekleme yapılmaz ("Allah'ın belası", "anası ağlayacak"
  gibi ifadeler **yasak**; bunlar kaynakta yok).
- **Büyük harf**: kaynak ALL CAPS değilse çeviri de büyük harf kullanmaz. Örn.
  İngilizce `No…` → `Hayır…` (HAYIR değil); yalnızca gerçek bağırma
  ("ABSOLUTELY FUCKING NOT") büyük harfle kalır.
- Bu iki kural `npm test` içinde `scripts/qc/caps.js --check` ve
  `scripts/qc/argo.js --check` ile ölçülür.
