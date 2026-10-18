// DataCore (Game.dcb v8) reader — enough to walk records and read their properties.
const fs = require('fs');

const DT = { BOOL: 0x1, INT8: 0x2, INT16: 0x3, INT32: 0x4, INT64: 0x5, UINT8: 0x6, UINT16: 0x7, UINT32: 0x8, UINT64: 0x9, STRING: 0xA,
  SINGLE: 0xB, DOUBLE: 0xC, LOCALE: 0xD, GUID: 0xE, ENUM: 0xF, CLASS: 0x10, STRONG: 0x110, WEAK: 0x210, REF: 0x310 };

class DCB {
  constructor(file) {
    const b = this.b = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
    const w = (i) => b.readUInt32LE(i * 4);
    const names = ['struct', 'prop', 'enum', 'mapping', 'record', 'bool', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'single', 'double', 'guid', 'string', 'locale', 'enumval', 'strong', 'weak', 'reference', 'enumopt', 'text1', 'text2'];
    const n = this.n = {};
    names.forEach((k, i) => { n[k] = w(4 + i); });
    const sizes = { struct: 16, prop: 12, enum: 8, mapping: 8, record: 36, bool: 1, int8: 1, int16: 2, int32: 4, int64: 8, uint8: 1, uint16: 2, uint32: 4, uint64: 8, single: 4, double: 8, guid: 16, string: 4, locale: 4, enumval: 4, strong: 8, weak: 8, reference: 20, enumopt: 4 };
    let o = 30 * 4;
    const off = this.off = {};
    for (const k of names.slice(0, 24)) { off[k] = o; o += n[k] * sizes[k]; }
    off.text1 = o; o += n.text1;
    off.text2 = o; o += n.text2;
    off.data = o;
    this._strCache = new Map();
    this.structs = [];
    for (let i = 0; i < n.struct; i++) {
      const p = off.struct + i * 16;
      this.structs.push({ name: this.t2(b.readUInt32LE(p)), parent: b.readInt32LE(p + 4), attrCount: b.readUInt16LE(p + 8), firstAttr: b.readUInt16LE(p + 10) });
    }
    this.props = [];
    for (let i = 0; i < n.prop; i++) {
      const p = off.prop + i * 12;
      this.props.push({ name: this.t2(b.readUInt32LE(p)), struct: b.readUInt16LE(p + 4), dtype: b.readUInt16LE(p + 6), conv: b.readUInt16LE(p + 8) });
    }
    this.mapping = [];
    for (let i = 0; i < n.mapping; i++) {
      const p = off.mapping + i * 8;
      this.mapping.push({ count: b.readUInt32LE(p), struct: b.readUInt32LE(p + 4) });
    }
    this.records = [];
    for (let i = 0; i < n.record; i++) {
      const p = off.record + i * 36;
      this.records.push({
        i, name: this.t2(b.readUInt32LE(p)), file: this.t1(b.readUInt32LE(p + 4)), tag: this.t2(b.readUInt32LE(p + 8)),
        struct: b.readUInt32LE(p + 12), id: b.subarray(p + 16, p + 32).toString('hex'), inst: b.readUInt16LE(p + 32), size: b.readUInt16LE(p + 34),
      });
    }
    // all properties of a struct, parents first
    this._allProps = new Map();
    this._sizes = new Map();
  }
  cstr(abs) { let e = abs; while (this.b[e] !== 0 && e < this.b.length) e++; return this.b.toString('utf8', abs, e); }
  t1(rel) { return this.cstr(this.off.text1 + rel); }
  t2(rel) { return this.cstr(this.off.text2 + rel); }
  allProps(si) {
    if (this._allProps.has(si)) return this._allProps.get(si);
    const s = this.structs[si];
    const own = this.props.slice(s.firstAttr, s.firstAttr + s.attrCount);
    const list = (s.parent >= 0 ? this.allProps(s.parent) : []).concat(own);
    this._allProps.set(si, list);
    return list;
  }
  size(si) {
    if (this._sizes.has(si)) return this._sizes.get(si);
    let sz = 0;
    for (const p of this.allProps(si)) sz += this.propSize(p);
    this._sizes.set(si, sz);
    return sz;
  }
  propSize(p) {
    if (p.conv !== 0) return 8;                       // array: count + first index
    switch (p.dtype) {
      case DT.BOOL: case DT.INT8: case DT.UINT8: return 1;
      case DT.INT16: case DT.UINT16: return 2;
      case DT.INT32: case DT.UINT32: case DT.SINGLE: case DT.STRING: case DT.LOCALE: case DT.ENUM: return 4;
      case DT.INT64: case DT.UINT64: case DT.DOUBLE: return 8;
      case DT.GUID: return 16;
      case DT.CLASS: return this.size(p.struct);
      case DT.STRONG: case DT.WEAK: return 8;
      case DT.REF: return 20;
      default: throw new Error('unknown data type 0x' + p.dtype.toString(16));
    }
  }
}
module.exports = { DCB, DT };

