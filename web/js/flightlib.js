// Terrain rasteriser for the 'flight' scene (see re/notes_flight.md).
// A 19x19 vertex / 18x18 cell mesh (512 world units per cell) re-centred every frame on the camera cell; heights/shade from a 128x128 wrapped table,
// painter's algorithm (faces sorted far->near by mean depth), perspective-correct u,v,shade,fog interpolation,
// pixel = fog[fogLevel][ shd[shadeLevel][ tex512[v][u] ] ]   (palette indices, original code 0x2e264 / 0x30e5c).
import { HTS, SHD } from './flightdata.js';

export const NEAR = 0.125;          // 0x19a020 = 8192 (16.16 cells)
const PRM = globalThis.__P || {}, PU = PRM.pu || 0, PV = PRM.pv || 0, SS = PRM.ss || 4, SO = PRM.so || 0;
const NS = (PRM.ns || 1), ENVW = PRM.envw || 0, EK = PRM.ek || 1;
const FX = PRM.fx || 1, FY = PRM.fy || 1, FZ = PRM.fz || 1;
const GN = 19, NV = GN * GN;
const TAB = new Int32Array(40); for (let k = 0; k < 40; k++) TAB[k] = Math.trunc(k * 8192 / 36);   // table 0x105d7c: texture coord steps (1/16 texel)

export class Terrain {
  constructor(tex, shd, fog) {
    this.tex = tex; this.shd = shd; this.fog = fog;
    const NT = NV + 3 * 200;       // terrain vertices + 3 ships x 200
    this.X = new Float64Array(NT); this.Y = new Float64Array(NT); this.Z = new Float64Array(NT);
    this.U = new Float64Array(NT); this.V = new Float64Array(NT); this.S = new Float64Array(NT); this.F = new Float64Array(NT);
    this.env = null; this.sro = null; this.nf = 648; this.key = new Float64Array(648 + 3 * 399); this.order = new Int32Array(648 + 3 * 399);
    // face list: (c, c+1, c+19) and (c+19, c+1, c+20) per cell, exactly like the original mesh (face 0 = v0,v1,v19)
    this.fa = new Int32Array(this.nf * 3);
    let n = 0;
    for (let r = 0; r < 18; r++) for (let c = 0; c < 18; c++) {
      const i = r * 19 + c; this.fa.set([i, i + 1, i + 19, i + 19, i + 1, i + 20], n * 3); n += 2;
    }
    // polygon scratch (clipped polygon <= 4 verts), attributes: x,y,z,u,v,s,f
    this.P = new Float64Array(8 * 7); this.Q = new Float64Array(8 * 7);
    this.L = new Float64Array(6); this.R = new Float64Array(6);
  }

