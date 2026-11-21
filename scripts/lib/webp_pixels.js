// Pillow (PIL) gerektirmeyen WebP/PDF piksel çözümleme, yeniden örnekleme ve korelasyon yardımcıları.
// Termux/Android ve Linux/macOS ortamlarında öncelikle libwebp (ctypes libwebp.so veya dwebp/cwebp CLI)
// ve PDF işlemleri için pypdfium2 + zlib PNG/PPM yolunu kullanır; PIL yalnızca en son yedektir.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

// IEEE 802.3 CRC32 tablosu (PNG chunk üretimi için, PIL gerekmez)
const CRC32_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(tagAscii, dataBuf) {
  const tag = Buffer.from(tagAscii, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dataBuf.length, 0);
  const tagAndData = Buffer.concat([tag, dataBuf]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tagAndData), 0);
  return Buffer.concat([len, tagAndData, crc]);
}

function encodePngRgb(width, height, rgbBuf) {
  const rowBytes = width * 3;
  if (rgbBuf.length < rowBytes * height) {
    throw new Error(`encodePngRgb: beklenen ${rowBytes * height} bayt, gelen ${rgbBuf.length}`);
  }
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const dstOff = y * (rowBytes + 1);
    raw[dstOff] = 0; // filtre tipi 0 (None)
    rgbBuf.copy(raw, dstOff + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 2; // renk tipi: Truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodePpmP6(width, height, rgbBuf) {
  const expected = width * height * 3;
  if (rgbBuf.length < expected) {
    throw new Error(`encodePpmP6: beklenen ${expected} bayt, gelen ${rgbBuf.length}`);
  }
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
  const body = rgbBuf.length === expected ? rgbBuf : rgbBuf.subarray(0, expected);
  return Buffer.concat([header, body]);
}

function parsePpmP6(buf) {
  if (!buf || buf.length < 11 || buf[0] !== 0x50 || buf[1] !== 0x36) {
    throw new Error('Geçersiz PPM P6 başlığı');
  }
  let pos = 2;
  const tokens = [];
  while (tokens.length < 3 && pos < buf.length) {
    const b = buf[pos];
    // Boşluk karakterleri
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      pos++;
      continue;
    }
    // '#' ile başlayan açıklama satırı
    if (b === 0x23) {
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      continue;
    }
    let tok = '';
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x23) break;
      tok += String.fromCharCode(c);
      pos++;
    }
    tokens.push(Number(tok));
  }
  if (tokens.length < 3 || !Number.isFinite(tokens[0]) || !Number.isFinite(tokens[1]) || !Number.isFinite(tokens[2])) {
    throw new Error('PPM P6 boyut bilgisi okunamadı');
  }
  const [width, height, maxval] = tokens;
  // maxval sonrası tek bir boşluk baytı gelir
  if (pos < buf.length && (buf[pos] === 0x20 || buf[pos] === 0x09 || buf[pos] === 0x0a || buf[pos] === 0x0d)) {
    pos++;
  }
  const byteLen = width * height * 3;
  if (buf.length - pos < byteLen) {
    throw new Error(`PPM P6 veri boyutu eksik: beklenen ${byteLen}, kalan ${buf.length - pos}`);
  }
  const raw = buf.subarray(pos, pos + byteLen);
  if (maxval === 255) {
    return { width, height, rgb: Buffer.from(raw) };
  }
  const scaled = Buffer.allocUnsafe(byteLen);
  for (let i = 0; i < byteLen; i++) {
    scaled[i] = Math.round((raw[i] * 255) / maxval);
  }
  return { width, height, rgb: scaled };
}

