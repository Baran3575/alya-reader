"""PDF sayfalarını WebP'ye çevirir (pypdfium2 + cwebp, PIL gerekmez)."""
import io, os, struct, subprocess, sys, zlib
import pypdfium2 as pdfium


def png_bytes(width, height, rgb_rows):
    raw = b''.join(b'\x00' + row for row in rgb_rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')


def page_to_png(page, scale):
    bmp = page.render(scale=scale)
    w, h, stride = bmp.width, bmp.height, bmp.stride
    buf = bytes(bmp.buffer)
    rows = []
    for y in range(h):
        line = buf[y * stride:y * stride + w * 3]
        # BGR -> RGB
        rows.append(bytes(bytearray([line[i + 2] for i in range(0, len(line), 3)] for _ in [0])) if False else
                    bytes(bytearray(b for i in range(0, len(line), 3) for b in (line[i + 2], line[i + 1], line[i]))))
    return png_bytes(w, h, rows)


def main(src, outdir, scale=1.4, quality=76, start=1, end=None):
    os.makedirs(outdir, exist_ok=True)
    pdf = pdfium.PdfDocument(src)
    total = len(pdf)
    end = end or total
    for i in range(start - 1, min(end, total)):
        png = page_to_png(pdf[i], scale)
        tmp = os.path.join(outdir, '.tmp.png')
        with open(tmp, 'wb') as f:
            f.write(png)
        out = os.path.join(outdir, f'{i + 1:03d}.webp')
        subprocess.run(['cwebp', '-quiet', '-q', str(quality), tmp, '-o', out], check=True)
        os.remove(tmp)
        if (i + 1) % 20 == 0:
            print(f'  {i + 1}/{end}', flush=True)
    print(f'bitti: {end - start + 1} sayfa -> {outdir}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.4)
