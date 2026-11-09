// Helpers of the 'flight' scene (see re/notes_flight.md): the terrain mesh of 19x19 vertices (0x1d450 / 0x1dab8 / 0x1dc64) drawn by the engine (engine3d.js), and the additive sprites.
// The rasteriser itself is the engine's bit-exact 0x2e264 / 0x30e5c / 0x2edb0 (nothing of the old hand written painter is left).
import { Scene, Node, Mesh, Material, FLAG, MODE, mat3 } from './engine3d.js';
import { HTS, SHD } from './flightdata.js';

const GN = 19, NV = GN * GN;
const TAB = new Int32Array(40); for (let k = 0; k < 40; k++) TAB[k] = Math.trunc(k * 8192 / 36);   // table 0x105d7c: texture coord steps (1/16 texel)

/** terrain node (0x1495bd0): 361 vertices, 648 faces (c,c+1,c+19) / (c+19,c+1,c+20), material = map.raw 512x512 + map.shd + map.fog (shade2) */
export function makeTerrain(tex, shd, fog) {
  const x = new Int16Array(NV), y = new Int16Array(NV), z = new Int16Array(NV), u = new Uint16Array(NV), v = new Uint16Array(NV), fi = new Uint16Array(648 * 3), fw = new Uint16Array(648);
  let n = 0;
  for (let r = 0; r < 18; r++) for (let c = 0; c < 18; c++) { const i = r * 19 + c; fi.set([i, i + 1, i + 19, i + 19, i + 1, i + 20], n * 3); n += 2; }
  const mat = new Material({ tex, shade: shd, shade2: fog, ubits: 9, vbits: 9 });
  const m = new Mesh({ nv: NV, nf: 648, x, y, z, u, v, fi, fw }, mat, 1);
  m.flags = FLAG.NOCULL;                               // node flags 0x102100: no back face culling, no lighting (shade comes from the height table)
  return m;
}

/** 0x1dab8 / 0x1dc64: place the mesh on the camera cell and fill in height, texture coordinate, shade and fog of every vertex; pick the face function (0x1dd7e: no fog at all -> 0x30e5c) */
export function fillTerrain(m, cx, cy, cz) {
  const gx = Math.trunc(cx / 512), gz = Math.trunc(cz / 512);
  m.pos[0] = gx * 512; m.pos[1] = 0; m.pos[2] = gz * 512;
  const remx = cx - gx * 512, remz = cz - gz * 512;
  const ax = ((gx % 18) + 18) % 18, az = ((gz % 18) + 18) % 18, hx = ((gx % 128) + 128) % 128, hz = ((gz % 128) + 128) % 128;
  for (let r = 0; r < GN; r++) {
    const lz = -4608 + 512 * r, vv = TAB[az + r], hr = ((hz + r) & 127) << 7;
    for (let c = 0; c < GN; c++) {
      const i = r * GN + c, lx = -4608 + 512 * c, hi = hr + ((hx + c) & 127), h = HTS[hi];
      m.vx[i] = lx; m.vy[i] = h; m.vz[i] = lz; m.vu[i] = TAB[ax + c]; m.vv[i] = vv; m.vsh[i] = SHD[hi];
      const ex = lx - remx, ey = h - cy, ez = lz - remz;
      const f = Math.trunc((Math.sqrt(ex * ex + ey * ey + ez * ez) - 2662) * 0.00078125 * 63 * 16);
      m.vsh2[i] = f < 0 ? 0 : f > 0x3f0 ? 0x3f0 : f;
    }
  }
  for (let f = 0; f < 648; f++) m.fmapper[f] = (m.vsh2[m.fa[f]] || m.vsh2[m.fb[f]] || m.vsh2[m.fc[f]]) ? MODE.GOURAUD2 : MODE.GOURAUD;
}

/** Billboard node (chain 0x10481c, constructor 0x31793, per frame 0x317d4, draw 0x31878 via 0x31dbc (mode 0: plain copy) / 0x31dc8 (mode 1: additive through flare.shd)).
 *  data/stride = texture (w x h), size scale f28 (70 for the sun, 64 for the flares), position scale f24 (the flares sit at C + k*(S-C): k scales the offset from the screen centre), bias [+0xf4] added to the depth key. */
