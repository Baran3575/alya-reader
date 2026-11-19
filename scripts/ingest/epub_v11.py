#!/usr/bin/env python3
"""
Google Drive Cilt 11 EPUB (Roshidere, Vol. 11 - Glucose Translations.epub) çevrimdışı XHTML ayrıştırıcısı.
- Spine sırasını (Kapak + Renkli Görseller + Önsöz + Bölüm 1–8 + Sonsöz + Yazarın Sonsözü) izler.
- Çevirmen notu / Discord tanıtım sayfalarını (TitlesAndCredits, AboutTheTranslators, Contents, TLNote) atlar.
- Paragrafları ve satır içi gömülü illüstrasyonları okuma sırasıyla data11/source.json ve public/art/v11/*.webp olarak çıkarır.
"""
import html
import io
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data11"
ART_DIR = ROOT / "public" / "art" / "v11"
DEFAULT_EPUB = Path("/tmp/vol11.epub")
GDRIVE_FILE_ID = "14rf2EZmMiMrmg6bAvWtYOLrgw9VvZf0r"
GDRIVE_DOWNLOAD_URL = (
    f"https://drive.usercontent.google.com/download?id={GDRIVE_FILE_ID}&export=download&confirm=t"
)

SKIP_XHTML = {
    "TitlesAndCredits.xhtml",
    "AboutTheTranslators.xhtml",
    "Contents.xhtml",
    "TLNote.xhtml",
}

SKIP_IMAGES = {
    "Discord invite.png",
    "Discord invite 2.png",
    "freedom.jpg",
}


