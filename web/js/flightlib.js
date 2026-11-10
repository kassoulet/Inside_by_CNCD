// Helpers of the 'flight' scene (see re/notes_flight.md): the terrain mesh of 19x19 vertices (0x1d450 / 0x1dab8 / 0x1dc64) drawn by the engine (engine3d.js), and the additive sprites.
// The rasteriser itself is the engine's bit-exact 0x2e264 / 0x30e5c / 0x2edb0 (nothing of the old hand written painter is left).
import { Scene, Node, Mesh, Material, FLAG, MODE, mat3 } from './engine3d.js';
import { HTS, SHD, CHECK } from './flightdata.js';

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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Ship / camera simulation (re/notes_flight.md): A = 0x1e1f8 (per ISR tick: 3 ships 0x1ddbc + camera follow 0x1e0f8), B = 0x1e8e4 (per frame: ints/matrices 0x1e76c, then camera push 0x1e638).
// State = doubles. The truncations that steer the sim (frndint with RC=truncate) must be evaluated in plain DOUBLE precision (the reference emulator's x87 rounds every operation to 53 bits: with 64-bit
// intermediates T*0.12 = 2.99999999999999989 at T = 25 truncates differently and the sim diverges at tick 25).
const PI2 = 1.5707963268;                                      // the original's own 10-digit constant (0x101662)
const DT = 17.06666666666667;                                 // [0x1037ec] (tick length measured by the original at start-up)
// Start state, DERIVED (re/notes_flight.md "Start state"): init 0x1e948 does srand(0x45eafc) (constant), then 0x1d8d0 / 0x1eb40 draw the ship and camera start from rand():
// r1,r2 = rand()%15360 twice, ship i: x = r1 + rand()%5120, y = 2560 i, z = r2 - 2560 i; camera = ship0 + (rand()%2560, 0, rand()%2048) in (x, z) order below.
// The rand state at the first A call (tick 1) is that seed advanced by the rand() calls of the other init/catch-up handlers up to the flight: 1055 in the reference run (golden.py 98.38, a run that
// starts the demo there; the scene catch-up is deterministic). A run from t=0 reaches the flight with another count (per-frame rand callers: machine/frame-rate dependent).
const SEED0 = 0x45eafc, CALLS = 1055;
const INIT = (() => {
  let s = SEED0; const r = () => { s = (Math.imul(s, 0x41c64e6d) + 0x3039) | 0; return (s >>> 16) & 0x7fff; };
  const r1 = r() % 15360, r2 = r() % 15360, x = [0, 1, 2].map(() => r1 + r() % 5120);
  const cx = r() % 2048, cz = r() % 2560; r(); r();   // 0x1eb6a: %0x800, 0x1eb8b: %0xa00, then 2 more draws (0x1ebcd/0x1ebee: second object 0x105fe0, unused here)
  for (let i = 9; i < CALLS; i++) r();
  return { rand: s, ships: x.map((px, i) => [px, 2560 * i, r2 - 2560 * i]), cam: [x[0] + cz, 0, r2 + cx] };
})();

