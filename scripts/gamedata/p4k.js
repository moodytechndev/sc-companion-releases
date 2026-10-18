// Minimal read-only reader for Star Citizen's Data.p4k (a ZIP64 container whose entries are
// AES-128-CBC encrypted and ZStd compressed). Written for pulling a few records out of the
// user's own install; it never writes to the p4k.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const KEY = Buffer.from('5E7A2002302EEB1A3BB617C30FDE1E47', 'hex');   // the community-known p4k key
const IV = Buffer.alloc(16);

class P4K {
  constructor(file) {
    this.file = file;
    this.fd = fs.openSync(file, 'r');
    this.size = fs.fstatSync(this.fd).size;
  }
  read(offset, length) {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = fs.readSync(this.fd, buf, got, length - got, offset + got);
      if (!n) break;
      got += n;
    }
    return got === length ? buf : buf.subarray(0, got);
  }
  close() { fs.closeSync(this.fd); }

  // → { entries: [{name, csize, usize, offset, method}], cdOffset, cdSize }
  listEntries() {
    const tailLen = Math.min(this.size, 1 << 16);
    const tailStart = this.size - tailLen;
    const tail = this.read(tailStart, tailLen);
    let eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('no end-of-central-directory record');
    let cdOffset, cdSize, total;
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd);
    if (loc >= 0) {
      const eocd64Off = Number(tail.readBigUInt64LE(loc + 8));
      const e = this.read(eocd64Off, 56);
      if (e.readUInt32LE(0) !== 0x06064b50) throw new Error('bad zip64 end record');
      total = Number(e.readBigUInt64LE(32));
      cdSize = Number(e.readBigUInt64LE(40));
      cdOffset = Number(e.readBigUInt64LE(48));
    } else {
      total = tail.readUInt16LE(eocd + 10);
      cdSize = tail.readUInt32LE(eocd + 12);
      cdOffset = tail.readUInt32LE(eocd + 16);
    }
    const cd = this.read(cdOffset, cdSize);
    const entries = [];
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // zip64 extra: only the fields whose 32-bit value is 0xFFFFFFFF are present, in this order
      let q = p + 46 + nameLen;
      const end = q + extraLen;
      while (q + 4 <= end) {
        const id = cd.readUInt16LE(q), len = cd.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (usize === 0xFFFFFFFF) { usize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (csize === 0xFFFFFFFF) { csize = Number(cd.readBigUInt64LE(r)); r += 8; }
          if (offset === 0xFFFFFFFF) { offset = Number(cd.readBigUInt64LE(r)); r += 8; }
        }
        q += 4 + len;
      }
      entries.push({ name, csize, usize, offset, method });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, cdOffset, cdSize, total };
  }

  // one entry by (case-insensitive) path, e.g. "Data\\Game2.dcb" (forward slashes also accepted)
  find(entries, name) {
    const want = name.toLowerCase().replace(/\//g, '\\');
    return entries.find(e => e.name.toLowerCase() === want);
  }

  // bytes of one entry, decrypted and decompressed
  extract(entry) {
    const lh = this.read(entry.offset, 30);
    if (lh.readUInt16LE(2) === undefined) throw new Error('short read');
    const nameLen = lh.readUInt16LE(26), extraLen = lh.readUInt16LE(28);
    const dataStart = entry.offset + 30 + nameLen + extraLen;
    const padded = Math.ceil(entry.csize / 16) * 16;
    let raw = this.read(dataStart, padded);
    // encrypted entries are AES-CBC; try plain first if the payload already looks like a zstd/zip stream
    const looksPlain = (b) => (b.readUInt32LE(0) === 0xFD2FB528) || entry.method === 0 && false;
    if (!looksPlain(raw)) {
      const d = crypto.createDecipheriv('aes-128-cbc', KEY, IV);
      d.setAutoPadding(false);
      raw = Buffer.concat([d.update(raw), d.final()]);
    }
    raw = raw.subarray(0, entry.csize);
    if (entry.method === 0) return raw.subarray(0, entry.usize);
    if (entry.method === 100) return zlib.zstdDecompressSync(raw);
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error('unsupported compression method ' + entry.method);
  }
}
module.exports = { P4K };