def ensure_epub(epub_path: Path) -> Path:
    if epub_path.exists() and epub_path.stat().st_size > 1_000_000:
        return epub_path
    print(f"[EPUB v11] Google Drive üzerinden indiriliyor -> {epub_path}")
    req = urllib.request.Request(GDRIVE_DOWNLOAD_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        epub_path.write_bytes(resp.read())
    return epub_path


def save_webp(img_bytes: bytes, out_path: Path) -> bool:
    im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    w, h = im.size
    max_dim = 1350
    if max(w, h) > max_dim:
        scale = max_dim / float(max(w, h))
        im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    im.save(out_path, "WEBP", quality=78, method=6)
    return True


def local_tag(tag: str) -> str:
    return tag.split("}", 1)[-1].lower()


def extract_text(elem) -> str:
    raw = "".join(elem.itertext())
    clean = html.unescape(raw).replace("\xa0", " ")
    clean = re.sub(r"\[\d+\]", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def find_imgs_in_elem(elem) -> list[str]:
    found = []
    for sub in elem.iter():
        t = local_tag(sub.tag)
        if t == "img":
            src = sub.attrib.get("src", "")
            if src:
                found.append(src)
        elif t == "image":
            for k, v in sub.attrib.items():
                if k.endswith("href") and v:
                    found.append(v)
    return found


def chapter_meta_for_xhtml(fname: str) -> dict | None:
    if fname == "Prologue.xhtml":
        return {"key": "Prologue", "label": "Önsöz", "title": "A United Front"}
    m = re.match(r"Chapter(\d+)\.xhtml$", fname, re.I)
    if m:
        num = m.group(1)
        return {"key": f"Chapter {num}", "label": f"Bölüm {num}", "title": f"Chapter {num}"}
    if fname == "Epilogue.xhtml":
        return {"key": "Epilogue", "label": "Sonsöz", "title": "A Joint Battle"}
    if fname == "Afterword.xhtml":
        return {"key": "Afterword", "label": "Sonsöz Notu", "title": "Author’s Afterword"}
    return None


def main():
    epub_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_EPUB
    epub_path = ensure_epub(epub_arg)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ART_DIR.mkdir(parents=True, exist_ok=True)

    source = []
    unit_no = 0
    art_map = {}
    art_counter = 0

    with zipfile.ZipFile(epub_path) as zf:
        opf_xml = ET.fromstring(zf.read("OEBPS/content.opf"))
        ns = {"opf": "http://www.idpf.org/2007/opf"}
        manifest = {}
        for item in opf_xml.findall(".//opf:manifest/opf:item", ns):
            manifest[item.attrib["id"]] = urllib.parse.unquote(item.attrib["href"])

        spine_hrefs = []
        for itemref in opf_xml.findall(".//opf:spine/opf:itemref", ns):
            href = manifest.get(itemref.attrib["idref"], "")
            if href:
                spine_hrefs.append(href)

        def register_art(rel_img_src: str) -> str | None:
            nonlocal art_counter
            img_base = urllib.parse.unquote(rel_img_src).split("/")[-1]
            if img_base in SKIP_IMAGES:
                return None
            if img_base in art_map:
                return art_map[img_base]
            zip_member = f"OEBPS/Images/{img_base}"
            if zip_member not in zf.namelist():
                return None
            art_counter += 1
            out_name = f"{art_counter:03d}.webp"
            save_webp(zf.read(zip_member), ART_DIR / out_name)
            art_map[img_base] = out_name
            return out_name

        front_art_started = False

        for href in spine_hrefs:
            fname = href.split("/")[-1]
            if fname in SKIP_XHTML:
                continue

            raw_xhtml = zf.read(f"OEBPS/{href}").decode("utf-8", errors="replace")
            # XML ayrıştırma öncesi hatalı yorum satırını temizle
            raw_xhtml = re.sub(r"<!--\?xml[^>]*\?-->", "", raw_xhtml)
            root = ET.fromstring(raw_xhtml)
            body = None
            for el in root.iter():
                if local_tag(el.tag) == "body":
                    body = el
                    break
            if body is None:
                continue

            # Kapak ve ön renkli illüstrasyon sayfaları
            if fname == "cover.xhtml" or fname.startswith("InsertImage"):
                for src in find_imgs_in_elem(body):
                    out_name = register_art(src)
                    if not out_name:
                        continue
                    unit_no += 1
                    entry = {
                        "page": unit_no,
                        "img": out_name,
                        "thumb": out_name,
                        "text": "",
                        "art": True,
                        "chapterNative": True,
                    }
                    if not front_art_started:
                        entry["chapter"] = {
                            "key": "Illustrations",
                            "label": "Görseller",
                            "title": "Cover and Illustrations",
                        }
                        front_art_started = True
                    source.append(entry)
                continue

            ch_meta = chapter_meta_for_xhtml(fname)
            first_in_chapter = ch_meta is not None
            text_buf = []

            def flush_text():
                nonlocal unit_no, first_in_chapter, text_buf
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
                if first_in_chapter and ch_meta:
                    entry["chapter"] = ch_meta
                    first_in_chapter = False
                source.append(entry)
                text_buf = []

            def walk_blocks(node):
                nonlocal unit_no, first_in_chapter
                for child in list(node):
                    tg = local_tag(child.tag)
                    if tg in ("aside", "nav"):
                        continue
                    # Dipnot açıklamalarını atla
                    el_id = child.attrib.get("id", "")
                    if re.match(r"^(?:fn|note|footnote)", el_id, re.I):
                        continue

                    imgs = find_imgs_in_elem(child) if tg != "body" else []
                    if tg in ("p", "h1", "h2", "h3", "blockquote"):
                        if imgs:
                            flush_text()
                            for s in imgs:
                                out_name = register_art(s)
                                if out_name:
                                    unit_no += 1
                                    entry = {
                                        "page": unit_no,
                                        "img": out_name,
                                        "thumb": out_name,
                                        "text": "",
                                        "art": True,
                                        "chapterNative": True,
                                    }
                                    if first_in_chapter and ch_meta:
                                        entry["chapter"] = ch_meta
                                        first_in_chapter = False
                                    source.append(entry)
                        if tg in ("h1", "h2"):
                            # Bölüm başlığı zaten chapter meta içinde yer alır
                            continue
                        txt = extract_text(child)
                        if txt and not re.match(r"^(?:TN:|TL\s*Note:|Fan[- ]translated by)", txt, re.I):
                            text_buf.append(txt)
                    elif tg in ("img", "svg", "figure"):
                        all_i = [child.attrib.get("src", "")] if tg == "img" else find_imgs_in_elem(child)
                        flush_text()
                        for s in [x for x in all_i if x]:
                            out_name = register_art(s)
                            if out_name:
                                unit_no += 1
                                entry = {
                                    "page": unit_no,
                                    "img": out_name,
                                    "thumb": out_name,
                                    "text": "",
                                    "art": True,
                                    "chapterNative": True,
                                }
                                if first_in_chapter and ch_meta:
                                    entry["chapter"] = ch_meta
                                    first_in_chapter = False
                                source.append(entry)
                    elif tg in ("div", "section", "article"):
                        walk_blocks(child)

            walk_blocks(body)
            flush_text()

    out_file = DATA_DIR / "source.json"
    out_file.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_paras = sum(len([x for x in u["text"].split("\n") if x.strip()]) for u in source if not u["art"])
    print(f"✓ data11/source.json yazıldı: {len(source)} birim | {total_paras} paragraf | {art_counter} illüstrasyon")


if __name__ == "__main__":
    main()
