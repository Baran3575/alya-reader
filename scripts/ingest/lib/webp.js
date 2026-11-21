// Görsel boyut okuma ve cwebp ile temiz WebP üretimi
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { ensureDir } = require('./cache');

function getImageDimensions(buf) {
  if (!buf || buf.length < 24) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }

  // JPEG: FF D8 ...
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return { width, height, format: 'jpeg' };
      }
      if (len < 2) break;
      i += 2 + len;
    }
  }

  // WebP: RIFF....WEBP
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8 ' && buf.length >= 30) {
      return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
        format: 'webp',
      };
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        format: 'webp',
      };
    }
    if (chunk === 'VP8X' && buf.length >= 30) {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
        format: 'webp',
      };
    }
  }

  return null;
}

function isFullPageIllustration(buf, name = '') {
  const lower = String(name).toLowerCase();
  if (/logo|icon|ornament|divider|credit|discord|ko-fi|patreon|qr/i.test(lower)) return false;
  const dim = getImageDimensions(buf);
  if (!dim) return buf && buf.length > 35000;
  // Küçük süsleme çizgileri veya yatay banner'ları ele
  if (dim.width < 360 || dim.height < 420) return false;
  if (dim.width / Math.max(1, dim.height) > 2.2) return false;
  return true;
}

function writeWebp(inputBuf, outFile, { maxWidth = 1000, quality = 76 } = {}) {
  ensureDir(path.dirname(outFile));
  const dim = getImageDimensions(inputBuf);

  // Zaten uygun boyutta WebP ise doğrudan yaz
  if (dim && dim.format === 'webp' && dim.width <= maxWidth && inputBuf.length <= 240000) {
    fs.writeFileSync(outFile, inputBuf);
    return dim;
  }

  const ext = dim && dim.format === 'png' ? '.png' : dim && dim.format === 'webp' ? '.webp' : '.jpg';
  const tmpIn = path.join(os.tmpdir(), `alya_img_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  try {
    fs.writeFileSync(tmpIn, inputBuf);
    const args = ['-quiet', '-q', String(quality)];
    if (dim && dim.width > maxWidth) {
      args.push('-resize', String(maxWidth), '0');
    }
    args.push(tmpIn, '-o', outFile);
    try {
      execFileSync('cwebp', args);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (dim && dim.format === 'webp') {
          const { decodeWebpRgbSync, encodeWebpFromRgbSync } = require('../../lib/webp_pixels');
          const decoded = decodeWebpRgbSync(tmpIn);
          encodeWebpFromRgbSync(decoded.width, decoded.height, decoded.rgb, outFile, { quality, maxWidth });
        } else {
          const pyScript = [
            'import sys',
            'from PIL import Image',
            'im = Image.open(sys.argv[1]).convert("RGB")',
            'mw = int(sys.argv[3])',
            'if im.width > mw: im = im.resize((mw, round(im.height * mw / im.width)), Image.Resampling.LANCZOS)',
            'im.save(sys.argv[2], "WEBP", quality=int(sys.argv[4]), method=4)',
          ].join('; ');
          execFileSync('python3', ['-c', pyScript, tmpIn, outFile, String(maxWidth), String(quality)]);
        }
      } else {
        throw err;
      }
    }
  } finally {
    try {
      if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    } catch {}
  }
  return dim;
}

module.exports = {
  getImageDimensions,
  isFullPageIllustration,
  writeWebp,
};