// Python stdlib ctypes + libwebp.so üzerinden PIL'siz toplu WebP -> RGB çözücü
const PY_LIBWEBP_BATCH_DECODE = `
import ctypes, ctypes.util, glob, json, os, shutil, struct, sys

def load_libwebp():
    cands = []
    for env_key in ('PREFIX',):
        p = os.environ.get(env_key, '')
        if p:
            cands.extend(sorted(glob.glob(os.path.join(p, 'lib', 'libwebp.so*'))))
    if sys.prefix:
        cands.extend(sorted(glob.glob(os.path.join(sys.prefix, 'lib', 'libwebp.so*'))))
    for tool in ('cwebp', 'dwebp'):
        tp = shutil.which(tool)
        if tp:
            lib_dir = os.path.normpath(os.path.join(os.path.dirname(tp), '..', 'lib'))
            cands.extend(sorted(glob.glob(os.path.join(lib_dir, 'libwebp.so*'))))
            cands.extend(sorted(glob.glob(os.path.join(lib_dir, 'libwebp*.dylib'))))
    found = ctypes.util.find_library('webp')
    if found:
        cands.append(found)
    cands.extend([
        '/data/data/com.termux/files/usr/lib/libwebp.so',
        'libwebp.so.7',
        'libwebp.so.6',
        'libwebp.so',
        '/usr/lib/x86_64-linux-gnu/libwebp.so.7',
        '/usr/lib/aarch64-linux-gnu/libwebp.so.7',
        'libwebp.dylib',
        '/opt/homebrew/lib/libwebp.dylib',
        '/usr/local/lib/libwebp.dylib',
    ])
    seen = set()
    for name in cands:
        if not name or name in seen:
            continue
        seen.add(name)
        try:
            lib = ctypes.CDLL(name)
            lib.WebPDecodeRGB.argtypes = [
                ctypes.c_char_p,
                ctypes.c_size_t,
                ctypes.POINTER(ctypes.c_int),
                ctypes.POINTER(ctypes.c_int),
            ]
            lib.WebPDecodeRGB.restype = ctypes.c_void_p
            lib.WebPFree.argtypes = [ctypes.c_void_p]
            lib.WebPFree.restype = None
            return lib
        except Exception:
            continue
    return None

lib = load_libwebp()
if lib is None:
    sys.exit(2)

files = json.loads(sys.stdin.read())
out = sys.stdout.buffer
for fp in files:
    with open(fp, 'rb') as fh:
        data = fh.read()
    w, h = ctypes.c_int(), ctypes.c_int()
    ptr = lib.WebPDecodeRGB(data, len(data), ctypes.byref(w), ctypes.byref(h))
    if not ptr:
        raise RuntimeError('WebPDecodeRGB basarisiz: ' + fp)
    ow, oh = w.value, h.value
    rgb = ctypes.string_at(ptr, ow * oh * 3)
    lib.WebPFree(ptr)
    out.write(struct.pack('<II', ow, oh))
    out.write(rgb)
`;

const PY_LIBWEBP_ENCODE = `
import ctypes, ctypes.util, glob, os, shutil, struct, sys

def load_libwebp():
    cands = []
    p = os.environ.get('PREFIX', '')
    if p:
        cands.extend(sorted(glob.glob(os.path.join(p, 'lib', 'libwebp.so*'))))
    if sys.prefix:
        cands.extend(sorted(glob.glob(os.path.join(sys.prefix, 'lib', 'libwebp.so*'))))
    for tool in ('cwebp', 'dwebp'):
        tp = shutil.which(tool)
        if tp:
            lib_dir = os.path.normpath(os.path.join(os.path.dirname(tp), '..', 'lib'))
            cands.extend(sorted(glob.glob(os.path.join(lib_dir, 'libwebp.so*'))))
            cands.extend(sorted(glob.glob(os.path.join(lib_dir, 'libwebp*.dylib'))))
    found = ctypes.util.find_library('webp')
    if found:
        cands.append(found)
    cands.extend([
        '/data/data/com.termux/files/usr/lib/libwebp.so',
        'libwebp.so.7',
        'libwebp.so.6',
        'libwebp.so',
        '/usr/lib/x86_64-linux-gnu/libwebp.so.7',
        '/usr/lib/aarch64-linux-gnu/libwebp.so.7',
        'libwebp.dylib',
        '/opt/homebrew/lib/libwebp.dylib',
        '/usr/local/lib/libwebp.dylib',
    ])
    seen = set()
    for name in cands:
        if not name or name in seen:
            continue
        seen.add(name)
        try:
            lib = ctypes.CDLL(name)
            lib.WebPEncodeRGB.argtypes = [
                ctypes.c_char_p,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_float,
                ctypes.POINTER(ctypes.c_void_p),
            ]
            lib.WebPEncodeRGB.restype = ctypes.c_size_t
            lib.WebPFree.argtypes = [ctypes.c_void_p]
            lib.WebPFree.restype = None
            return lib
        except Exception:
            continue
    return None

lib = load_libwebp()
if lib is None:
    sys.exit(2)

out_path = sys.argv[1]
quality = float(sys.argv[2])
raw = sys.stdin.buffer.read()
w, h = struct.unpack('<II', raw[:8])
rgb = raw[8:]
out_ptr = ctypes.c_void_p()
sz = lib.WebPEncodeRGB(rgb, w, h, w * 3, quality, ctypes.byref(out_ptr))
if not sz or not out_ptr.value:
    raise RuntimeError('WebPEncodeRGB basarisiz')
webp_bytes = ctypes.string_at(out_ptr, sz)
lib.WebPFree(out_ptr)
with open(out_path, 'wb') as fh:
    fh.write(webp_bytes)
`;

