#!/usr/bin/env python3
"""
Glucose Translations Cilt 9.5 ("Behind The Scenes") çevrimdışı Playwright + OCR içe aktarma adaptörü.
- https://glucosetl.xyz/translations/roshidere/behind-the-scenes adresindeki Anubis PoW korumasını aşar.
- İçindekiler listesindeki tüm bölümleri (İllüstrasyonlar + 16 kısa hikâye) sırayla gezer.
- Hem metin paragraflarını (<p>) hem de anti-scraper görsel metin bloklarını (Google Drive PNG + Tesseract)
  ve gerçek illüstrasyonları (public/art/v95/*.webp) bölüm-yerel (chapter-native) şemada data95/source.json'a yazar.
"""
import concurrent.futures
import io
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path
from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data95"
ART_DIR = ROOT / "public" / "art" / "v95"
BASE_URL = "https://glucosetl.xyz/translations/roshidere/behind-the-scenes"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

PROMO_RE = re.compile(
    r"(Join our Discord|affiliated with a new Roshidere fandom Discord|take the time to read this document|"
    r"Regarding this issue, if you care about our translations|updates for this volume will be slow|"
    r"DO NOT reupload our chapters|support the author by buying|glucosetranslations@gmail\.com|"
    r"^TL:\s|^ED:\s|^PR:\s)",
    re.I,
)


def fetch_bytes(url: str) -> bytes:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.read()
    except Exception:
        return b""


def ocr_image_bytes(img_bytes: bytes) -> str:
    env = os.environ.copy()
    env["OMP_THREAD_LIMIT"] = "1"
    proc = subprocess.run(
        ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "6"],
        input=img_bytes,
        capture_output=True,
        env=env,
    )
    txt = proc.stdout.decode("utf-8", errors="replace")
    # Dijital fontta tek başına "|" olarak okunan "I" zamirlerini düzelt
    txt = re.sub(r"(?<![A-Za-z])\|(?![A-Za-z])", "I", txt)
    txt = re.sub(r"([“\"‘'])\|", r"\1I", txt)
    txt = re.sub(r"\|([’'](?:m|ll|ve|d|re)\b)", r"I\1", txt)
    return txt


SHORT_VALID_WORDS = {
    "a", "i", "am", "an", "as", "at", "be", "by", "do", "go", "ha", "he", "hi",
    "hm", "if", "in", "is", "it", "me", "mr", "ms", "my", "no", "of", "oh", "oi",
    "ok", "on", "or", "ow", "so", "to", "tv", "uh", "um", "up", "us", "vs", "we",
}