// ── instances ──
DCB.prototype.initInstances = function () {
  if (this._starts) return;
  this._starts = new Array(this.structs.length).fill(-1);
  let o = this.off.data;
  for (const m of this.mapping) { this._starts[m.struct] = o; o += m.count * this.size(m.struct); }
  const cnt = new Array(this.structs.length).fill(0);
  for (const m of this.mapping) cnt[m.struct] = m.count;
  this._counts = cnt;
};
DCB.prototype.instanceOffset = function (si, idx) {
  this.initInstances();
  return this._starts[si] + idx * this.size(si);
};
// value arrays: element index → value
DCB.prototype.arrayValue = function (dtype, i) {
  const b = this.b, off = this.off;
  switch (dtype) {
    case DT.BOOL: return b[off.bool + i] !== 0;
    case DT.INT8: return b.readInt8(off.int8 + i);
    case DT.INT16: return b.readInt16LE(off.int16 + i * 2);
    case DT.INT32: return b.readInt32LE(off.int32 + i * 4);
    case DT.INT64: return Number(b.readBigInt64LE(off.int64 + i * 8));
    case DT.UINT8: return b[off.uint8 + i];
    case DT.UINT16: return b.readUInt16LE(off.uint16 + i * 2);
    case DT.UINT32: return b.readUInt32LE(off.uint32 + i * 4);
    case DT.UINT64: return Number(b.readBigUInt64LE(off.uint64 + i * 8));
    case DT.SINGLE: return b.readFloatLE(off.single + i * 4);
    case DT.DOUBLE: return b.readDoubleLE(off.double + i * 8);
    case DT.GUID: return b.subarray(off.guid + i * 16, off.guid + i * 16 + 16).toString('hex');
    case DT.STRING: return this.t1(b.readUInt32LE(off.string + i * 4));
    case DT.LOCALE: return this.t1(b.readUInt32LE(off.locale + i * 4));
    case DT.ENUM: return this.t1(b.readUInt32LE(off.enumval + i * 4));
    case DT.STRONG: { const p = off.strong + i * 8; return { ptr: [b.readUInt32LE(p), b.readUInt32LE(p + 4)] }; }
    case DT.WEAK: { const p = off.weak + i * 8; return { weak: [b.readUInt32LE(p), b.readUInt32LE(p + 4)] }; }
    case DT.REF: { const p = off.reference + i * 20; return { ref: b.subarray(p + 4, p + 20).toString('hex'), inst: b.readUInt32LE(p) }; }
  }
  throw new Error('array dtype 0x' + dtype.toString(16));
};
// read one struct instance at an absolute offset → plain object
DCB.prototype.readAt = function (si, abs, depth = 6) {
  const b = this.b, out = { _type: this.structs[si].name };
  let p = abs;
  for (const pr of this.allProps(si)) {
    let v;
    if (pr.conv !== 0) {
      const count = b.readUInt32LE(p), first = b.readUInt32LE(p + 4);
      p += 8;
      v = [];
      for (let j = 0; j < count && j < 5000; j++) {
        if (pr.dtype === DT.CLASS) v.push(depth > 0 ? this.readInstance(pr.struct, first + j, depth - 1) : { _type: this.structs[pr.struct].name });
        else v.push(this.arrayValue(pr.dtype, first + j));
      }
    } else {
      switch (pr.dtype) {
        case DT.BOOL: v = b[p] !== 0; p += 1; break;
        case DT.INT8: v = b.readInt8(p); p += 1; break;
        case DT.UINT8: v = b[p]; p += 1; break;
        case DT.INT16: v = b.readInt16LE(p); p += 2; break;
        case DT.UINT16: v = b.readUInt16LE(p); p += 2; break;
        case DT.INT32: v = b.readInt32LE(p); p += 4; break;
        case DT.UINT32: v = b.readUInt32LE(p); p += 4; break;
        case DT.INT64: v = Number(b.readBigInt64LE(p)); p += 8; break;
        case DT.UINT64: v = Number(b.readBigUInt64LE(p)); p += 8; break;
        case DT.SINGLE: v = b.readFloatLE(p); p += 4; break;
        case DT.DOUBLE: v = b.readDoubleLE(p); p += 8; break;
        case DT.GUID: v = b.subarray(p, p + 16).toString('hex'); p += 16; break;
        case DT.STRING: case DT.LOCALE: v = this.t1(b.readUInt32LE(p)); p += 4; break;
        case DT.ENUM: v = this.t1(b.readUInt32LE(p)); p += 4; break;
        case DT.CLASS: v = depth > 0 ? this.readAt(pr.struct, p, depth - 1) : { _type: this.structs[pr.struct].name }; p += this.size(pr.struct); break;
        case DT.STRONG: v = { ptr: [b.readUInt32LE(p), b.readUInt32LE(p + 4)] }; p += 8; break;
        case DT.WEAK: v = { weak: [b.readUInt32LE(p), b.readUInt32LE(p + 4)] }; p += 8; break;
        case DT.REF: v = { inst: b.readUInt32LE(p), ref: b.subarray(p + 4, p + 20).toString('hex') }; p += 20; break;
        default: throw new Error('dtype 0x' + pr.dtype.toString(16));
      }
    }
    out[pr.name] = v;
  }
  return out;
};
DCB.prototype.readInstance = function (si, idx, depth = 6) {
  return this.readAt(si, this.instanceOffset(si, idx), depth);
};
DCB.prototype.resolve = function (v, depth = 4) {
  if (v && v.ptr) return v.ptr[0] >= this.structs.length ? null : this.readInstance(v.ptr[0], v.ptr[1], depth);
  if (v && v.weak) return this.readInstance(v.weak[0], v.weak[1], depth);
  return v;
};
