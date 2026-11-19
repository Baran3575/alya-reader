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

`npm test` içinde `--check` çalışır; yumuşatılmış sayfa sayısı **0** olmalıdır.

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