def is_ocr_noise_line(ln: str) -> bool:
    s = ln.strip()
    if not s:
        return True
    # Sayfa numarası veya süs yıldızlarının OCR yanlış okumaları
    if re.match(r"^\d{1,3}$", s):
        return True
    if re.match(r"^(?:atk|ayn)(?:\s*\d+)?$", s, re.I):
        return True
    # Dipnot / çevirmen notu satırları
    if re.match(r"^\[\d+\]\s*:", s) or re.search(r"\bTN\s*:", s) or "literally translating to" in s:
        return True
    noise_syms = len(re.findall(r"[\\{}|<>¥©@=^]", s)) + max(0, s.count("/") - 1)
    if noise_syms >= 2:
        return True
    tokens = [re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", t) for t in s.split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return False
    valid = sum(
        1
        for t in tokens
        if (re.match(r"^[A-Za-z][A-Za-z’'\-]{2,}$", t) or t.lower() in SHORT_VALID_WORDS or re.match(r"^\d+(?:st|nd|rd|th|s|%)?$", t))
    )
    if len(tokens) >= 4 and (valid / len(tokens)) < 0.60:
        return True
    if len(tokens) <= 3 and valid == 0 and not re.search(r"[.!?…~]", s):
        return True
    return False


def strip_inline_ocr_tail(joined: str) -> str:
    # Karma görsel+metin bloklarında cümlenin sonuna veya başına yapışan çizim gürültüsünü temizle
    parts = re.split(r"(?<=[.!?…])\s+", joined)
    kept = [p for p in parts if not is_ocr_noise_line(p)]
    out = " ".join(kept).strip()
    # Başta kalmış olabilecek sembol gürültüsünü temizle
    out = re.sub(r"^(?:[^A-Za-z“\"‘'\[]*\s+){2,}(?=[A-Z“\"‘'\[])", "", out).strip()
    return out


def clean_ocr_paragraphs(raw_text: str) -> list[str]:
    blocks = re.split(r"\n\s*\n", raw_text.replace("\r\n", "\n"))
    paras = []
    for b in blocks:
        raw_lines = [ln.strip() for ln in b.split("\n") if ln.strip()]
        lines = []
        for ln in raw_lines:
            if re.match(r"^(?:atk|ayn)(?:\s*\d+)?$", ln, re.I):
                lines.append("* * *")
            elif not is_ocr_noise_line(ln):
                lines.append(ln)
        if not lines:
            continue
        joined = re.sub(r"\s+", " ", " ".join(lines)).strip()
        # Tire ile satır sonu bölünmelerini birleştir (ör. "stu- dent" -> "student", ama "Vice—" korunsun)
        joined = re.sub(r"([a-z])-\s+([a-z])", r"\1\2", joined)
        joined = strip_inline_ocr_tail(joined)
        if not joined or PROMO_RE.search(joined) or is_ocr_noise_line(joined):
            continue
        paras.append(joined)
    return paras


def save_webp(img_bytes: bytes, out_path: Path) -> bool:
    try:
        im = Image.open(io.BytesIO(img_bytes))
        gray = im.convert("L")
        if ImageStat.Stat(gray).stddev[0] < 6.0:
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


def classify_and_process_drive_img(args):
    idx, url, force_art = args
    cache_dir = Path("/tmp/v95_ocr_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    m_id = re.search(r"id=([^&]+)", url)
    img_id = m_id.group(1) if m_id else re.sub(r"[^A-Za-z0-9]", "_", url)[-32:]
    ocr_cache_file = cache_dir / f"{img_id}.json"

    if not force_art and ocr_cache_file.exists():
        cached = json.loads(ocr_cache_file.read_text(encoding="utf-8"))
        if cached["kind"] == "text":
            cleaned_paras = clean_ocr_paragraphs("\n\n".join(cached["paras"]))
            alpha_words = re.findall(r"[A-Za-z]{3,}", " ".join(cleaned_paras))
            if len(alpha_words) >= 10:
                return idx, "text", cleaned_paras

    raw = fetch_bytes(url)
    if not raw:
        return idx, "empty", []
    if force_art:
        return idx, "art", raw

    ocr_txt = ocr_image_bytes(raw)
    paras = clean_ocr_paragraphs(ocr_txt)
    alpha_words = re.findall(r"[A-Za-z]{3,}", " ".join(paras))
    if len(alpha_words) >= 10:
        ocr_cache_file.write_text(json.dumps({"kind": "text", "paras": paras}, ensure_ascii=False), encoding="utf-8")
        return idx, "text", paras
    return idx, "art", raw


def label_for_slug(slug: str, idx: int) -> str:
    if slug == "illustrations":
        return "Görseller"
    if slug.startswith("new-ss-"):
        num = slug.split("-")[-1]
        return f"Yeni Hikâye {num}"
    if "bookwalker" in slug:
        return "Özel Ek"
    if slug.startswith("fair-bonus-ss-"):
        num = slug.split("-")[-1]
        return f"Fuar Öyküsü {num}"
    m = re.match(r"volume-(\d+)-bonus-short-story-(\d+)", slug)
    if m:
        return f"Cilt {m.group(1)} Ek Öykü {m.group(2)}"
    return f"Öykü {idx}"


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ART_DIR.mkdir(parents=True, exist_ok=True)
    cache_manifest = Path("/tmp/v95_chapters_raw.json")

    if cache_manifest.exists():
        chapters_raw = json.loads(cache_manifest.read_text(encoding="utf-8"))
    else:
        chapters_raw = []

    if chapters_raw:
        print(f"[GlucoseTL 9.5] Önbellekten {len(chapters_raw)} bölüm yüklendi.")
    else:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
            )
            ctx = browser.new_context(user_agent=UA)
            page = ctx.new_page()

            print(f"[GlucoseTL 9.5] İçindekiler sayfası açılıyor (Anubis PoW): {BASE_URL}")
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_function(
                "() => Array.from(document.querySelectorAll('a')).some(a => (a.href || '').includes('/behind-the-scenes/'))",
                timeout=35000,
            )
            page.wait_for_timeout(800)

            toc = page.evaluate(
                """() => {
                const seen = new Set();
                const out = [];
                for (const a of document.querySelectorAll('a')) {
                    const href = a.href || '';
                    if (!href.includes('/behind-the-scenes/')) continue;
                    const cleanHref = href.split('#')[0].split('?')[0].replace(/\\/+$/, '');
                    if (seen.has(cleanHref)) continue;
                    seen.add(cleanHref);
                    out.push({
                        href: cleanHref,
                        text: (a.innerText || '').trim().replace(/\\s+/g, ' ')
                    });
                }
                return out;
            }"""
            )
            print(f"  ✓ {len(toc)} bölüm bağlantısı bulundu.")

            for i, item in enumerate(toc):
                slug = item["href"].rstrip("/").split("/")[-1]
                page.goto(item["href"], wait_until="domcontentloaded", timeout=60000)
                try:
                    page.wait_for_function(
                        "() => Array.from(document.querySelectorAll('img')).some(im => (im.src || im.currentSrc || '').includes('drive.google.com'))",
                        timeout=15000,
                    )
                except Exception:
                    page.wait_for_timeout(2500)
                extracted = page.evaluate(
                    """() => {
                    const driveImgs = [];
                    const domParas = [];
                    const seenSrc = new Set();
                    for (const el of document.querySelectorAll('img')) {
                        const src = el.currentSrc || el.src || el.getAttribute('src') || '';
                        if (src.includes('drive.google.com/thumbnail') && !seenSrc.has(src)) {
                            seenSrc.add(src);
                            driveImgs.push(src);
                        }
                    }
                    return { driveImgs, domParas };
                }"""
                )
                chapters_raw.append(
                    {
                        "idx": i,
                        "slug": slug,
                        "title": item["text"],
                        "href": item["href"],
                        "driveImgs": extracted["driveImgs"],
                        "domParas": extracted["domParas"],
                    }
                )
                print(f"  [{i+1}/{len(toc)}] {slug}: {len(extracted['driveImgs'])} görsel blok", flush=True)

            browser.close()
        cache_manifest.write_text(json.dumps(chapters_raw, ensure_ascii=False, indent=2), encoding="utf-8")

    source = []
    unit_no = 0
    art_no = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for ch in chapters_raw:
            slug = ch["slug"]
            ch_key = slug
            ch_label = label_for_slug(slug, ch["idx"])
            ch_title_en = ch["title"]
            force_art = slug == "illustrations"

            tasks = [(k, u, force_art) for k, u in enumerate(ch["driveImgs"])]
            results = list(pool.map(classify_and_process_drive_img, tasks))
            results.sort(key=lambda x: x[0])

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
                    entry["chapter"] = {"key": ch_key, "label": ch_label, "title": ch_title_en}
                    first_unit_in_chapter = False
                source.append(entry)
                text_buf = []

            # DOM paragraflarından gerçek hikâye metni olanları ekle
            for dp in ch["domParas"]:
                if not PROMO_RE.search(dp) and len(dp) > 2:
                    text_buf.append(dp)

            for _, kind, payload in results:
                if kind == "text":
                    text_buf.extend(payload)
                elif kind == "art":
                    flush_text()
                    art_no += 1
                    img_name = f"{art_no:03d}.webp"
                    if save_webp(payload, ART_DIR / img_name):
                        unit_no += 1
                        entry = {
                            "page": unit_no,
                            "img": img_name,
                            "thumb": img_name,
                            "text": "",
                            "art": True,
                            "chapterNative": True,
                        }
                        if first_unit_in_chapter:
                            entry["chapter"] = {"key": ch_key, "label": ch_label, "title": ch_title_en}
                            first_unit_in_chapter = False
                        source.append(entry)
                    else:
                        art_no -= 1

            flush_text()

    out_file = DATA_DIR / "source.json"
    out_file.write_text(json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total_paras = sum(len([x for x in u["text"].split("\n") if x.strip()]) for u in source if not u["art"])
    print(f"✓ data95/source.json yazıldı: {len(source)} birim | {total_paras} paragraf | {art_no} illüstrasyon")


if __name__ == "__main__":
    main()
