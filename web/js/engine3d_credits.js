// engine3d_credits.js -- extensions of engine3d.js needed by the 'credits' and 'tunnel2' scenes (NOT merged into engine3d.js, see re/notes_credits.md):
//   * CScene       : Scene + billboard nodes (node class 0x10481c, handlers 0x317d4 / 0x31dc8).  (The env-map uv generator 0x36cc4 is in engine3d.js now.)
//   * Billboard    : a node that is sorted together with the mesh faces (key = z/16) and drawn by 0x31878 (scaled sprite blitter, mode 0 = copy, mode 1 = shade-table blend).
//   * lookAt()     : 0x2c77c (target - position -> 0x30cec basis), the camera helper.
import { Scene, Node, mat3 } from './engine3d.js';

const trunc = Math.trunc, fr = Math.fround;
const idiv = (a, b) => Math.trunc(a / b);

/** 0x2c77c + 0x30cec: matrix rows = right (-fz,0,fx)/|.|, up = f x r (normalised), forward f; f = (target - node position)/|.| (double arithmetic; node.mat is overwritten) */
export function lookAt(node, tx, ty, tz) {
  let fx = tx - node.pos[0], fy = ty - node.pos[1], fz = tz - node.pos[2];
  let k = 1 / Math.sqrt(fx * fx + fy * fy + fz * fz); fx *= k; fy *= k; fz *= k;
  let rx = -fz, ry = 0, rz = fx; k = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz); rx *= k; ry *= k; rz *= k;
  let ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx; k = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz); ux *= k; uy *= k; uz *= k;
  const m = node.mat; m[0] = rx; m[1] = ry; m[2] = rz; m[3] = ux; m[4] = uy; m[5] = uz; m[6] = fx; m[7] = fy; m[8] = fz;
  return node;
}

/** Billboard node (original: 0x104-byte node, vtable 0x10481c, [0xd0] = draw fn 0x31dc8 (mode 1) / 0x31dbc (mode 0), [0xd8] = texels, [0xdc] = shade table, [0xe0] stride, [0xe4],[0xe8] w,h, [0xec] s1, [0xf0] k) */
export class Billboard extends Node {
  constructor({ tex, shade, stride = 64, w = 64, h = 64, s1 = 1.0, k = 0.35, mode = 1 }) {
    super(); this.isMesh = true; this.billboard = true; this.nf = 1; this.tex = tex; this.shade = shade; this.stride = stride; this.w = w; this.h = h;
    this.s1 = fr(s1); this.k = fr(k); this.mode = mode; this.X = this.Y = this.Z = 0;
    this.fmapper = [(sc, m, f, fb) => sc.drawBillboard(fb, m)];
  }
}

export class CScene extends Scene {
  constructor(o) { super(o); this.far = 0x400000; }

  /** 0x317d4: billboards are projected here; they enter the depth sorted draw list with key = z/16 */
  _object(m, mi, list) {
    if (!m.billboard) return super._object(m, mi, list);
    const cam = this.camera, cw = cam.wmat, ct = this._ct;
    const dx = m.wpos[0] - cam.wpos[0], dy = m.wpos[1] - cam.wpos[1], dz = m.wpos[2] - cam.wpos[2];
    mat3.transpose(ct, cw);
    const vx = (dy * ct[1] + dx * ct[0]) + dz * ct[2], vy = (dy * ct[4] + dx * ct[3]) + dz * ct[5], vz = (dy * ct[7] + dx * ct[6]) + dz * ct[8];
    m.X = fr(trunc(vx * 128)); m.Y = fr(trunc(vy * 128)); m.Z = fr(trunc(vz * 128));
    if (0 > m.Z) return list;                              // fldz; fcomp z; ja
    let t = trunc(m.Z); if (t < 0) t = 0; const key = idiv(t, 16);
    const it = this.nItems++; this._items[it] = (mi << 20); this._key[it] = key; this._next[it] = list;
    return it;
  }

  /** 0x31878 (edx = 1: dst = shade[(texel<<8)|dst]; edx = 0: plain copy).  All geometry in 1/16 pixel, texel steps 16.16. */
  drawBillboard(fb, m) {
    const Zd = m.Z * 0.0078125, nearD = idiv(this.near, 128);
    if (nearD > Zd || this.far < Zd) return;
    const F = this.fx, G = this.fy, cx16 = this.cx << 4, cy16 = this.cy << 4, s1 = m.s1, k = m.k, w = m.w, h = m.h, tex = m.tex, shd = m.shade, stride = m.stride;
    const invZ = 1 / Zd, A1 = (m.X * s1) * (F * 0.0009765625), Ay0 = (m.Y * s1) * (F * 0.0009765625);
    const Ax = A1 * invZ, Ay = Ay0 * invZ, W = ((w * k) * F) * invZ, H = ((h * k) * G) * invZ;
    if (!(W > 0) || !(H > 0)) return;
    const Hi = trunc(H), Wt = trunc(W);
    let top16 = trunc((cy16 + Ay) - H * 0.5); const bot16 = top16 + Hi;
    const du = (w * 16) / Wt, dv = (h * 16) / Hi;
    let left16 = trunc((cx16 + Ax) - W * 0.5); const right16 = left16 + Wt;
    const ymin16 = this.ymin16, xmin16 = this.xmin16;
    let voff = 0, uoff = 0;
    if (top16 < ymin16) { voff = 0 - ((top16 - ymin16) * dv) * 0.0625; top16 = ymin16; }
    if (left16 < xmin16) { uoff = 0 - ((left16 - xmin16) * du) * 0.0625; left16 = xmin16; }
    const top = idiv(top16, 16); let bot = idiv(bot16, 16); const left = idiv(left16, 16); let right = idiv(right16, 16);
    if (right > this.xmax_) right = this.xmax_; if (bot > this.ymax_) bot = this.ymax_;
    if (right <= left || top >= bot) return;
    const a = 15 - (left16 & 15), b = 15 - (top16 & 15);
    const U0 = trunc((((a * du) * 0.0625) + uoff) * 65536), DU = trunc(du * 65536);
    let V = ((b * dv) * 0.0625) + voff;
    const pitch = this.pitch, n = right - left, mode = m.mode;
    for (let y = top; y < bot; y++) {
      const row = trunc(V) * stride; let u = U0, o = y * pitch + left;
      if (mode === 1) for (let i = 0; i < n; i++, o++) { fb[o] = shd[((tex[row + (u >> 16)] | 0) << 8) | fb[o]]; u = (u + DU) | 0; }
      else for (let i = 0; i < n; i++, o++) { fb[o] = tex[row + (u >> 16)]; u = (u + DU) | 0; }
      V += dv;
    }
  }
}