export class FlightSim {
  constructor() {
    this.rand = INIT.rand | 0; this.tick = 0;
    this.sp = INIT.ships.map(p => Float64Array.from(p)); this.sm = [0, 1, 2].map(() => Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1));
    this.cp = Float64Array.from(INIT.cam); this.cm = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
    this.frames = [];                                          // frames[j] = record of the j-th B call (Float64Array(48): camera, ship0..2 x [int pos3, matrix9])
  }
  rnd() { this.rand = (Math.imul(this.rand, 0x41c64e6d) + 0x3039) | 0; return (this.rand >>> 16) & 0x7fff; }
}
// 0x30344 / 0x30270 / 0x30418: rotate two columns of the 3x3 matrix (rows of 3 doubles) by angle a: [p,q] column pair
function rot(M, p, q, a, mode) {
  const s = Math.sin(a), c = Math.cos(a);
  for (let r = 0; r < 9; r += 3) {
    const u = M[r + p], v = M[r + q];
    if (mode === 0) { M[r + p] = u * c - v * s; M[r + q] = v * c + u * s; }      // 0x30344 (cols 0,2) and 0x30418 (cols 0,1)
    else { M[r + p] = v * s + u * c; M[r + q] = v * c - u * s; }                 // 0x30270 (cols 1,2) / 0x30418
  }
}
const FR = Math.fround;
function shipStep(S, i, d) {
  const sp = S.sp[i], M = S.sm[i], T = S.tick, d8 = d;
  sp[0] += d8 * M[2]; sp[1] += d8 * M[5]; sp[2] += d8 * M[8];
  const Ta = T * 0.12, tr = Math.trunc;
  const n1 = tr((Ta + i * 30.6) * 1.1);
  const F1 = FR(i * 0.25 + 1.7), s1 = FR(Math.sin(n1 * PI2 * F1 * 0.0078125));
  const n2 = tr((Ta + 91) - 17 * i);
  let A1 = Math.cos(n2 * PI2 * FR(1.2) * 0.0078125) * 0.020943951024 + s1 * 0.010471975512;
  const n3 = tr((Ta - 42) + 91 * i);
  A1 += Math.cos(n3 * PI2 * FR(-1.71) * 0.0078125) * -0.013962634016;
  const n4 = tr((Ta - 81) - i * 13.5);
  const A = A1 - Math.sin(n4 * PI2 * FR(2.31) * 0.0078125) * -0.006981317008000001;
  if (Math.abs(A) > 0.006981317008000001) rot(M, 0, 2, A, 0);
  sp[1] *= 0.99;
  if (i > 0) {
    const l = S.sp[0], k = d8 * 0.65;
    if (sp[0] > l[0]) sp[0] -= k; if (sp[0] < l[0]) sp[0] += k;
    if (sp[2] > l[2]) sp[2] -= k; if (sp[2] < l[2]) sp[2] += k;
  }
  const th = (i * 0.3 + 1.7) * -512;
  if (!(th >= sp[1])) sp[1] = -((i * 0.3 + 1.7) * 512);
}
// 0x1e0f8: the camera flies along its own axis, then looks at ship 0
function camStep(S, d) {
  const p = S.cp, M = S.cm;
  p[0] += d * M[2]; p[1] += d * M[5]; p[2] += d * M[8];
  p[1] *= 0.995; if (p[1] > -1024) p[1] = -1024;
  const v = [S.sp[0][0] - p[0], S.sp[0][1] - p[1], S.sp[0][2] - p[2]];
  let n = 1 / Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); const fx = v[0] * n, fy = v[1] * n, fz = v[2] * n;
  let gx = -fz, gz = fx; n = 1 / Math.sqrt(gx * gx + gz * gz); gx *= n; gz *= n;
  const hx = fy * gz, hy = fz * gx - fx * gz, hz = -fy * gx; n = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
  M.set([gx, 0, gz, hx * n, hy * n, hz * n, fx, fy, fz]);
  rot(M, 0, 1, 3.1415926536, 1); rot(M, 1, 2, -0.20943951024, 1);
}
// 0x1e638: camera pushed away from every ship closer than 153.6 (3 rand() per ship, trunc(n * delta))
function push(S) {
  const c = S.cp;
  for (let k = 0; k < 3; k++) {
    const p = S.sp[k], dx = p[0] - c[0], dy0 = p[1] - c[1], dz0 = p[2] - c[2];
    if (!(Math.sqrt(dx * dx + dy0 * dy0 + dz0 * dz0) < 153.6)) continue;
    const x1 = Math.trunc((S.rnd() % 10 + 5) * dx), y1 = Math.trunc((S.rnd() % 5 + 2) * (p[1] - c[1])), z1 = Math.trunc((S.rnd() % 10 + 5) * (p[2] - c[2]));
    c[0] -= x1; c[1] -= y1; c[2] -= z1;
  }
}
const DS = [FR(DT * 0.4), FR(DT * 0.3), FR(DT * 0.2)], DC = FR(DT * 0.3);
/** state of the j-th B call (j = 0, 1, ...): 10 ticks of A, then B converts doubles to node ints (the record), then pushes the camera. record = Float64Array(48): camera, ship0..2 x [pos3 ints, matrix9] */
FlightSim.prototype.frame = function (j) {
  if (j < 0) j = 0;
  while (this.frames.length <= j) {
    for (let t = 0; t < 10; t++) { this.tick++; for (let i = 0; i < 3; i++) shipStep(this, i, DS[i]); camStep(this, DC); if (this.onA) this.onA(this); }
    const r = new Float64Array(48), put = (o, p, M) => { for (let k = 0; k < 3; k++) r[o + k] = Math.trunc(p[k]) + 0; r.set(M, o + 3); };
    put(0, this.cp, this.cm); for (let i = 0; i < 3; i++) put(12 * (i + 1), this.sp[i], this.sm[i]);
    this.frames.push(r); if (this.onB) this.onB(this, this.frames.length - 1);
    push(this);
  }
  return this.frames[j];
};

/** number of node int positions (camera, ship0..2) that differ from the original's recording (flightdata.js CHECK, frames 0, 25, ...): must be 0 */
export function selfCheck() {
  const s = new FlightSim(); let bad = 0;
  CHECK.forEach((v, n) => { const f = n / 12 | 0, r = s.frame(f * 25), c = (n % 12 / 3 | 0) * 12 + n % 3; if (r[c] !== v) bad++; });
  return bad;
}
