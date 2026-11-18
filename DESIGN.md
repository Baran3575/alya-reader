# DESIGN.md — Alya Reader

Sessiz, kitap gibi bir okuma arayüzü. Amaç: dikkat dağıtmayan tipografi, koyu tema varsayılan, tek sütun metin, illüstrasyonların metin akışına gömülmesi.

## 1. Marka ve ton

- **Kişilik:** sakin, edebî, hafif sıcak; "uygulama" değil "kitap" hissi.
- **Ses:** Türkçe, kısa ve sade etiketler (`Çeviri`, `Orijinal`, `İçindekiler`, `Bölüm sonu`).
- **Kaçınılacak:** parlak renkler, gradyanlar, gölgeli butonlar, ikon kalabalığı, modal pencereler.

## 2. Renk sistemi

| Rol | Dark (varsayılan) | Light |
|---|---|---|
| `--bg` | `#121110` (mürekkep) | `#fbf9f5` (kâğıt) |
| `--bg-soft` | `#191817` | `#f3efe8` |
| `--fg` | `#e9e5df` | `#1e1c19` |
| `--fg-soft` | `#b6b0a7` | `#4a463f` |
| `--muted` | `#8b857c` | `#7d776d` |
| `--line` | `#2a2825` | `#e4ded4` |
| `--accent` | `#c9a227` (pirinç/sarı) | `#9a6b12` |

- Vurgu rengi **yalnızca** ilerleme çubuğu, aktif bölüm işareti ve odak halkası için. Metinde vurgu yok.
- Metin/arka plan kontrastı en az 4.5:1; `--muted` yalnızca ikincil bilgi (sayfa numarası, yüzde).

## 3. Tipografi

- Gövde: sistem sans (`system-ui`), okuma boyu `1.06rem` → kullanıcı `0.9–1.45rem` arası ayarlar.
- Satır yüksekliği **1.72**, paragraf arası `0.95em`, ilk satır girintisi yok (blok aralığı tercih edilir).
- Metin ölçüsü (measure) `--maxw: 34rem` — 60–70 karakter.
- Bölüm başlığı `h1`: 1.35rem, harf aralığı hafif daraltılmış, altında ince çizgi.
- Diyalog paragrafları sola hizalı, tırnak işaretiyle başlar; italik iç ses `{…}` biçiminde.

## 4. Düzen

- Tek sütun, ortalanmış; üstte 2px ilerleme şeridi, altta sabit gezinme çubuğu.
- Bölüm = tek kesintisiz kaydırma; sayfa kırıkları görünmez, sayfa görselleri akış içine gömülür.
- İllüstrasyon: tam genişlik, `max-height: 52vh` (görsel+metin sayfalarında) veya `calc(100vh - 230px)` (yalnız görsel), 8px köşe, yumuşak gölge; tıklayınca yakınlaştırma.
- Orijinal (tek sayfa) modunda sayfa görseli ortada, altında `← s. 74 · 75 / 282 · s. 76 →` şeridi.
- Boşluk ölçeği: 4 / 8 / 12 / 18 / 28 / 44 px.

## 5. Bileşenler

- **Üst şerit:** ilerleme çubuğu + `%NN` sayacı (yalnız sayı, etiket yok).
- **Bölüm başlığı bloğu:** kicker (`Bölüm 3`) + başlık + meta (`Sayfa 72–100 · 29 sayfa`).
- **Alt bar:** `‹` / bölüm adı + sayfa aralığı / `›`, tek satır, 44px dokunma hedefi.
- **İçindekiler çekmecesi:** satır başına bölüm adı + `s. 47–71`; aktif satır vurgu renginde nokta ile.
- **Butonlar:** hayalet (ghost) stil — 1px `--line` çerçeve, dolgu yok, `border-radius: 999px`.
- **Bölüm sonu:** ortalanmış `— Bölüm sonu —` + tek satır "Sonraki: Bölüm 4 · …" bağlantısı.

## 6. Etkileşim ve hareket

- Geçişler 0.18–0.25s ease; kaydırma animasyonsuz.
- Klavye: `←/→` gezinme, `t` tema, `v` mod, `Esc` çekmeceyi kapat.
- Dokunma: yatay kaydırma eşiği 70px, dikey baskınsa yoksay.
- Odak halkası: 2px `--accent`, `:focus-visible`.

## 7. Erişilebilirlik

- Dokunma hedefleri ≥ 40px; `aria-expanded` içindekiler düğmesinde.
- Sayfa görselleri `alt="Sayfa N"`.
- Hareket azaltma tercihinde geçişler kapatılır.