const PY_PIL_BATCH_DECODE = `
import json, struct, sys
from PIL import Image

files = json.loads(sys.stdin.read())
out = sys.stdout.buffer
for fp in files:
    im = Image.open(fp).convert('RGB')
    w, h = im.size
    out.write(struct.pack('<II', w, h))
    out.write(im.tobytes())
`;

// pypdfium2 + zlib PNG ile PDF sayfalarından PIL'siz görsel çıkarma (scripts/pdf2webp.py ile uyumlu)
const PY_PDFIUM_EXTRACT_PAGES = `
import json, os, struct, sys, zlib
import pypdfium2 as pdfium

def png_bytes(width, height, rgb_rows):
    raw = b''.join(b'\\x00' + row for row in rgb_rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')

pdf_path, out_dir, scale_str = sys.argv[1], sys.argv[2], sys.argv[3]
scale = float(scale_str)
os.makedirs(out_dir, exist_ok=True)
doc = pdfium.PdfDocument(pdf_path)
written = []
for idx in range(len(doc)):
    page = doc[idx]
    txt = ''
    try:
        tp = page.get_textpage()
        txt = (tp.get_text_range() or '').strip()
    except Exception:
        txt = ''
    # Yalnızca ön sayfaları (idx < 12) veya metinsiz/çok az metinli tam sayfa çizim adaylarını işle
    if idx >= 12 and len(txt) > 60:
        continue
    bmp = page.render(scale=scale)
    w, h, stride = bmp.width, bmp.height, bmp.stride
    buf = bytes(bmp.buffer)
    rows = []
    nonwhite = 0
    sample_total = 0
    for y in range(h):
        line = buf[y * stride:y * stride + w * 3]
        r_ch = line[2::3]
        g_ch = line[1::3]
        b_ch = line[0::3]
        if y % 4 == 0:
            sample_total += len(r_ch)
            nonwhite += sum(1 for rv, gv, bv in zip(r_ch, g_ch, b_ch) if rv < 242 or gv < 242 or bv < 242)
        rgb_row = bytearray(w * 3)
        rgb_row[0::3] = r_ch
        rgb_row[1::3] = g_ch
        rgb_row[2::3] = b_ch
        rows.append(bytes(rgb_row))
    # Bembeyaz boş ayırıcı sayfaları atla
    if sample_total > 0 and (nonwhite / sample_total) < 0.04:
        continue
    out_file = os.path.join(out_dir, f'img-{idx + 1:03d}-000.png')
    with open(out_file, 'wb') as fh:
        fh.write(png_bytes(w, h, rows))
    written.append({'page': idx + 1, 'file': os.path.basename(out_file)})

print(json.dumps(written))
`;

function findCliTool(toolName, envOverride) {
  if (envOverride && fs.existsSync(envOverride)) return envOverride;
  const pathDirs = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const full = path.join(dir, toolName + ext);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  // Termux standart dizini ve cwebp komşuluğu kontrolü
  const extraDirs = ['/data/data/com.termux/files/usr/bin'];
  if (process.env.PREFIX) extraDirs.unshift(path.join(process.env.PREFIX, 'bin'));
  for (const dir of extraDirs) {
    const full = path.join(dir, toolName);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {}
  }
  return null;
}

