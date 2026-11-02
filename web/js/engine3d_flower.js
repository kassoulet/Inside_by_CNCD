// engine3d_flower.js -- extensions of engine3d.js needed by scene 'flower' (re/notes_flower.md).  Nothing here edits engine3d.js; merge candidates are marked MERGE.
//  * parseSROAny     MERGE: flower/*.sro have header {u32 filesize, vertexOfs(0x14), nverts, faceOfs, nfaces}; the logo ones start with the magic 0x001df020 and have a 0x20 byte header.
//                    The original loader 0x2cbb0 never looks at word 0, so parseSRO's magic test is unnecessary.
//  * FlowerScene     MERGE: Scene with the env-map uv generator 0x36cc4 (node flag byte [+0xc5] bit 4 = FLAG.ENV_UV_N2) which engine3d.js only declares.
//  * identityShade   a 64x256 shade table that maps texel -> texel: face function 0x2edb0 (used for the petals) is the 0x30e5c affine mapper WITHOUT the gouraud shade table lookup
//                    (inner loop 0x2f268: 'mov dl,[eax+tex]; mov [edi],dl'), so drawing with this table through Scene.drawFace is equivalent.
//  * loadLWS/sampleCamera  the LightWave scene parser 0x24480 / 0x24588 (Catmull-Rom expansion to one sample per frame) and the runtime sampler 0x240d8 (Hermite between frames via 0x250cc).
//  * morphMesh       0x2d4c8: dst = A + trunc((B-A)*t) for vertex positions, face normals (+0x20..) and vertex normals (+0x34..).
import { Scene, FLAG } from './engine3d.js';

export function parseSROAny(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const vo = dv.getUint32(4, true), nv = dv.getUint32(8, true), fo = dv.getUint32(12, true), nf = dv.getUint32(16, true);
  const x = new Int16Array(nv), y = new Int16Array(nv), z = new Int16Array(nv), u = new Uint16Array(nv), v = new Uint16Array(nv);
  for (let i = 0; i < nv; i++) { const p = vo + i * 12; x[i] = dv.getInt16(p, true); y[i] = dv.getInt16(p + 2, true); z[i] = dv.getInt16(p + 4, true); u[i] = dv.getUint16(p + 6, true); v[i] = dv.getUint16(p + 8, true); }
  const fi = new Int32Array(nf * 3), fw = new Uint16Array(nf);
  for (let i = 0; i < nf; i++) { const p = fo + i * 8; fw[i] = dv.getUint16(p, true); fi[i * 3] = dv.getUint16(p + 2, true); fi[i * 3 + 1] = dv.getUint16(p + 4, true); fi[i * 3 + 2] = dv.getUint16(p + 6, true); }
  return { nv, nf, x, y, z, u, v, fi, fw };
}

export function identityShade() { const t = new Uint8Array(65536); for (let i = 0; i < 65536; i++) t[i] = i & 255; return t; }

const trunc = Math.trunc;
export class FlowerScene extends Scene {
  /** 0x36cc4: uv = (-(trunc(row0.2n + 2048) & 0xfff) - trunc(vcx/64),  (trunc(row1.2n + 2048) & 0xfff) + trunc(vcy/64)), stored as int16; n = vertex normal (length 819), vcx/vcy = camera x,y>>11 */
  _envmaps(m) {
    if (!(m.flags & FLAG.ENV_UV_N2)) return super._envmaps(m);
    const M = this.M, nv = m.nv, vflag = m.vflag;
    for (let i = 0; i < nv; i++) {
      if (!(vflag[i] & 2)) continue;
      const nx = 2 * m.vnx[i], ny = 2 * m.vny[i], nz = 2 * m.vnz[i];
      const a = (ny * M[1] + nx * M[0]) + nz * M[2], b = 2048 + ((nx * M[3] + ny * M[4]) + nz * M[5]);
      m.vu[i] = -(trunc(a + 2048) & 0xfff) - trunc(m.vcx[i] / 64);
      m.vv[i] = (trunc(b) & 0xfff) + trunc(m.vcy[i] / 64);
    }
    // (other env flags are not used together with N2 in this demo)
  }
}

