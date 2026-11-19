#!/usr/bin/env python3
"""
SecreFTLs Cilt 12 çevrimdışı içe aktarma adaptörü.
Kaynak:
  https://secreftls.com/collections/standalone/alya-sometimes-hides-her-feelings-in-russian-volume-12
API:
  https://secreftls.com/api/books/alya-sometimes-hides-her-feelings-in-russian-volume-12/chapters?per_page=50

Özellikler:
- Yayımlanmış bölümleri (İllüstrasyonlar, Önsöz, Bölüm 1 vb.) metin ve satır içi görsel sırasını koruyarak
  data12/source.json dosyasına bölüm-yerel (chapter-native) şemada yazar.
- "[Translation In Progress]" yer tutucusu içeren tamamlanmamış bölümleri (ör. Bölüm 2) otomatik olarak atlar;
  okuyucuya hiçbir boş veya yarım yer tutucu bölüm sızmaz.
- Görselleri optimize edilmiş WebP olarak public/art/v12/ dizinine kaydeder.
"""
from html.parser import HTMLParser
import html
import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data12"
ART_DIR = ROOT / "public" / "art" / "v12"
SITE_ORIGIN = "https://secreftls.com"
API_URL = f"{SITE_ORIGIN}/api/books/alya-sometimes-hides-her-feelings-in-russian-volume-12/chapters?per_page=50"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

WIP_RE = re.compile(r"\[\s*Translation\s+In\s+Progress\s*\]", re.I)
CHAPTER_END_RE = re.compile(r"^\[\s*Chapter\s+End\s*\]$", re.I)
PROMO_RE = re.compile(
    r"(Join our Discord|Ko-fi|Patreon|secreftls\.com|DO NOT reupload)",
    re.I,
)


class ChapterBodyParser(HTMLParser):
    BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self._buf = []
        self._in_block = 0

    def _flush_buf(self):
        if not self._buf:
            return
        txt = html.unescape("".join(self._buf))
        self._buf = []
        txt = re.sub(r"[ \t\r\f\v\u00a0]+", " ", txt).strip()
        if not txt:
            return
        if CHAPTER_END_RE.match(txt) or PROMO_RE.search(txt):
            return
        self.items.append(("text", txt))

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        attr_map = dict(attrs)
        if t in self.BLOCK_TAGS:
            if self._in_block == 0:
                self._flush_buf()
            self._in_block += 1
        elif t == "br":
            if self._buf:
                self._buf.append(" ")
        elif t == "hr":
            self._flush_buf()
            self.items.append(("text", "* * *"))
        elif t == "img":
            self._flush_buf()
            src = (attr_map.get("src") or "").strip()
            if src:
                self.items.append(("img", src))

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self.BLOCK_TAGS:
            if self._in_block > 0:
                self._in_block -= 1
            if self._in_block == 0:
                self._flush_buf()

    def handle_data(self, data):
        if data:
            self._buf.append(data)

    def close(self):
        super().close()
        self._flush_buf()


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def resolve_img_url(src: str) -> str:
    if src.startswith("http://") or src.startswith("https://"):
        parsed = urllib.parse.urlsplit(src)
        quoted_path = urllib.parse.quote(urllib.parse.unquote(parsed.path), safe="/")
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, quoted_path, parsed.query, ""))
    rel = "/" + src.lstrip("/")
    quoted = urllib.parse.quote(urllib.parse.unquote(rel), safe="/")
    return SITE_ORIGIN + quoted


def save_webp(img_bytes: bytes, out_path: Path) -> bool:
    try:
        im = Image.open(io.BytesIO(img_bytes))
        gray = im.convert("L")
        if ImageStat.Stat(gray).stddev[0] < 4.0:
            return False
        rgb = im.convert("RGB")
        w, h = rgb.size
        max_dim = 1350
        if max(w, h) > max_dim:
            scale = max_dim / float(max(w, h))
            rgb = rgb.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        rgb.save(out_path, "WEBP", quality=78, method=6)
        return True
    except Exception:
        return False