export class SpriteNode extends Node {
  constructor(data, w, h, f24, f28, bias, mode, table) {
    super(); this.isMesh = true; this.isSprite = true; this.nv = 0; this.nf = 1; this.data = data; this.w = w; this.h = h;
    this.f24 = Math.fround(f24); this.f28 = Math.fround(f28); this.bias = bias; this.mode = mode; this.table = table; this.fmapper = [(sc, m, f, fb) => drawSprite(fb, sc, m)];
    this.fz = 0; this.fx = 0; this.fy = 0;
  }
}
/** Scene that also knows the billboard nodes: 0x317d4 camera space position (0x28158), z < 0 -> not drawn, key = trunc(bias + z) / 16 clamped at 0 */
export class FlightScene extends Scene {
  _object(m, mi, list) {
    if (!m.isSprite) return super._object(m, mi, list);
    const cam = this.camera, ct = this._ct;
    const dx = m.wpos[0] - cam.wpos[0], dy = m.wpos[1] - cam.wpos[1], dz = m.wpos[2] - cam.wpos[2];
    mat3.transpose(ct, cam.wmat);
    const x = Math.trunc(((dy * ct[1] + dx * ct[0]) + dz * ct[2]) * 128), y = Math.trunc(((dy * ct[4] + dx * ct[3]) + dz * ct[5]) * 128), z = Math.trunc(((dy * ct[7] + dx * ct[6]) + dz * ct[8]) * 128);
    m.fx = Math.fround(x); m.fy = Math.fround(y); m.fz = Math.fround(z);      // stored as single floats (+0xf8..0x100)
    if (0 > m.fz) return list;
    let k = Math.trunc(m.bias + m.fz); if (k < 0) k = 0; k >>= 4;
    const it = this.nItems++; this._items[it] = (mi << 20) | 0; this._key[it] = k; this._next[it] = list; return it;
  }
}
/** 0x31878: scaled copy of a w x h texture centred on the projected node position, 28.4 fixed point rectangle, source stepped in 16.16 */
function drawSprite(fb, sc, S) {
  const t = Math.trunc, zz = S.fz * 0.0078125, near128 = t(sc.near / 128);
  if (near128 > zz || sc.far < zz) return;
  const fx = sc.fx, fy = sc.fy, C = 1 / zz, E = fx * 0.0009765625;
  const xo = (S.fx * S.f24) * E * C, yo = E * (S.fy * S.f24) * C;                 // 25 * x * f24 / zz  (1/16 pixel, F = 200 on both axes)
  const W = ((S.w * S.f28) * fx) * C, H = ((S.h * S.f28) * fy) * C;
  if (0 >= W || 0 >= H) return;
  const cx16 = sc.cx * 16, cy16 = sc.cy * 16, pitch = sc.pitch;
  const Hi = t(H), Wt = t(W); if (Wt === 0 || Hi === 0) return;
  let y16 = t((cy16 + yo) - H * 0.5); const yb16 = y16 + Hi;
  let xl16 = t((cx16 + xo) - W * 0.5); const xr16 = xl16 + Wt;
  const a = (16 * S.w) / Wt, b = (16 * S.h) / Hi;
  let v0 = 0, u0 = 0;
  if (y16 < sc.ymin16) { v0 = 0 - (y16 - sc.ymin16) * b * 0.0625; y16 = sc.ymin16; }
  if (xl16 < sc.xmin16) { u0 = 0 - (xl16 - sc.xmin16) * a * 0.0625; xl16 = sc.xmin16; }
  const yt = t(y16 / 16); let yb = t(yb16 / 16), xl = t(xl16 / 16), xr = t(xr16 / 16);
  const yf = y16 & 15, xf = xl16 & 15;
  if (xr > sc.xmax_) xr = sc.xmax_; if (yb > sc.ymax_) yb = sc.ymax_;
  if (xr <= xl || yt >= yb) return;
  const uS = (15 - xf) * a * 0.0625 + u0, u16 = 65536 * uS, vS = ((15 - yf) * b) * 0.0625 + v0, du = t(a * 65536), ui = t(u16);
  let v = vS; const n = xr - xl, tex = S.data, tab = S.table, stride = S.w;
  for (let row = yt; row < yb; row++) {
    const base = t(v) * stride; let u = ui | 0, o = row * pitch + xl;
    if (S.mode === 0) for (let i = 0; i < n; i++, o++) { fb[o] = tex[base + (u >> 16)] | 0; u = (u + du) | 0; }
    else for (let i = 0; i < n; i++, o++) { fb[o] = tab[(((tex[base + (u >> 16)] | 0) << 8) | fb[o])]; u = (u + du) | 0; }
    v += b;
  }
}