let cachedDecoderBackend = null;

function parsePackedRgbFrames(buf, expectedCount) {
  const frames = [];
  let off = 0;
  while (off + 8 <= buf.length && frames.length < expectedCount) {
    const width = buf.readUInt32LE(off);
    const height = buf.readUInt32LE(off + 4);
    off += 8;
    const len = width * height * 3;
    if (off + len > buf.length) {
      throw new Error(`Paketlenmiş RGB çerçevesi eksik: beklenen ${len}, kalan ${buf.length - off}`);
    }
    frames.push({ width, height, rgb: buf.subarray(off, off + len) });
    off += len;
  }
  if (frames.length !== expectedCount) {
    throw new Error(`Çözümlenen çerçeve sayısı uyuşmuyor: ${frames.length} !== ${expectedCount}`);
  }
  return frames;
}

function decodeBatchViaDwebp(filePaths, dwebpBin) {
  const bin = dwebpBin || findCliTool('dwebp');
  if (!bin) {
    const err = new Error('dwebp bulunamadı');
    err.code = 'ENOENT';
    throw err;
  }
  const tmpPpm = path.join(os.tmpdir(), `alya_dwebp_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.ppm`);
  const frames = [];
  try {
    for (const fp of filePaths) {
      execFileSync(bin, [fp, '-ppm', '-o', tmpPpm], { stdio: 'pipe' });
      const ppmBuf = fs.readFileSync(tmpPpm);
      frames.push(parsePpmP6(ppmBuf));
    }
  } finally {
    try {
      if (fs.existsSync(tmpPpm)) fs.unlinkSync(tmpPpm);
    } catch {}
  }
  return frames;
}