  /** ship.sro (header u32 {0x1df020, 0x20, nverts, faceofs, nfaces}; vertex = 12 B {i16 x,y,z, u8 envU, u8 envV, u16 ?, u16 0}; face = 8 B {u16 0, a, b, c}) + env texture river.raw (256x256) */
  setShip(sro, env) {
    const dv = new DataView(sro.buffer, sro.byteOffset, sro.byteLength), nv = dv.getUint32(8, true), fo = dv.getUint32(12, true), nfc = dv.getUint32(16, true);
    this.env = env; this.nvs = nv; this.nfs = nfc;
    this.sv = new Float64Array(nv * 5); this.sf = new Int32Array(nfc * 3);
    for (let i = 0; i < nv; i++) { const o = 32 + 12 * i; this.sv.set([dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true), dv.getUint8(o + 6), dv.getUint8(o + 7)], i * 5); }
    for (let i = 0; i < nfc; i++) { const o = fo + 8 * i; this.sf.set([dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), dv.getUint16(o + 6, true)], i * 3); }
    // vertex normals = normalised sum of the (area weighted) face normals (approximation of the original per-vertex env-map normals)
    const nm = this.sn = new Float64Array(nv * 3), sv = this.sv, sf = this.sf;
    for (let f = 0; f < nfc; f++) {
      const a = sf[f * 3], b = sf[f * 3 + 1], c = sf[f * 3 + 2];
      const ux = sv[b * 5] - sv[a * 5], uy = sv[b * 5 + 1] - sv[a * 5 + 1], uz = sv[b * 5 + 2] - sv[a * 5 + 2], vx = sv[c * 5] - sv[a * 5], vy = sv[c * 5 + 1] - sv[a * 5 + 1], vz = sv[c * 5 + 2] - sv[a * 5 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const i of [a, b, c]) { nm[i * 3] += nx; nm[i * 3 + 1] += ny; nm[i * 3 + 2] += nz; }
    }
    for (let i = 0; i < nv; i++) { const l = Math.hypot(nm[i * 3], nm[i * 3 + 1], nm[i * 3 + 2]) || 1; nm[i * 3] /= l; nm[i * 3 + 1] /= l; nm[i * 3 + 2] /= l; }
  }

  /** transform the ship vertices: ship = {x,y,z, m[9]} (object matrix, world = m * local + pos); camera as in setup() */
  setupShip(k, sx, sy, sz, sm0, cx, cy, cz, m) {
    const sm = PRM.tr ? [sm0[0], sm0[3], sm0[6], sm0[1], sm0[4], sm0[7], sm0[2], sm0[5], sm0[8]] : sm0;
    const base = NV + k * 200, sxs = 0.78125 / 512, sys = 0.78125 * 5 / 6 / 512, SC = PRM.sc || 0.0977;
    const m00 = m[0], m10 = m[3], m20 = m[6], m01 = m[1], m11 = m[4], m21 = m[7], m02 = m[2], m12 = m[5], m22 = m[8];
    for (let i = 0; i < this.nvs; i++) {
      const lx = this.sv[i * 5] * SC * FX, ly = this.sv[i * 5 + 1] * SC * FY, lz = this.sv[i * 5 + 2] * SC * FZ;
      const dx = sm[0] * lx + sm[1] * ly + sm[2] * lz + sx - cx, dy = sm[3] * lx + sm[4] * ly + sm[5] * lz + sy - cy, dz = sm[6] * lx + sm[7] * ly + sm[8] * lz + sz - cz;
      const j = base + i;
      this.X[j] = (m00 * dx + m10 * dy + m20 * dz) * sxs; this.Y[j] = (m01 * dx + m11 * dy + m21 * dz) * sys; this.Z[j] = (m02 * dx + m12 * dy + m22 * dz) / 512;
      const nx = this.sn[i * 3] * FX, ny = this.sn[i * 3 + 1] * FY, nz = this.sn[i * 3 + 2] * FZ;
      const wx = (sm[0] * nx + sm[1] * ny + sm[2] * nz) * NS, wy = (sm[3] * nx + sm[4] * ny + sm[5] * nz) * NS, wz = (sm[6] * nx + sm[7] * ny + sm[8] * nz) * NS;
      const cxn = ENVW ? wx : m00 * wx + m10 * wy + m20 * wz, cyn = ENVW ? wy : m01 * wx + m11 * wy + m21 * wz;
      this.U[j] = 128 + 127 * cxn * EK; this.V[j] = 128 + 127 * cyn * EK; this.S[j] = 0; this.F[j] = 0;
    }
  }

  /** build the camera-space vertex arrays. cam = {x,y,z, m:[9 doubles row-major]} */
  setup(cx, cy, cz, m) {
    const ix = Math.round(cx), iy = Math.round(cy), iz = Math.round(cz);
    const gx = Math.trunc(ix / 512), gz = Math.trunc(iz / 512);          // snapped cell
    const tpx = gx * 512, tpz = gz * 512;
    const remx = ix % 512, remz = iz % 512;                               // camera inside the snapped cell (fog distance)
    const ax = ((gx % 18) + 18) % 18, az = ((gz % 18) + 18) % 18, hx = ((gx % 128) + 128) % 128, hz = ((gz % 128) + 128) % 128;
    const sxs = 0.78125 / 512, sys = 0.78125 * 5 / 6 / 512;
    const m00 = m[0], m10 = m[3], m20 = m[6], m01 = m[1], m11 = m[4], m21 = m[7], m02 = m[2], m12 = m[5], m22 = m[8];
    for (let r = 0; r < GN; r++) {
      const lz = -4608 + 512 * r, vv = TAB[az + r], hr = ((hz + r) & 127) << 7;
      for (let c = 0; c < GN; c++) {
        const i = r * GN + c, lx = -4608 + 512 * c, hi = hr + ((hx + c) & 127), h = HTS[hi];
        const dx = tpx - cx + lx, dy = h - cy, dz = tpz - cz + lz;
        this.X[i] = (m00 * dx + m10 * dy + m20 * dz) * sxs;
        this.Y[i] = (m01 * dx + m11 * dy + m21 * dz) * sys;
        this.Z[i] = (m02 * dx + m12 * dy + m22 * dz) / 512;
        this.U[i] = TAB[ax + c]; this.V[i] = vv; this.S[i] = SHD[hi];
        const ex = lx - remx, ey = h - iy, ez = lz - remz;
        let f = Math.trunc((Math.sqrt(ex * ex + ey * ey + ez * ez) - 2662) * 0.00078125 * 63 * 16);
        this.F[i] = f < 0 ? 0 : f > 0x3f0 ? 0x3f0 : f;
      }
    }
  }

  /** additive sprite (flare.shd: out = shd[texel<<8 | dst]; texels 0 and 221 are transparent). Source rect sw x sh scaled to dw x dh, centred on (cx,cy). */
  sprite(fb, tex, sw, sh, cx, cy, dw, dh, opaque = false) {
    const shd = this.fshd, x0 = Math.round(cx - dw / 2), y0 = Math.round(cy - dh / 2), W = Math.round(dw), H = Math.round(dh);
    for (let y = 0; y < H; y++) {
      const py = y0 + y; if (py < 0 || py > 199) continue;
      const ty = ((y * sh / H) | 0) * sw;
      for (let x = 0; x < W; x++) {
        const px = x0 + x; if (px < 0 || px > 319) continue;
        const t = tex[ty + ((x * sw / W) | 0)]; if (t === 0 || t === 221) continue;
        fb[py * 320 + px] = opaque ? t : shd[(t << 8) | fb[py * 320 + px]];
      }
    }
  }

  render(fb, nShips = 0) {
    const { X, Y, Z, fa, key, order, sf } = this;
    let nf = 648;
    for (let f = 0; f < nf; f++) { const a = fa[f * 3], b = fa[f * 3 + 1], c = fa[f * 3 + 2]; key[f] = Z[a] + Z[b] + Z[c]; order[f] = f; }
    for (let k = 0; k < nShips; k++) for (let i = 0; i < this.nfs; i++) {
      const o = NV + k * 200, a = o + sf[i * 3], b = o + sf[i * 3 + 1], c = o + sf[i * 3 + 2];
      key[nf] = Z[a] + Z[b] + Z[c]; order[nf++] = 1000 + k * 400 + i;
    }
    const idx = new Int32Array(nf); for (let i = 0; i < nf; i++) idx[i] = i;
    const sorted = Array.from(idx).sort((p, q) => key[q] - key[p] || p - q);        // far first (stable)
    for (let k = 0; k < nf; k++) {
      const f = sorted[k], code = order[f];
      let a, b, c, ship = false;
      if (code < 1000) { a = fa[code * 3]; b = fa[code * 3 + 1]; c = fa[code * 3 + 2]; }
      else { const s2 = code - 1000, sh = (s2 / 400) | 0, i = s2 - sh * 400, o = NV + sh * 200; a = o + sf[i * 3]; b = o + sf[i * 3 + 1]; c = o + sf[i * 3 + 2]; ship = true; }
      if (Z[a] <= 0 && Z[b] <= 0 && Z[c] <= 0) continue;
      this.ship = ship; this.poly(fb, a, b, c);
    }
  }

  poly(fb, a, b, c) {
    const P = this.P, Q = this.Q, { X, Y, Z, U, V, S, F } = this;
    let n = 0;
    const put = (A, o, i) => { A[o] = X[i]; A[o + 1] = Y[i]; A[o + 2] = Z[i]; A[o + 3] = U[i]; A[o + 4] = V[i]; A[o + 5] = S[i]; A[o + 6] = F[i]; };
    put(P, 0, a); put(P, 7, b); put(P, 14, c); n = 3;
    // near-plane clip
    let m = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 7, o2 = ((i + 1) % n) * 7, in1 = P[o + 2] >= NEAR, in2 = P[o2 + 2] >= NEAR;
      if (in1) { for (let k = 0; k < 7; k++) Q[m * 7 + k] = P[o + k]; m++; }
      if (in1 !== in2) {
        const t = (NEAR - P[o + 2]) / (P[o2 + 2] - P[o + 2]);
        for (let k = 0; k < 7; k++) Q[m * 7 + k] = P[o + k] + (P[o2 + k] - P[o + k]) * t;
        Q[m * 7 + 2] = NEAR; m++;
      }
    }
    if (m < 3) return;
    for (let i = 0; i < m; i++) {   // project; store sx,sy,1/z, attr/z
      const o = i * 7, z = Q[o + 2], iz = 1 / z;
      P[o] = 160 + 256 * Q[o] * iz; P[o + 1] = 100 + 256 * Q[o + 1] * iz; P[o + 2] = iz;
      P[o + 3] = Q[o + 3] * iz; P[o + 4] = Q[o + 4] * iz; P[o + 5] = Q[o + 5] * iz; P[o + 6] = Q[o + 6] * iz;
    }
    // back-face cull (screen orientation of the first triangle of the fan)
    const area = (P[7] - P[0]) * (P[14 + 1] - P[1]) - (P[7 + 1] - P[1]) * (P[14] - P[0]);
    if (area === 0) return;
    for (let i = 1; i + 1 < m; i++) this.tri(fb, 0, i, i + 1);
  }

  tri(fb, i0, i1, i2) {
    const P = this.P, tex = this.tex, shd = this.shd, fog = this.fog;
    let o0 = i0 * 7, o1 = i1 * 7, o2 = i2 * 7, t;
    // sort by y
    if (P[o0 + 1] > P[o1 + 1]) { t = o0; o0 = o1; o1 = t; }
    if (P[o1 + 1] > P[o2 + 1]) { t = o1; o1 = o2; o2 = t; }
    if (P[o0 + 1] > P[o1 + 1]) { t = o0; o0 = o1; o1 = t; }
    const y0 = P[o0 + 1], y1 = P[o1 + 1], y2 = P[o2 + 1];
    if (y2 - y0 < 1e-6) return;
    let ys = Math.max(0, Math.ceil(y0 - 0.5)), ye = Math.min(199, Math.ceil(y2 - 0.5) - 1);
    const L = this.L, R = this.R;
    for (let y = ys; y <= ye; y++) {
      const yc = y + 0.5;
      // long edge 0-2 and short edge (0-1 or 1-2)
      const tl = (yc - y0) / (y2 - y0);
      let ox0 = o0, ox1 = o2, ta = tl, tb;
      let sa = o0, sb = o1, den;
      if (yc < y1) { den = y1 - y0; tb = den > 0 ? (yc - y0) / den : 0; sa = o0; sb = o1; } else { den = y2 - y1; tb = den > 0 ? (yc - y1) / den : 0; sa = o1; sb = o2; }
      const xl = P[o0] + (P[o2] - P[o0]) * ta, xs = P[sa] + (P[sb] - P[sa]) * tb;
      // attrs: iz,u,v,s,f (indices 2..6)
      for (let k = 0; k < 5; k++) {
        L[k] = P[o0 + 2 + k] + (P[o2 + 2 + k] - P[o0 + 2 + k]) * ta;
        R[k] = P[sa + 2 + k] + (P[sb + 2 + k] - P[sa + 2 + k]) * tb;
      }
      let xa = xl, xb = xs, A = L, B = R;
      if (xa > xb) { xa = xs; xb = xl; A = R; B = L; }
      let xi0 = Math.max(0, Math.ceil(xa - 0.5)), xi1 = Math.min(319, Math.ceil(xb - 0.5) - 1);
      if (xi0 > xi1) continue;
      const inv = 1 / (xb - xa);
      const base = y * 320;
      // attribute step per pixel (linear in screen space)
      const dz = (B[0] - A[0]) * inv, du = (B[1] - A[1]) * inv, dv = (B[2] - A[2]) * inv, ds = (B[3] - A[3]) * inv, df = (B[4] - A[4]) * inv;
      const off = xi0 + 0.5 - xa;
      let z = A[0] + dz * off, u = A[1] + du * off, v = A[2] + dv * off, s = A[3] + ds * off, f = A[4] + df * off;
      if (this.ship) {
        const env = this.env;
        for (let x = xi0; x <= xi1; x++) { const rz = 1 / z; fb[base + x] = env[(((v * rz) & 255) << 8) | ((u * rz) & 255)]; z += dz; u += du; v += dv; }
        continue;
      }
      for (let x = xi0; x <= xi1; x++) {
        const rz = 1 / z;
        const tu = (((u * rz) >> 3) + PU) & 511, tv = (((v * rz) >> 3) + PV) & 511;
        let sl = ((s * rz) >> SS) + SO, fl = ((f * rz) >> 4);
        if (sl < 0) sl = 0; else if (sl > 63) sl = 63; if (fl < 0) fl = 0; else if (fl > 63) fl = 63;
        fb[base + x] = fog[(fl << 8) | shd[(sl << 8) | tex[(tv << 9) | tu]]];
        z += dz; u += du; v += dv; s += ds; f += df;
      }
    }
  }
}
