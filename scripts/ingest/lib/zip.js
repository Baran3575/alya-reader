// Saf Node.js (zlib) tabanlı ZIP / EPUB okuyucu — sıfır harici npm bağımlılığı
const zlib = require('zlib');

function findEndOfCentralDirectory(buf) {
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('Geçersiz ZIP/EPUB arşivi: EOCD imzası bulunamadı.');
}

function readZipEntries(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries && ptr < buf.length; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;

    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const rawSlice = buf.slice(dataStart, dataStart + compSize);

    entries.set(name, {
      name,
      method,
      compSize,
      uncompSize,
      getData() {
        if (method === 0) return Buffer.from(rawSlice);
        if (method === 8) return zlib.inflateRawSync(rawSlice);
        throw new Error(`Desteklenmeyen ZIP sıkıştırma yöntemi (${method}): ${name}`);
      },
    });
  }
  return entries;
}

module.exports = {
  readZipEntries,
};
