// INSIDE.DAT reader.  Port of the original loader (0x1c0e8) + LZSS (0x1d1c0) + directory lookup (0x1c22c).
//   u32 usize, LZSS stream: flag byte (LSB first), 1 = literal, 0 = match: dist = b0 | (b1&0xf0)<<4, len = (b1&15)+3.
//   The unpacked blob ends with the directory: count x {char name[0x20]; u32 size; u32 offset; u32 pad[2]} (0x30 bytes each) and a final u32 count.
export function unlz(s, n) {
  const o = new Uint8Array(n); let i = 0, p = 0, f = 0;
  while (p < n) {
    f >>= 1;
    if (!(f & 0x100)) { f = s[i++] | 0xff00; }
    if (f & 1) o[p++] = s[i++];
    else {
      const b0 = s[i++], b1 = s[i++], d = b0 | ((b1 & 0xf0) << 4); let l = (b1 & 15) + 3;
      while (l-- > 0 && p < n) { o[p] = o[p - d]; p++; }
    }
  }
  return o;
}
export class Dat {
  constructor(buf) {
    const raw = new Uint8Array(buf), dv = new DataView(buf);
    const n = dv.getUint32(0, true);
    this.blob = unlz(raw.subarray(4), n);
    const bd = new DataView(this.blob.buffer);
    const cnt = bd.getUint32(n - 4, true), base = n - 4 - cnt * 0x30;
    this.entries = [];
    for (let i = 0; i < cnt; i++) {
      const e = base + i * 0x30; let name = '';
      for (let k = 0; k < 0x20 && this.blob[e + k]; k++) name += String.fromCharCode(this.blob[e + k]);
      this.entries.push({ name, size: bd.getUint32(e + 0x20, true), off: bd.getUint32(e + 0x24, true) });
    }
    this.map = new Map(); for (const e of this.entries) if (!this.map.has(e.name)) this.map.set(e.name, e);
  }
  has(name) { return this.map.has(name); }
  get(name) { const e = this.map.get(name); if (!e) throw new Error('File not found <' + name + '>'); return this.blob.subarray(e.off, e.off + e.size); }
  // 768-byte VGA palette (6-bit values) -> clamped to 63 like 0x1c364
  pal(name) { const p = new Uint8Array(this.get(name).subarray(0, 768)); for (let i = 0; i < 768; i++) if (p[i] > 63) p[i] = 63; return p; }
}
export async function loadDat(url) { return new Dat(await (await fetch(url)).arrayBuffer()); }