/** 0x2d4c8 */
export function morphMesh(d, A, B, t) {
  const nf = Math.min(A.nf, B.nf, d.nf), nv = Math.min(A.nv, B.nv, d.nv);
  for (let f = 0; f < nf; f++) {
    d.fnx[f] = trunc(A.fnx[f] + (B.fnx[f] - A.fnx[f]) * t); d.fny[f] = trunc(A.fny[f] + (B.fny[f] - A.fny[f]) * t); d.fnz[f] = trunc(A.fnz[f] + (B.fnz[f] - A.fnz[f]) * t);
  }
  for (let v = 0; v < nv; v++) {
    d.vnx[v] = trunc(A.vnx[v] + (B.vnx[v] - A.vnx[v]) * t); d.vny[v] = trunc(A.vny[v] + (B.vny[v] - A.vny[v]) * t); d.vnz[v] = trunc(A.vnz[v] + (B.vnz[v] - A.vnz[v]) * t);
    d.vx[v] = trunc(A.vx[v] + (B.vx[v] - A.vx[v]) * t); d.vy[v] = trunc(A.vy[v] + (B.vy[v] - A.vy[v]) * t); d.vz[v] = trunc(A.vz[v] + (B.vz[v] - A.vz[v]) * t);
  }
}

// ---------------------------------------------------------------- LightWave scene (.lws)
/** 0x250cc: cardinal spline (Catmull-Rom with tension 0): Hermite between p1 and p2 with tangents (p2-p0)/2 and (p3-p1)/2 */
export function hermite(t, p0, p1, p2, p3) {
  const t2 = t * t, t3 = t2 * t, m1 = 0.5 * (p2 - p0), m2 = 0.5 * (p3 - p1);
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}
const DEG = 0.01745277777777778;   // [0x10249d] (note: pi/180 rounded to 3.14150/180, not exactly pi/180)
/**
 * 0x24480/0x24588: reads the Camera/Object motion blocks ("Motion name / 9 / nkeys / 9 values + 'frame linear tension continuity bias' per key").
 * Values are scaled by `scale` (3000 pushed by the init 0x258ab): x*s, -y*s, z*s; heading/pitch/bank * DEG; every channel is expanded to one sample per frame
 * (Catmull-Rom with the first/last key duplicated); sample of frame f is stored at index f+1 (index 0 duplicates index 1, the tail repeats the last key).
 * Returns the camera table Float32Array(nsamples*9) [x,y,z,pitch,heading,bank,1,1,1] and the number of frames.
 */
export function loadLWS(text, scale = 3000) {
  const lines = text.split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(ObjectMotion|CameraMotion|LightMotion)/.exec(lines[i]);
    if (!m) continue;
    const n = parseInt(lines[i + 2]); const keys = [];
    for (let k = 0; k < n; k++) { const v = lines[i + 3 + 2 * k].trim().split(/\s+/).map(Number), w = lines[i + 4 + 2 * k].trim().split(/\s+/).map(Number); keys.push({ v, frame: w[0] }); }
    (out[m[1]] = out[m[1]] || []).push(keys);
  }
  const keys = out.CameraMotion[0];
  const P = keys.map(({ v }) => [v[0] * scale, -v[1] * scale, v[2] * scale, v[4] * DEG, v[3] * DEG, v[5] * DEG]);
  const lastFrame = keys[keys.length - 1].frame, nsamp = 512;
  const tab = new Float32Array(nsamp * 9);
  const put = (idx, vals) => { for (let j = 0; j < 6; j++) tab[idx * 9 + j] = vals[j]; tab[idx * 9 + 6] = tab[idx * 9 + 7] = tab[idx * 9 + 8] = 1; };
  for (let s = 0; s < keys.length - 1; s++) {
    const f0 = keys[s].frame, f1 = keys[s + 1].frame;
    for (let f = f0; f < f1; f++) {
      const t = (f - f0) / (f1 - f0), r = [];
      for (let j = 0; j < 6; j++) r.push(hermite(t, P[Math.max(s - 1, 0)][j], P[s][j], P[s + 1][j], P[Math.min(s + 2, P.length - 1)][j]));
      put(f + 1, r);
    }
  }
  put(0, P[0]); put(1, P[0]);
  for (let i = lastFrame + 1; i < nsamp; i++) put(i, P[P.length - 1]);
  return { tab, nframes: lastFrame + 1 };
}
/** 0x240d8: camera pose at the (float) frame counter f: Hermite between samples rem+1 and rem+2, rem = trunc(f) % nframes. Returns [x,y,z,pitch,heading,bank] (x,y,z not yet truncated) */
export function sampleCamera(lws, f, out = new Float64Array(6)) {
  const fi = trunc(f), base = (fi % lws.nframes) + 1, t = Math.fround(f - fi), T = lws.tab;
  for (let j = 0; j < 6; j++) out[j] = hermite(t, T[(base - 1) * 9 + j], T[base * 9 + j], T[(base + 1) * 9 + j], T[(base + 2) * 9 + j]);
  return out;
}