function decodeBatchViaLibwebpCtypes(filePaths, pythonBin = 'python3') {
  const raw = execFileSync(pythonBin, ['-c', PY_LIBWEBP_BATCH_DECODE], {
    input: JSON.stringify(filePaths),
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return parsePackedRgbFrames(raw, filePaths.length);
}

function decodeBatchViaFfmpeg(filePaths, getImageDimensionsFn) {
  const bin = findCliTool('ffmpeg');
  if (!bin) {
    const err = new Error('ffmpeg bulunamadı');
    err.code = 'ENOENT';
    throw err;
  }
  const frames = [];
  for (const fp of filePaths) {
    const dim = getImageDimensionsFn(fs.readFileSync(fp));
    if (!dim || !dim.width || !dim.height) {
      throw new Error(`Boyut okunamadı: ${fp}`);
    }
    const rgb = execFileSync(bin, ['-v', 'error', '-i', fp, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
      maxBuffer: dim.width * dim.height * 3 + 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    frames.push({ width: dim.width, height: dim.height, rgb: rgb.subarray(0, dim.width * dim.height * 3) });
  }
  return frames;
}

function decodeBatchViaPil(filePaths, pythonBin = 'python3') {
  const raw = execFileSync(pythonBin, ['-c', PY_PIL_BATCH_DECODE], {
    input: JSON.stringify(filePaths),
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return parsePackedRgbFrames(raw, filePaths.length);
}

function getWebpHeaderDimensions(buf) {
  if (!buf || buf.length < 30) return null;
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = buf.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  return null;
}

function decodeWebpChunkSync(filePaths, options = {}) {
  if (!filePaths.length) return { backend: cachedDecoderBackend || 'none', frames: [] };
  const { preferredBackend = null, disablePil = false, dwebpBin = null, pythonBin = 'python3' } = options;

  const tryOrder = preferredBackend
    ? [preferredBackend]
    : cachedDecoderBackend && !(disablePil && cachedDecoderBackend === 'pil')
      ? [cachedDecoderBackend, 'libwebp', 'dwebp', 'ffmpeg', ...(disablePil ? [] : ['pil'])]
      : ['libwebp', 'dwebp', 'ffmpeg', ...(disablePil ? [] : ['pil'])];

  const uniqueOrder = [...new Set(tryOrder)];
  const errors = [];

  for (const backend of uniqueOrder) {
    try {
      let frames;
      if (backend === 'libwebp') {
        frames = decodeBatchViaLibwebpCtypes(filePaths, pythonBin);
      } else if (backend === 'dwebp') {
        frames = decodeBatchViaDwebp(filePaths, dwebpBin);
      } else if (backend === 'ffmpeg') {
        frames = decodeBatchViaFfmpeg(filePaths, getWebpHeaderDimensions);
      } else if (backend === 'pil') {
        if (disablePil) continue;
        frames = decodeBatchViaPil(filePaths, pythonBin);
      } else {
        continue;
      }
      if (!preferredBackend) cachedDecoderBackend = backend;
      return { backend, frames };
    } catch (e) {
      errors.push(`${backend}: ${(e && (e.stderr ? String(e.stderr).trim() : e.message)) || e}`);
    }
  }

  const err = new Error(`WebP çözücü bulunamadı (${errors.join(' | ')})`);
  err.code = 'NO_WEBP_DECODER';
  throw err;
}

// Bellek kullanımını düşük tutmak için dosyaları küçük gruplar (varsayılan 16) halinde çözümler
function forEachDecodedWebpSync(filePaths, onFrame, options = {}) {
  const batchSize = options.batchSize || 16;
  let usedBackend = 'none';
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const slice = filePaths.slice(i, i + batchSize);
    const { backend, frames } = decodeWebpChunkSync(slice, options);
    usedBackend = backend;
    for (let j = 0; j < slice.length; j++) {
      onFrame(slice[j], frames[j], i + j);
    }
  }
  return usedBackend;
}

function decodeWebpRgbSync(filePath, options = {}) {
  const { backend, frames } = decodeWebpChunkSync([filePath], options);
  return { backend, ...frames[0] };
}

// Ayrılabilir (separable) üçgen filtre ağırlıkları — Pillow Image.Resampling.BILINEAR ile bire bir uyumlu
const triangleWeightCache = new Map();

function getTriangleWeights(srcSize, dstSize) {
  const key = `${srcSize}:${dstSize}`;
  const hit = triangleWeightCache.get(key);
  if (hit) return hit;

  const scale = srcSize / dstSize;
  const filterScale = Math.max(1.0, scale);
  const support = filterScale;
  const starts = new Int32Array(dstSize);
  const lengths = new Int32Array(dstSize);
  const allWeights = [];

  for (let xx = 0; xx < dstSize; xx++) {
    const center = (xx + 0.5) * scale;
    const xmin = Math.max(0, Math.floor(center - support + 0.5));
    const xmax = Math.min(srcSize, Math.floor(center + support + 0.5));
    const len = Math.max(1, xmax - xmin);
    starts[xx] = Math.min(xmin, srcSize - 1);
    lengths[xx] = xmax > xmin ? len : 1;

    if (xmax <= xmin) {
      allWeights.push(1.0);
    } else {
      let sum = 0;
      const tmp = new Float64Array(len);
      for (let x = 0; x < len; x++) {
        const d = Math.abs((x + xmin - center + 0.5) / filterScale);
        const w = d < 1.0 ? 1.0 - d : 0.0;
        tmp[x] = w;
        sum += w;
      }
      for (let x = 0; x < len; x++) {
        allWeights.push(sum > 0 ? tmp[x] / sum : 1.0 / len);
      }
    }
  }

  const built = { starts, lengths, weights: Float64Array.from(allWeights) };
  triangleWeightCache.set(key, built);
  return built;
}

function rgbToGray(rgb, width, height) {
  const total = width * height;
  const gray = new Uint8Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 3) {
    gray[i] = (19595 * rgb[p] + 38470 * rgb[p + 1] + 7471 * rgb[p + 2] + 32768) >> 16;
  }
  return gray;
}

function resizeGrayBilinear(gray, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return Uint8Array.from(gray);
  const wx = getTriangleWeights(srcW, dstW);
  const wy = getTriangleWeights(srcH, dstH);
  const horiz = new Float32Array(srcH * dstW);

  for (let y = 0; y < srcH; y++) {
    const rowOff = y * srcW;
    const dstOff = y * dstW;
    let wPos = 0;
    for (let xx = 0; xx < dstW; xx++) {
      const s = wx.starts[xx];
      const len = wx.lengths[xx];
      let acc = 0;
      for (let k = 0; k < len; k++) {
        acc += gray[rowOff + s + k] * wx.weights[wPos++];
      }
      horiz[dstOff + xx] = acc;
    }
  }

  const out = new Uint8Array(dstW * dstH);
  let wPosY = 0;
  for (let yy = 0; yy < dstH; yy++) {
    const s = wy.starts[yy];
    const len = wy.lengths[yy];
    const dstOff = yy * dstW;
    for (let xx = 0; xx < dstW; xx++) {
      let acc = 0;
      for (let k = 0; k < len; k++) {
        acc += horiz[(s + k) * dstW + xx] * wy.weights[wPosY + k];
      }
      const v = Math.round(acc);
      out[dstOff + xx] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    wPosY += len;
  }
  return out;
}

function resizeRgbBilinear(rgb, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return Buffer.from(rgb.subarray(0, srcW * srcH * 3));
  const wx = getTriangleWeights(srcW, dstW);
  const wy = getTriangleWeights(srcH, dstH);
  const horiz = new Float32Array(srcH * dstW * 3);

  for (let y = 0; y < srcH; y++) {
    const rowOff = y * srcW * 3;
    const dstOff = y * dstW * 3;
    let wPos = 0;
    for (let xx = 0; xx < dstW; xx++) {
      const s = wx.starts[xx];
      const len = wx.lengths[xx];
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      for (let k = 0; k < len; k++) {
        const w = wx.weights[wPos++];
        const p = rowOff + (s + k) * 3;
        rAcc += rgb[p] * w;
        gAcc += rgb[p + 1] * w;
        bAcc += rgb[p + 2] * w;
      }
      const d = dstOff + xx * 3;
      horiz[d] = rAcc;
      horiz[d + 1] = gAcc;
      horiz[d + 2] = bAcc;
    }
  }

  const out = Buffer.allocUnsafe(dstW * dstH * 3);
  let wPosY = 0;
  for (let yy = 0; yy < dstH; yy++) {
    const s = wy.starts[yy];
    const len = wy.lengths[yy];
    const dstOff = yy * dstW * 3;
    for (let xx = 0; xx < dstW; xx++) {
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      for (let k = 0; k < len; k++) {
        const w = wy.weights[wPosY + k];
        const p = ((s + k) * dstW + xx) * 3;
        rAcc += horiz[p] * w;
        gAcc += horiz[p + 1] * w;
        bAcc += horiz[p + 2] * w;
      }
      const d = dstOff + xx * 3;
      const rv = Math.round(rAcc);
      const gv = Math.round(gAcc);
      const bv = Math.round(bAcc);
      out[d] = rv < 0 ? 0 : rv > 255 ? 255 : rv;
      out[d + 1] = gv < 0 ? 0 : gv > 255 ? 255 : gv;
      out[d + 2] = bv < 0 ? 0 : bv > 255 ? 255 : bv;
    }
    wPosY += len;
  }
  return out;
}

function cropGray(gray, srcW, x0, y0, x1, y1) {
  const cw = x1 - x0;
  const ch = y1 - y0;
  const out = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const srcStart = (y0 + y) * srcW + x0;
    out.set(gray.subarray(srcStart, srcStart + cw), y * cw);
  }
  return { gray: out, width: cw, height: ch };
}

function nvecFromGray(gray, srcW, srcH, size = 32) {
  const g = resizeGrayBilinear(gray, srcW, srcH, size, size);
  const n = g.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += g[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = g[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n) || 1.0;
  const vec = new Float64Array(n);
  for (let i = 0; i < n; i++) vec[i] = (g[i] - mean) / std;
  return vec;
}

function corr(a, b) {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s / n;
}

function cropNonwhiteBandGray(gray, srcW, srcH) {
  const w = 96;
  const h = 144;
  const small = resizeGrayBilinear(gray, srcW, srcH, w, h);
  let yMin = -1;
  let yMax = -1;
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      if (small[rowOff + x] < 245) cnt++;
    }
    if (cnt > w * 0.08) {
      if (yMin === -1) yMin = y;
      yMax = y;
    }
  }

  let xMin = -1;
  let xMax = -1;
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = 0; y < h; y++) {
      if (small[y * w + x] < 245) cnt++;
    }
    if (cnt > h * 0.05) {
      if (xMin === -1) xMin = x;
      xMax = x;
    }
  }

  if (yMin !== -1 && xMin !== -1 && yMax - yMin > h * 0.2 && xMax - xMin > w * 0.3) {
    return cropGray(small, w, xMin, yMin, xMax + 1, yMax + 1);
  }
  return { gray: small, width: w, height: h };
}

function colorSat(rgb, srcW, srcH, dstW = 48, dstH = 72) {
  const small = resizeRgbBilinear(rgb, srcW, srcH, dstW, dstH);
  const pxCount = dstW * dstH;
  let sum = 0;
  for (let i = 0; i < small.length; i += 3) {
    const r = small[i];
    const g = small[i + 1];
    const b = small[i + 2];
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    sum += mx - mn;
  }
  return sum / pxCount;
}

function imageStats(rgb, gray, srcW, srcH) {
  const sat = colorSat(rgb, srcW, srcH, 64, 96);
  const g100 = resizeGrayBilinear(gray, srcW, srcH, 100, 150);
  let whiteCnt = 0;
  let grayMidCnt = 0;
  for (let i = 0; i < g100.length; i++) {
    const v = g100[i];
    if (v > 240) whiteCnt++;
    if (v > 50 && v <= 225) grayMidCnt++;
  }
  const rows = new Float64Array(150);
  for (let r = 0; r < 150; r++) {
    let rs = 0;
    const off = r * 100;
    for (let c = 0; c < 100; c++) rs += g100[off + c];
    rows[r] = rs / 100.0;
  }
  let oscSum = 0;
  for (let r = 15; r < 135; r++) {
    oscSum += Math.abs(rows[r + 1] - rows[r]);
  }
  return {
    sat: Number(sat.toFixed(3)),
    white: Number((whiteCnt / g100.length).toFixed(4)),
    grayMid: Number((grayMidCnt / g100.length).toFixed(4)),
    osc: Number((oscSum / 120.0).toFixed(3)),
  };
}

function slideMatch(cleanSize, scanSize, scanG64, vcFull, vcCrop, vsFull, vsCrop) {
  let best = Math.max(corr(vcFull, vsFull), corr(vcCrop, vsCrop), corr(vcFull, vsCrop));
  const [cw, ch] = cleanSize;
  const [sw, sh] = scanSize;
  if (scanG64 && cw > ch && sh > sw) {
    const th = Math.round((64 * ch) / cw);
    if (th >= 8 && th <= 96) {
      for (let y = 0; y <= 96 - th; y += 2) {
        const sub = cropGray(scanG64, 64, 0, y, 64, y + th);
        const c = corr(vcFull, nvecFromGray(sub.gray, sub.width, sub.height));
        if (c > best) best = c;
      }
    }
  }
  return best;
}

function summarizeFrameForCorrelation(frame, { needSat = true, needG64 = true } = {}) {
  const { width, height, rgb } = frame;
  const gray = rgbToGray(rgb, width, height);
  const cropped = cropNonwhiteBandGray(gray, width, height);
  return {
    width,
    height,
    sat: needSat ? colorSat(rgb, width, height, 48, 72) : 0,
    vFull: nvecFromGray(gray, width, height),
    vCrop: nvecFromGray(cropped.gray, cropped.width, cropped.height),
    g64: needG64 ? resizeGrayBilinear(gray, width, height, 64, 96) : null,
  };
}

function pairScore(cleanSummary, scanSummary) {
  return slideMatch(
    [cleanSummary.width, cleanSummary.height],
    [scanSummary.width, scanSummary.height],
    scanSummary.g64,
    cleanSummary.vFull,
    cleanSummary.vCrop,
    scanSummary.vFull,
    scanSummary.vCrop
  );
}

// Ham RGB verisini PIL gerektirmeden (cwebp PPM/PNG veya libwebp ctypes) WebP olarak yazar
function encodeWebpFromRgbSync(width, height, rgbBuf, outFile, { quality = 82, maxWidth = 0, disablePil = false } = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  let targetW = width;
  let targetH = height;
  let targetRgb = rgbBuf;

  if (maxWidth > 0 && width > maxWidth) {
    targetW = maxWidth;
    targetH = Math.max(1, Math.round((height * maxWidth) / width));
    targetRgb = resizeRgbBilinear(rgbBuf, width, height, targetW, targetH);
  }

  const cwebpBin = findCliTool('cwebp');
  if (cwebpBin) {
    const tmpPpm = path.join(os.tmpdir(), `alya_cwebp_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.ppm`);
    try {
      fs.writeFileSync(tmpPpm, encodePpmP6(targetW, targetH, targetRgb));
      execFileSync(cwebpBin, ['-quiet', '-q', String(quality), tmpPpm, '-o', outFile], { stdio: 'pipe' });
      return 'cwebp';
    } finally {
      try {
        if (fs.existsSync(tmpPpm)) fs.unlinkSync(tmpPpm);
      } catch {}
    }
  }

  try {
    const hdr = Buffer.alloc(8);
    hdr.writeUInt32LE(targetW, 0);
    hdr.writeUInt32LE(targetH, 4);
    execFileSync('python3', ['-c', PY_LIBWEBP_ENCODE, outFile, String(quality)], {
      input: Buffer.concat([hdr, targetRgb.subarray(0, targetW * targetH * 3)]),
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 'libwebp';
  } catch (e) {
    if (disablePil) throw e;
  }

  const tmpPng = path.join(os.tmpdir(), `alya_pil_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
  try {
    fs.writeFileSync(tmpPng, encodePngRgb(targetW, targetH, targetRgb));
    execFileSync(
      'python3',
      [
        '-c',
        'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", quality=int(sys.argv[3]), method=4)',
        tmpPng,
        outFile,
        String(quality),
      ],
      { stdio: 'pipe' }
    );
    return 'pil';
  } finally {
    try {
      if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
    } catch {}
  }
}

// Yatay çift sayfa sahne çiziminin beyaz letterbox bantlarını PIL gerektirmeden kırpıp temiz WebP üretir
function cropScanLetterboxToWebp(scanFile, outFile, { quality = 82, disablePil = false } = {}) {
  const { width, height, rgb } = decodeWebpRgbSync(scanFile, { disablePil });
  const gray = rgbToGray(rgb, width, height);

  let yMin = -1;
  let yMax = -1;
  for (let y = 0; y < height; y++) {
    let cnt = 0;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[rowOff + x] < 244) cnt++;
    }
    if (cnt > width * 0.1) {
      if (yMin === -1) yMin = y;
      yMax = y;
    }
  }

  let outW = width;
  let outH = height;
  let outRgb = rgb;

  if (yMin !== -1) {
    const bandH = yMax - yMin + 1;
    if (bandH < height * 0.72 && bandH > height * 0.35) {
      outH = bandH;
      outRgb = rgb.subarray(yMin * width * 3, (yMax + 1) * width * 3);
    }
  }

  return encodeWebpFromRgbSync(outW, outH, outRgb, outFile, { quality, disablePil });
}

function extractPdfIllustrationPagesViaPdfiumSync(pdfPath, outDir, { scale = 1.6 } = {}) {
  const stdout = execFileSync('python3', ['-c', PY_PDFIUM_EXTRACT_PAGES, pdfPath, outDir, String(scale)], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

module.exports = {
  encodePngRgb,
  encodePpmP6,
  parsePpmP6,
  findCliTool,
  decodeWebpRgbSync,
  decodeWebpChunkSync,
  forEachDecodedWebpSync,
  rgbToGray,
  resizeGrayBilinear,
  resizeRgbBilinear,
  cropGray,
  nvecFromGray,
  corr,
  cropNonwhiteBandGray,
  colorSat,
  imageStats,
  slideMatch,
  summarizeFrameForCorrelation,
  pairScore,
  encodeWebpFromRgbSync,
  cropScanLetterboxToWebp,
  extractPdfIllustrationPagesViaPdfiumSync,
};