def parse_chapter_meta(raw_title: str, slug: str, idx: int) -> tuple[str, str, str]:
    title = re.sub(r"\s+", " ", (raw_title or "").strip())
    if slug == "illustrations" or title.lower() == "illustrations":
        return "Illustrations", "Görseller", "Illustrations"

    m = re.match(r"^Prologue(?:\s*[-:–—]\s*(.*))?$", title, re.I)
    if m:
        return "Prologue", "Önsöz", (m.group(1) or "Prologue").strip()

    m = re.match(r"^Chapter\s+(\d+)(?:\s*[-:–—]\s*(.*))?$", title, re.I)
    if m:
        num = m.group(1)
        sub = (m.group(2) or f"Chapter {num}").strip()
        return f"Chapter {num}", f"Bölüm {num}", sub

    m = re.match(r"^Epilogue(?:\s*[-:–—]\s*(.*))?$", title, re.I)
    if m:
        return "Epilogue", "Sonsöz", (m.group(1) or "Epilogue").strip()

    m = re.match(r"^Afterword(?:\s*[-:–—]\s*(.*))?$", title, re.I)
    if m:
        return "Afterword", "Sonsöz Notu", (m.group(1) or "Afterword").strip()

    return slug or f"Part {idx}", f"Bölüm {idx}", title or f"Bölüm {idx}"


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ART_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[SecreFTLs 12] Bölüm listesi indiriliyor: {API_URL}")
    payload = json.loads(fetch_bytes(API_URL).decode("utf-8"))
    chapters = payload.get("data", payload)
    chapters = sorted(chapters, key=lambda c: (c.get("chapter_weight", 0), c.get("id", 0)))

    source = []
    unit_no = 0
    art_no = 0
    saved_by_src = {}

    for idx, ch in enumerate(chapters):
        raw_title = ch.get("chapter_title") or ""
        slug = ch.get("chapter_slug") or ""
        body_html = ch.get("body") or ""

        if WIP_RE.search(body_html) or WIP_RE.search(raw_title):
            print(f"  ⏭ Atlandı ([Translation In Progress]): {raw_title}")
            continue

        parser = ChapterBodyParser()
        parser.feed(body_html)
        parser.close()

        # İllüstrasyon galerisinde hayran renklendirmelerini ([Fan Colored]) ve galeri alt başlıklarını ayıkla
        items = []
        for kind, val in parser.items:
            if slug == "illustrations" and kind == "text":
                if re.match(r"^\[\s*Fan\s+Colored\s*\]$", val, re.I):
                    break
                if re.match(r"^(?:\[\s*Monochrome\s+Illustrations\s*\]|Art\s+by\b)", val, re.I):
                    continue
            items.append((kind, val))
        if not items and ch.get("images"):
            for im_obj in sorted(ch["images"], key=lambda x: x.get("order", 0)):
                u = im_obj.get("url") or ""
                if u:
                    items.append(("img", u))

        if not items:
            print(f"  ⏭ Atlandı (içerik yok): {raw_title}")
            continue

        ch_key, ch_label, ch_sub = parse_chapter_meta(raw_title, slug, idx)
        first_unit_in_chapter = True
        text_buf = []

        def flush_text():
            nonlocal unit_no, first_unit_in_chapter, text_buf
            if not text_buf:
                return
            unit_no += 1
            entry = {
                "page": unit_no,
                "img": "",
                "thumb": "",
                "text": "\n".join(text_buf),
                "art": False,
                "chapterNative": True,
            }
            if first_unit_in_chapter:
                entry["chapter"] = {"key": ch_key, "label": ch_label, "title": ch_sub}
                first_unit_in_chapter = False
            source.append(entry)
            text_buf = []

        ch_para_cnt = 0
        ch_art_cnt = 0

        for kind, val in items:
            if kind == "text":
                text_buf.append(val)
                ch_para_cnt += 1
            elif kind == "img":
                flush_text()
                full_url = resolve_img_url(val)
                if full_url in saved_by_src:
                    img_name = saved_by_src[full_url]
                else:
                    try:
                        img_bytes = fetch_bytes(full_url)
                    except Exception as e:
                        print(f"    ! Görsel indirilemedi ({full_url}): {e}")
                        continue
                    art_no += 1
                    candidate_name = f"{art_no:03d}.webp"
                    if save_webp(img_bytes, ART_DIR / candidate_name):
                        img_name = candidate_name
                        saved_by_src[full_url] = img_name
                    else:
                        art_no -= 1
                        continue

                unit_no += 1
                ch_art_cnt += 1
                entry = {
                    "page": unit_no,
                    "img": img_name,
                    "thumb": img_name,
                    "text": "",
                    "art": True,
                    "chapterNative": True,
                }
                if first_unit_in_chapter:
                    entry["chapter"] = {"key": ch_key, "label": ch_label, "title": ch_sub}
                    first_unit_in_chapter = False
                source.append(entry)

        flush_text()
        print(f"  ✓ [{ch_key}] {raw_title}: {ch_para_cnt} paragraf | {ch_art_cnt} görsel")

    out_file = DATA_DIR / "source.json"
    out_file.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_paras = sum(len([x for x in u["text"].split("\n") if x.strip()]) for u in source if not u["art"])
    print(f"✓ data12/source.json yazıldı: {len(source)} birim | {total_paras} paragraf | {art_no} benzersiz görsel")


if __name__ == "__main__":
    main()
