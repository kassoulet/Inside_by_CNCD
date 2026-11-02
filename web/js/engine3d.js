// engine3d.js -- the "Surrender" software 3D engine of INSIDE.EXE (CNCD 1996), ported to JavaScript.
// Reversed from the binary (addresses in comments are linear addresses of INSIDE.EXE, see re/notes_engine.md for the full function map).
//
// ===================================================================================================================================
// OVERVIEW / API
// ===================================================================================================================================
//   import { Scene, Node, Mesh, Light, Material, Sprite, parseSRO, mat3, ... } from './engine3d.js';
//
//   const scene = new Scene({ width:320, height:200 });            // 0x2c878 + 0x2c618: fov param 42, near 0x3000, ambient 0, viewport 0..320 x 0..200
//   scene.camera = new Node();  scene.add(scene.camera);            // the camera is just a Node: scene.camera = node
//   const mat = new Material({ tex, shade, ubits:8, vbits:8 });   // 0x2c5e4: 256x256 8bit texture + shade table (64 rows x 256 palette entries)
//   const mesh = new Mesh(parseSRO(dat.get('logo/obuke.sro')), mat, /*scale*/1.0); scene.add(mesh);   // 0x2cbb0 (+normals 0x2c918/0x2ca70, bbox 0x2cde8)
//   const light = new Light(range=550, peak=1600); scene.add(light);                                   // node with flag 0x80, [0xc8]=range, [0xcc]=peak
//   camera.pos.set([0,0,100]);  mesh.setMatrix(m3x3 Float64Array(9));       // node.pos = Int32Array(3) (world units), node.mat = Float64Array(9) row-major rotation
//   scene.clear(fb, 0);  scene.render(fb);                                 // fb = Uint8Array(width*height) palette indices; render = 0x286ac (pipeline below)
//   sprite = new Sprite(type 3|4|1, data, w, h, stride, {key:0, shade});  sprite.draw(fb, x, y)   // 2D blitters 0x31fe8/0x32174/0x324ec/0x32324
//
//   Units: node positions are 32 bit integers; vertex coordinates are int16 *scale; the camera looks down +Z of its own matrix, X right, Y down.
//   Matrices are 3x3 doubles, row-major, exactly like the original (mat3.* have the same operation order => bit identical results).
//   Everything is typed arrays, no allocation per frame after the first render of a scene (scratch buffers grow once).
//
// PIPELINE per frame (0x286ac walks the stage list at 0x1039c0, 5 stages):
//   1. 0x284e4 setup   : focal lengths fx = fov*w*0.4, fy = fov*h*8/15 (truncated), viewport centre (w/2,h/2), clip window, near plane, ambient
//   2. 0x282b8 world   : world matrix + world position of every node (parent chain: pos = P + Mp*local, M = Mp*Mlocal; positions truncated to int)
//   3. 0x280e0 objects : for every node run its handler chain (0x104a84 for meshes), in this order:
//        0x36440 [flag 1 = disabled] + camera space position  d = Mcam^T (objpos - campos), [0xb8..0xc0] = trunc(128*d);  M = Mcam^T * Mobj
//        0x365b8 bounding box (8 corners projected, outcodes), whole object outside the viewport => skip
//        0x36458 per face back-face cull against the camera position in object space (face normal . (cam - v0) >= 0), marks vertices
//        0x36f78 vertex transform+projection (0x36fa0), builds the face list (0x369d4: trivial reject, key = mean z),
//        0x36cc4 environment-map uv generation (flag ENV_UV_N2), 0x36ba4 gouraud lighting (0x37508 per light)
//   4. 0x28384 sort    : radix sort (3 passes of 8 bit) of all collected faces by key = (z1+z2+z3)/3/16, drawn far to near
//   5. 0x2813c draw    : calls the face's own function (mapper) for each face (mesh.setMapper(MODE.x) / mesh.fmapper[f]); all six face functions of the demo are ported and
//                        bit-exact (tools/test_mappers.mjs, random triangles vs the emulator): MODE.GOURAUD 0x30e5c, TEX 0x2edb0, GOURAUD2 0x2e264, BLEND 0x3269c, SHADEDST 0x32dc8,
//                        LIGHTMAP 0x332e0; affine or perspective correct per face flag bits 10..12.  Near-plane clipping (0x380e0) splits a triangle into 1 or 2 triangles first.
//   Not ported: the billboard/flare node type (chain 0x10481c, 0x317d4..0x31dc8, used by flight/tunnel2/credits), bounding box rejection 0x365b8 (speed only), the unused uv generators.
//   Fixed point: vertex screen coordinates are 28.4 (1/16 pixel); z = camera depth * 128; the mapper uses 64 bit intermediate products (BigInt here, per triangle only)
//   and 16.16 / 16.12 accumulators; per pixel only int32 arithmetic.
// ===================================================================================================================================

export const FLAG = {
  DISABLED: 0x1,          // node[0xc4] bit 0: node is skipped
  ENV_UV_N2: 0x10 << 8,   // node[0xc5] bit 4   (0x36cc4)  vertex uv from 2*normal + position (the 'envmap' of the demo)
  // (node[0xc5] bits 1,2,3 = 0x36c04/0x36e9c/0x36dcc: other uv generators, never enabled by any scene, not ported)
  NOCULL: 0x1 << 8,       // node[0xc5] bit 0   no back-face culling, all faces visible
  AMBIENT: 0x40,          // node[0xc4] bit 6   reset vertex shade to the ambient value, then add lights (0x36ba4)
  LIGHT: 0x80,            // node[0xc4] bit 7   node is a light
};
// face flag bits (face dword +0x30)
export const FACE = { HIDDEN: 1, VISIBLE: 2, DOUBLE_SIDED: 0x100, NEEDS_CLIP: 0x100000 };
export const NEAR = 0x3000;      // default near plane (z units = 128 * world units): 96 world units

// ---------------------------------------------------------------- small helpers
const trunc = Math.trunc;
const i32 = (x) => x | 0;
/** x87 'fistp' after the engine's own rounding helper 0x27a78 (frndint with the control word forced to round-toward-zero): C-style truncation */
export const ftrunc = (x) => Math.trunc(x);
/** tdiv: truncating signed division (idiv) */
const idiv = (a, b) => Math.trunc(a / b);
const B = BigInt;
const asI32 = (x) => Number(BigInt.asIntN(32, x));

// ---------------------------------------------------------------- 3x3 matrices (Float64Array(9), row-major, stride 3; original stride 0x18 bytes)
export const mat3 = {
  /** identity (0x2ff44) */
  identity(m = new Float64Array(9)) { m.fill(0); m[0] = m[4] = m[8] = 1; return m; },
  copy(dst, src) { for (let i = 0; i < 9; i++) dst[i] = src[i]; return dst; },
  /** 0x30070: a = a * b  (in place), same operation order as the x87 code: c[i][j] = (a[i][1]*b[1][j] + a[i][0]*b[0][j]) + a[i][2]*b[2][j] */
  mul(a, b) {
    const t = mat3._t;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i * 3 + j] = (a[i * 3 + 1] * b[3 + j] + a[i * 3] * b[j]) + a[i * 3 + 2] * b[6 + j];
    for (let i = 0; i < 9; i++) a[i] = t[i]; return a;
  },
  /** 0x30014: dst = b * a  (dst != a,b) with the original operation order */
  mul2(dst, b, a) {
    for (let r = 0; r < 3; r++) for (let j = 0; j < 3; j++) dst[r * 3 + j] = (b[r * 3 + 1] * a[3 + j] + b[r * 3] * a[j]) + b[r * 3 + 2] * a[6 + j];
    return dst;
  },
  /** 0x300e0 / 0x30150: transpose */
  transpose(dst, src) { const t = mat3._t; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i * 3 + j] = src[j * 3 + i]; for (let i = 0; i < 9; i++) dst[i] = t[i]; return dst; },
  /** 0x305f4: identity, then M = M*Rx(ax)*Ry(ay)*Rz(az) (angles in radians; 0x30270/0x30344/0x30418) */
  euler(ax, ay, az, m = new Float64Array(9)) {
    mat3.identity(m); mat3.rotX(m, ax); mat3.rotY(m, ay); mat3.rotZ(m, az); return m;
  },
  // right-multiply by an axis rotation (columns are mixed).  Verified against the original for the logo's constant matrix.
  rotX(m, a) { const s = Math.sin(a), c = Math.cos(a); for (let r = 0; r < 3; r++) { const y = m[r * 3 + 1], z = m[r * 3 + 2]; m[r * 3 + 1] = y * c + z * s; m[r * 3 + 2] = z * c - y * s; } return m; },
  rotY(m, a) { const s = Math.sin(a), c = Math.cos(a); for (let r = 0; r < 3; r++) { const x = m[r * 3], z = m[r * 3 + 2]; m[r * 3] = x * c - z * s; m[r * 3 + 2] = z * c + x * s; } return m; },
  rotZ(m, a) { const s = Math.sin(a), c = Math.cos(a); for (let r = 0; r < 3; r++) { const x = m[r * 3], y = m[r * 3 + 1]; m[r * 3] = x * c + y * s; m[r * 3 + 1] = y * c - x * s; } return m; },
  _t: new Float64Array(9),
};

// ---------------------------------------------------------------- .sro objects
/** .sro: u32 0x001df020, u32 vertexOfs(0x20), u32 nverts, u32 faceOfs, u32 nfaces, ...(pad to 0x20); vertices 12 bytes {i16 x,y,z; u16 u,v,pad}; faces 8 bytes {u16 w0; u16 a,b,c}. */
export function parseSRO(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x001df020) throw new Error('not an .sro');
  const vo = dv.getUint32(4, true), nv = dv.getUint32(8, true), fo = dv.getUint32(12, true), nf = dv.getUint32(16, true);
  const x = new Int16Array(nv), y = new Int16Array(nv), z = new Int16Array(nv), u = new Uint16Array(nv), v = new Uint16Array(nv);
  for (let i = 0; i < nv; i++) { const p = vo + i * 12; x[i] = dv.getInt16(p, true); y[i] = dv.getInt16(p + 2, true); z[i] = dv.getInt16(p + 4, true); u[i] = dv.getUint16(p + 6, true); v[i] = dv.getUint16(p + 8, true); }
  const fi = new Int32Array(nf * 3), fw = new Uint16Array(nf);
  for (let i = 0; i < nf; i++) { const p = fo + i * 8; fw[i] = dv.getUint16(p, true); fi[i * 3] = dv.getUint16(p + 2, true); fi[i * 3 + 1] = dv.getUint16(p + 4, true); fi[i * 3 + 2] = dv.getUint16(p + 6, true); }
  return { nv, nf, x, y, z, u, v, fi, fw };
}

// ---------------------------------------------------------------- material (0x2c5e4)
/** tex: Uint8Array (1<<(ubits+vbits) texels, row = v), shade: Uint8Array shade table (row<<8 | texel) (row = 0..63), umask/vmask like [mat+0x38/+0x3c] (default (1<<bits)-1) */
export class Material {
  constructor({ tex, shade, shade2 = null, lmap = null, ubits = 8, vbits = 8, umask, vmask, flags = 0, uvs = null }) {
    this.uvs = uvs; this.tex = tex; this.shade = shade; this.shade2 = shade2; this.lmap = lmap; this.ubits = ubits; this.vbits = vbits;
    this.umask = umask === undefined ? (1 << ubits) - 1 : umask; this.vmask = vmask === undefined ? (1 << vbits) - 1 : vmask; this.flags = flags;
  }
}

// ---------------------------------------------------------------- nodes
export class Node {
  constructor() {
    this.parent = null; this.flags = 0;
    this.pos = new Int32Array(3); this.mat = mat3.identity();         // local position (+0x10..0x18) and matrix (+0x28)
    this.wpos = new Int32Array(3); this.wmat = mat3.identity();       // world position (+0x1c..0x24) and matrix (+0x70)
    this.cpos = new Int32Array(3);                                    // camera-space position*128 (+0xb8..0xc0), only valid during render
    this.isMesh = false; this.range = 0; this.peak = 0;
  }
  setPos(x, y, z) { this.pos[0] = x; this.pos[1] = y; this.pos[2] = z; return this; }   // ints (truncated like fistp)
  setMatrix(m) { mat3.copy(this.mat, m); return this; }
}
export class Light extends Node { constructor(range, peak) { super(); this.flags = FLAG.LIGHT; this.range = range; this.peak = peak; } }

/** The 3D object (0x2cbb0).  Struct-of-arrays version of the 0x40-byte vertices and 0x34-byte faces. */
export class Mesh extends Node {
  constructor(sro, material, scale = 1) {
    super(); this.isMesh = true; this.flags = FLAG.AMBIENT; this.material = material; this.bias = 0;     // bias = [+0xcc] added to the sort key
    const nv = this.nv = sro.nv, nf = this.nf = sro.nf;
    this.vx = new Int32Array(nv); this.vy = new Int32Array(nv); this.vz = new Int32Array(nv);          // object space (+8,+0xc,+0x10)
    this.vsx = new Int32Array(nv); this.vsy = new Int32Array(nv);                                       // screen x,y 1/16 pixel (+0x14,+0x18)
    this.vcz = new Int32Array(nv); this.vcx = new Int32Array(nv); this.vcy = new Int32Array(nv);        // camera space z*128 (+0x1c), x,y >>11 (+0x20,+0x24)
    this.vu = new Int16Array(nv); this.vv = new Int16Array(nv); this.vu2 = new Int16Array(nv); this.vv2 = new Int16Array(nv);    // uv (+0x28,+0x2a), second uv (+0x2c,+0x2e)
    this.vsh = new Int16Array(nv); this.vsh2 = new Int16Array(nv);                                      // shade (+0x30), (+0x32)
    this.vnx = new Int32Array(nv); this.vny = new Int32Array(nv); this.vnz = new Int32Array(nv);        // vertex normals (+0x34..0x3c), length 819 = 0.8*1024
    this.vflag = new Int32Array(nv);                                                                    // +4: bit1 = in use, bits 16..20 = outcodes (left,right,top,bottom,near)
    this.fa = new Int32Array(nf); this.fb = new Int32Array(nf); this.fc = new Int32Array(nf);          // vertex indices (+0x14..0x1c)
    this.fnx = new Int32Array(nf); this.fny = new Int32Array(nf); this.fnz = new Int32Array(nf);        // face normals, length 1024 (+0x20..0x28)
    this.fflags = new Int32Array(nf);                                                                   // +0x30
    this.fmat = new Array(nf).fill(material); this.fmapper = new Array(nf).fill(null);                  // +0x10 / +8 (null = default textured mapper)
    this.fkey = new Int32Array(nf);
    const s = scale * 1.52587890625e-05 * 65536;    // ebx*2^-16 with ebx = scale*0x10000 in the original calls
    for (let i = 0; i < nv; i++) {
      this.vx[i] = trunc(sro.x[i] * s); this.vy[i] = trunc(sro.y[i] * s); this.vz[i] = trunc(sro.z[i] * s);
      this.vu[i] = sro.u[i] >> 4; this.vv[i] = -(sro.v[i] >> 4);
    }
    for (let i = 0; i < nf; i++) { this.fa[i] = sro.fi[i * 3]; this.fb[i] = sro.fi[i * 3 + 1]; this.fc[i] = sro.fi[i * 3 + 2]; this.fflags[i] = 0; }
    this._normals(); this._bbox();
  }
  /** 0x2c918 face normals ((P2-P1)x(P3-P1) scaled to length 1024, truncated), 0x2ca70 vertex normals (sum of face normals, length 0.8*1024) */
  _normals() {
    const nf = this.nf, nv = this.nv, vx = this.vx, vy = this.vy, vz = this.vz;
    for (let f = 0; f < nf; f++) {
      const a = this.fa[f], b = this.fb[f], c = this.fc[f];
      const ax = vx[b] - vx[a], ay = vy[b] - vy[a], az = vz[b] - vz[a], bx = vx[c] - vx[a], by = vy[c] - vy[a], bz = vz[c] - vz[a];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz), k = 1 >= len ? 1024 : 1024 / len;
      this.fnx[f] = trunc(nx * k); this.fny[f] = trunc(ny * k); this.fnz[f] = trunc(nz * k);
    }
    this.vnx.fill(0); this.vny.fill(0); this.vnz.fill(0);
    for (let f = 0; f < nf; f++) for (const v of [this.fa[f], this.fb[f], this.fc[f]]) { this.vnx[v] += this.fnx[f]; this.vny[v] += this.fny[f]; this.vnz[v] += this.fnz[f]; }
    for (let v = 0; v < nv; v++) {
      const x = this.vnx[v], y = this.vny[v], z = this.vnz[v], len = Math.sqrt(x * x + y * y + z * z), k = (1 >= len ? 1024 : 1024 / len) * 0.8;
      this.vnx[v] = trunc(x * k); this.vny[v] = trunc(y * k); this.vnz[v] = trunc(z * k);
    }
  }
  /** 0x2cde8: bounding box [0xe0..0xf4] and radius [0xf8] (max |v| computed in single precision, truncated) */
  _bbox() {
    const bb = this.bbox = new Int32Array(6); bb[0] = bb[1] = bb[2] = 0x40000000; bb[3] = bb[4] = bb[5] = -0x40000000; let r = 0;
    for (let i = 0; i < this.nv; i++) {
      const x = this.vx[i], y = this.vy[i], z = this.vz[i];
      if (x < bb[0]) bb[0] = x; if (x > bb[3]) bb[3] = x; if (y < bb[1]) bb[1] = y; if (y > bb[4]) bb[4] = y; if (z < bb[2]) bb[2] = z; if (z > bb[5]) bb[5] = z;
      const d = Math.fround(Math.sqrt(x * x + y * y + z * z)); if (r < d) r = d;
    }
    this.radius = trunc(r);
  }
  /** 0x2c850: set the face function for all faces: 'null' = default textured mapper, or a custom function(scene, mesh, faceIndex) */
  setMapper(fn) { this.fmapper.fill(fn); }
  /** per face flags (+0x30): bits 10..12 = perspective subdivision (0 = affine, n = every 1<<(n-1) pixels), bit 8 = double sided */
  setFaceFlags(f) { this.fflags.fill(f); }
}

// ---------------------------------------------------------------- 2D sprites (0x31e50 creates them, 0x31df0 dispatches on type)
/** type 1: plain copy; type 3: copy, colour key skipped; type 4: key skipped, dst = shade[src<<8|dst] (shade table 16 rows, 'logo mask'); type 2: like 4 but no colour key test (0x32174).
 *  data: stride*h bytes; w = visible width.  draw(fb,x,y): x,y floats truncated like the original (fistp after frndint-truncate). */
export class Sprite {
  constructor(type, data, w, h, stride = w, { key = 0, shade = null, pitch = 320, width = 320, height = 200 } = {}) {
    this.type = type; this.data = data; this.w = w; this.h = h; this.stride = stride; this.key = key; this.shade = shade; this.pitch = pitch; this.cw = width; this.ch = height;
  }
  draw(fb, fx, fy) {
    let x0 = trunc(fx), y0 = trunc(fy); const w = this.w, h = this.h;
    let sx = 0, sy = 0; let x1 = x0 + w, y1 = y0 + h;
    if (x0 >= this.cw || y0 >= this.ch || x1 <= 0 || y1 <= 0) return;
    if (y0 < 0) { sy = -y0; y0 = 0; } if (x0 < 0) { sx = -x0; x0 = 0; } if (x1 > this.cw) x1 = this.cw; if (y1 > this.ch) y1 = this.ch;
    const d = this.data, key = this.key, sh = this.shade, t = this.type, n = x1 - x0;
    for (let y = y0; y < y1; y++) {
      let s = (y - y0 + sy) * this.stride + sx, o = y * this.pitch + x0;
      if (t === 2) { for (let i = 0; i < n; i++, s++, o++) fb[o] = sh[(d[s] << 8) | fb[o]]; }
      else if (t === 4) { for (let i = 0; i < n; i++, s++, o++) { const c = d[s]; if (c !== key) fb[o] = sh[(c << 8) | fb[o]]; } }
      else if (t === 1) { for (let i = 0; i < n; i++, s++, o++) fb[o] = d[s]; }
      else { for (let i = 0; i < n; i++, s++, o++) { const c = d[s]; if (c !== key) fb[o] = c; } }
    }
  }
}

// ---------------------------------------------------------------- the scene
const OC_L = 0x10000, OC_R = 0x20000, OC_T = 0x40000, OC_B = 0x80000, OC_N = 0x100000;
export class Scene {
  constructor({ width = 320, height = 200, fov = 42, near = NEAR, ambient = 0, flags = 0 } = {}) {
    this.width = width; this.height = height; this.pitch = width; this.fov = fov; this.near = near; this.ambient = ambient; this.flags = flags;
    this.xmin = 0; this.xmax = width; this.ymin = 0; this.ymax = height;          // scene[+0x28,+0x2c,+0x30,+0x34]
    this.cx = width >> 1; this.cy = height >> 1; this.fx = 0; this.fy = 0;        // centre [+0x10,+0x14], focal [+0x18,+0x1c]
    this.camera = null; this.nodes = []; this.lights = []; this.meshes = [];
    this._items = new Int32Array(1024); this._key = new Int32Array(1024); this._next = new Int32Array(1024); this.nItems = 0;   // draw items: (mesh index<<20 | face)
    this.M = new Float64Array(9); this._ct = new Float64Array(9); this._lv = new Float64Array(3);
    this.rs = new RS();       // raster scratch
    // pixel clip window used by the mappers (set by _setup)
    this.cxmin = 0; this.cymin = 0; this.xmax_ = width; this.ymax_ = height;
  }
  add(node) { this.nodes.push(node); if (node.isMesh) this.meshes.push(node); if (node.flags & FLAG.LIGHT) this.lights.push(node); return node; }
  /** 0x2d27c: clear the viewport rectangle */
  clear(fb, c = 0) { for (let y = this.ymin; y < this.ymax; y++) fb.fill(c, y * this.pitch + this.xmin, y * this.pitch + this.xmax); }

  /** stage 1 (0x284e4): derived constants */
  _setup() {
    const w = (this.flags & 4) ? this.xmax - this.xmin : this.pitch, h = (this.flags & 4) ? this.ymax - this.ymin : this.height;
    if (!(this.flags & 1)) { this.fx = trunc((w * 32768) * this.fov * 1.220703125e-05); this.fy = trunc((h * 32768) * this.fov * 1.6276041666666666e-05); }   // scene flag 1: keep fx,fy as set by the caller
    if (!(this.flags & 2)) { this.cx = trunc((this.xmax - this.xmin) / 2) + this.xmin; this.cy = trunc((this.ymax - this.ymin) / 2) + this.ymin; }
    this.cx16 = this.cx * 16; this.cy16 = this.cy * 16;
    this.cxmin = Math.max(this.xmin, 0); this.cymin = Math.max(this.ymin, 0);
    this.xmax_ = Math.min(this.xmax, this.pitch); this.ymax_ = Math.min(this.ymax, this.height);
    this.xmin16 = this.cxmin * 16; this.xmax16 = this.xmax_ * 16; this.ymin16 = this.cymin * 16; this.ymax16 = this.ymax_ * 16;
  }
  /** stage 2 (0x282b8/0x28224) */
  _world(n) {
    if (!n.parent) { n.wpos[0] = n.pos[0]; n.wpos[1] = n.pos[1]; n.wpos[2] = n.pos[2]; mat3.copy(n.wmat, n.mat); return; }
    this._world(n.parent); const P = n.parent, Mp = P.wmat, x = n.pos[0], y = n.pos[1], z = n.pos[2];
    // 0x28224: out vector = Pworld + Mp*local (doubles), then truncated to int (0x282b8); matrix = Mp*Mlocal
    n.wpos[0] = trunc(((y * Mp[1] + x * Mp[0]) + z * Mp[2]) + P.wpos[0]); n.wpos[1] = trunc(((y * Mp[4] + x * Mp[3]) + z * Mp[5]) + P.wpos[1]); n.wpos[2] = trunc(((y * Mp[7] + x * Mp[6]) + z * Mp[8]) + P.wpos[2]);
    mat3.copy(n.wmat, Mp); mat3.mul(n.wmat, n.mat);
  }

  /** Render all nodes into fb (not cleared). */
  render(fb) {
    this._setup(); const cam = this.camera; if (!cam) return;
    for (const n of this.nodes) this._world(n);
    this.nItems = 0; let totalFaces = 0; for (const m of this.meshes) totalFaces += m.nf;
    if (this._items.length < totalFaces) { const c = totalFaces + 256; this._items = new Int32Array(c); this._key = new Int32Array(c); this._next = new Int32Array(c); }
    let list = -1;  // linked list head (items pushed at the head like 0x199fc0)
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const m = this.meshes[mi]; if (m.flags & FLAG.DISABLED) continue;
      list = this._object(m, mi, list);
    }
    this._sortAndDraw(fb, list);
  }

  _object(m, mi, list) {
    const cam = this.camera, cw = cam.wmat, ct = this._ct, M = this.M;
    // 0x28158: camera space position of the object origin (x128) and M = Mcam^T * Mobj
    const dx = m.wpos[0] - cam.wpos[0], dy = m.wpos[1] - cam.wpos[1], dz = m.wpos[2] - cam.wpos[2];
    mat3.transpose(ct, cw);
    const vx = (dy * ct[1] + dx * ct[0]) + dz * ct[2], vy = (dy * ct[4] + dx * ct[3]) + dz * ct[5], vz = (dy * ct[7] + dx * ct[6]) + dz * ct[8];
    m.cpos[0] = trunc(vx * 128); m.cpos[1] = trunc(vy * 128); m.cpos[2] = trunc(vz * 128);
    mat3.mul2(M, ct, m.wmat);
    // projection constants of 0x36fa0
    const sx = this.fx * 0.00390625, sy = this.fy * 0.00390625;
    const R = this._R || (this._R = new Float64Array(9));
    R[0] = (M[0] * sx) * 2048; R[1] = (M[1] * sx) * 2048; R[2] = (M[2] * sx) * 2048;
    R[3] = (M[3] * sy) * 2048; R[4] = (M[4] * sy) * 2048; R[5] = (M[5] * sy) * 2048;
    R[6] = M[6] * 128; R[7] = M[7] * 128; R[8] = M[8] * 128;
    const tx = m.cpos[0] * 16 * sx, ty = m.cpos[1] * 16 * sy, tz = m.cpos[2];
    // 0x365b8: bounding box test
    // 0x365b8 (bounding box outcodes, whole object outside the viewport => skipped) is not ported: it only saves time.
    // 0x36458: back face culling against the camera in object space
    const nv = m.nv, nf = m.nf, vflag = m.vflag;
    for (let i = 0; i < nv; i++) vflag[i] &= ~2;
    const lc = this._lv; { const ex = cam.wpos[0] - m.wpos[0], ey = cam.wpos[1] - m.wpos[1], ez = cam.wpos[2] - m.wpos[2], W = m.wmat;
      lc[0] = (ey * W[3] + ex * W[0]) + ez * W[6]; lc[1] = (ey * W[4] + ex * W[1]) + ez * W[7]; lc[2] = (ey * W[5] + ex * W[2]) + ez * W[8]; }  // W^T * d
    const ff = m.fflags;
    if (m.flags & FLAG.NOCULL) { for (let i = 0; i < nv; i++) vflag[i] |= 2; for (let f = 0; f < nf; f++) { if (ff[f] & 1) ff[f] &= ~2; else ff[f] |= 2; } }
    else for (let f = 0; f < nf; f++) {
      const a = m.fa[f];
      let vis = (ff[f] & FACE.DOUBLE_SIDED) !== 0;
      if (!vis) { if (ff[f] & 1) { ff[f] &= ~2; continue; } const d = ((lc[1] - m.vy[a]) * m.fny[f] + (lc[0] - m.vx[a]) * m.fnx[f]) + (lc[2] - m.vz[a]) * m.fnz[f]; vis = !(d < 0); }
      if (vis) { ff[f] |= 2; vflag[a] |= 2; vflag[m.fb[f]] |= 2; vflag[m.fc[f]] |= 2; } else ff[f] &= ~2;
    }
    // 0x36fa0: vertex transform + projection
    const near = this.near, cx16 = this.cx16, cy16 = this.cy16;
    const x16 = this.xmin16, X16 = this.xmax16, y16 = this.ymin16, Y16 = this.ymax16;
    for (let i = 0; i < nv; i++) {
      if (!(vflag[i] & 2)) continue;
      const x = m.vx[i], y = m.vy[i], z = m.vz[i];
      const zf = (R[6] * x + R[7] * y + R[8] * z) + tz, xf = (R[0] * x + R[1] * y + R[2] * z) + tx, yf = (R[3] * x + R[4] * y + R[5] * z) + ty;
      const cz = m.vcz[i] = trunc(zf);
      m.vcx[i] = idiv(trunc(xf), 2048); m.vcy[i] = idiv(trunc(yf), 2048);
      let code = 0;
      if (near > cz) code = OC_N;
      else {
        const inv = 2 / zf, sxp = m.vsx[i] = trunc(xf * inv + cx16), syp = m.vsy[i] = trunc(yf * inv + cy16);
        if (sxp < x16) code = OC_L; if (sxp >= X16) code += OC_R; if (syp < y16) code += OC_T; if (syp >= Y16) code += OC_B;
      }
      vflag[i] = (vflag[i] & 0xff00ff00) + code;     // 'mov byte[+6],0; add [+4],code; and byte[+4],0xfd'  (bit1 cleared again, re-set below for drawn faces)
    }
    // 0x369d4: face list (trivial reject by outcodes, key = mean depth), vertices of listed faces get flag 2 again
    for (let f = 0; f < nf; f++) {
      if (!(ff[f] & 2)) continue;
      const a = m.fa[f], b = m.fb[f], c = m.fc[f];
      const ca = vflag[a], cb = vflag[b], cc = vflag[c];
      const or = (ca | cb | cc) & 0xff0000, and = (ca & cb & cc) & 0xff0000;
      if ((or & and) !== 0) continue;
      vflag[a] |= 2; vflag[b] |= 2; vflag[c] |= 2; ff[f] |= FACE.NEEDS_CLIP;
      const t = trunc((m.vcz[a] + m.vcz[b] + m.vcz[c]) * 0.3333333333333333) - m.bias;
      let k = idiv(t, 16); if (k < 0) k = 0;
      const it = this.nItems++; this._items[it] = (mi << 20) | f; this._key[it] = k; this._next[it] = list; list = it;
    }
    // uv generation / lighting for the used vertices
    if (m.flags & FLAG.ENV_UV_N2) this._envmaps(m);
    if (m.flags & FLAG.AMBIENT) this._lights(m);
    return list;
  }

  /** 0x36ba4 + 0x37508: gouraud lighting.  shade = ambient + sum over lights (cos-like term * linear falloff), clamped to 0x3e0 */
  _lights(m) {
    const nv = m.nv, vflag = m.vflag, vsh = m.vsh, amb = this.ambient;
    for (let i = 0; i < nv; i++) if (vflag[i] & 2) vsh[i] = amb;
    const W = m.wmat;
    for (const L of this.lights) {
      if (L.flags & FLAG.DISABLED) continue;
      const ix = m.pos[0] - L.pos[0], iy = m.pos[1] - L.pos[1], iz = m.pos[2] - L.pos[2];
      const dist = trunc(Math.sqrt(iy * iy + ix * ix + iz * iz));       // 0x2c63c uses the local int positions
      if (dist > m.radius + L.range) continue;
      const ex = L.wpos[0] - m.wpos[0], ey = L.wpos[1] - m.wpos[1], ez = L.wpos[2] - m.wpos[2];
      const lx = (ey * W[3] + ex * W[0]) + ez * W[6], ly = (ey * W[4] + ex * W[1]) + ez * W[7], lz = (ey * W[5] + ex * W[2]) + ez * W[8];   // light in object space
      const c8 = L.range, cc = L.peak, ratio = cc / c8;
      for (let i = 0; i < nv; i++) {
        if (!(vflag[i] & 2)) continue;
        const dx = lx - m.vx[i], dy = ly - m.vy[i], dz = lz - m.vz[i];
        const d2 = (dy * dy + dx * dx) + dz * dz, d = Math.sqrt(d2); if (d > c8) continue;
        const dot = (m.vny[i] * dy + m.vnx[i] * dx) + m.vnz[i] * dz;
        if (0 > dot) continue;
        const q = dot / (d * 512);
        const I = (1 <= d ? (cc - d * ratio) : cc) * q;
        if (I > 0) vsh[i] = trunc(vsh[i] + I);
        if (vsh[i] > 0x3e0) vsh[i] = 0x3e0;
      }
    }
  }

  /** 0x36cc4 (node flag ENV_UV_N2, used by flower/flight/water/tunnel2; verified on 2457 vertices against the emulator): environment-map uv from the camera-space normal
   *  and the vertex position:  u = -((trunc(X+2048)) & 0xfff) - cx/64,  v = cy/64 + (trunc(Y+2048) & 0xfff)  with (X,Y) = (row0, row1) of M applied to 2*normal.
   *  (0x36c04 / 0x36dcc / 0x36e9c, the other uv generators, are never used by the demo and not ported.) */
  _envmaps(m) {
    const M = this.M, nv = m.nv, vflag = m.vflag;
    if (m.flags & FLAG.ENV_UV_N2) for (let i = 0; i < nv; i++) {
      if (!(vflag[i] & 2)) continue; const nx = 2 * m.vnx[i], ny = 2 * m.vny[i], nz = 2 * m.vnz[i];
      const X = (ny * M[1] + nx * M[0]) + nz * M[2], Y = (ny * M[4] + nx * M[3]) + nz * M[5];
      m.vu[i] = -(trunc(X + 2048) & 0xfff) - trunc(m.vcx[i] / 64); m.vv[i] = trunc(m.vcy[i] / 64) + (trunc(Y + 2048) & 0xfff);
    }
  }

  // ------------------------------------------------------------ sort (0x28384) and draw (0x2813c)
  _sortAndDraw(fb, head) {
    const next = this._next, key = this._key, items = this._items;
    // three passes of an LSD radix sort exactly like the original (bucket lists with head insertion; first pass uses the inverted low byte)
    const A = this._ba || (this._ba = new Int32Array(256)), Bk = this._bb || (this._bb = new Int32Array(256));
    A.fill(-1); Bk.fill(-1);
    for (let p = head; p !== -1;) { const n = next[p]; const d = (key[p] & 255) ^ 255; next[p] = A[d]; A[d] = p; p = n; }
    for (let i = 0; i < 256; i++) for (let p = A[i]; p !== -1;) { const n = next[p]; const d = (key[p] >> 8) & 255; next[p] = Bk[d]; Bk[d] = p; p = n; }
    A.fill(-1);
    for (let i = 0; i < 256; i++) for (let p = Bk[i]; p !== -1;) { const n = next[p]; const d = (key[p] >> 16) & 255; next[p] = A[d]; A[d] = p; p = n; }
    // concatenate buckets from 255 down to 0 (each bucket list keeps its order)
    for (let i = 255; i >= 0; i--) for (let p = A[i]; p !== -1; p = next[p]) {
      const it = items[p], m = this.meshes[it >> 20], f = it & 0xfffff;
      const fn = m.fmapper[f]; if (typeof fn === 'function') fn(this, m, f, fb); else this.drawFace(fb, m, f, fn || 0);
    }
  }

  /** the default face function 0x30e5c: textured gouraud triangle (affine, or perspective correct with subdivision), with near plane clipping (0x380e0) */
  drawFace(fb, m, f, mode = 0) {
    const rs = this.rs, a = m.fa[f], b = m.fb[f], c = m.fc[f];
    const mat = m.fmat[f], flags = m.fflags[f];
    if (mat.uvs) { const q = mat.uvs; m.vu[a] = q[0]; m.vv[a] = q[1]; m.vu[b] = q[2]; m.vv[b] = q[3]; m.vu[c] = q[4]; m.vv[c] = q[5]; }   // 0x37e48: material flag 1 = per-triangle uv from the material (+0x20..+0x34)
    rs.load(4, m, a); rs.load(5, m, b); rs.load(6, m, c);
    if (!(flags & FACE.NEEDS_CLIP)) { rs.tri(this, fb, mat, flags, 4, 5, 6, mode); return; }
    const near = this.near; let behind = 0;
    if (rs.z[4] < near) behind++; if (rs.z[5] < near) behind++; if (rs.z[6] < near) behind++;
    if (behind === 0) { rs.tri(this, fb, mat, flags, 4, 5, 6, mode); return; }
    if (behind === 3) return;
    let s = 4, d = 5, e = 6;      // esi, edi, ebx (slots 4..6 hold the mesh vertices; 0..3 are the S0..S3 scratch vertices)
    const z = rs.z;
    if (behind === 1) {
      if (z[s] < near) { const t = s; s = e; e = t; }   // xchg ebx,esi
      if (z[d] < near) { const t = d; d = e; e = t; }   // xchg ebx,edi
      // esi, edi in front; ebx behind
      rs.copy(2, s); rs.copy(1, d); rs.copy(0, e); rs.copy(3, e);
      rs.interp(0, s, e, this); rs.interp(3, d, e, this);          // S0 = clip(esi,ebx), S3 = clip(edi,ebx)
      rs.tri(this, fb, mat, flags & ~FACE.NEEDS_CLIP, 2, 1, 0, mode);    // face A (S2,S1,S0)
      rs.tri(this, fb, mat, flags & ~FACE.NEEDS_CLIP, 1, 0, 3, mode);    // face B (S1,S0,S3)
    } else {
      // sort by z descending: esi has the largest z
      if (z[s] < z[d]) { const t = s; s = d; d = t; } if (z[d] < z[e]) { const t = d; d = e; e = t; } if (z[s] < z[d]) { const t = s; s = d; d = t; }
      rs.copy(2, s); rs.copy(1, d); rs.copy(0, e);
      rs.interp(1, s, d, this); rs.interp(0, s, e, this);          // S1 = clip(esi,edi), S0 = clip(esi,ebx)
      rs.tri(this, fb, mat, flags & ~FACE.NEEDS_CLIP, 2, 1, 0, mode);
    }
  }
}

/** face functions (the pointer stored at face+8 by 0x2c850).  They share the triangle setup (0x37e3c/0x37e91) and the gradient code; only the pixel operation differs. */
export const MODE = { GOURAUD: 0, TEX: 1, GOURAUD2: 2, BLEND: 3, SHADEDST: 4, LIGHTMAP: 5 };
// attributes interpolated per mode: indices into [u(+0x28), v(+0x2a), shade(+0x30), shade2(+0x32), u2(+0x2c), v2(+0x2e)]
const MODE_ATTRS = [[0, 1, 2], [0, 1], [0, 1, 2, 3], [0, 1], [2], [0, 1, 4, 5]];

// ---------------------------------------------------------------- raster scratch: transformed vertex copies + the 0x30e5c triangle mapper
class RS {
  constructor() {
    const n = 8;
    this.x = new Int32Array(n); this.y = new Int32Array(n); this.z = new Int32Array(n); this.cx = new Int32Array(n); this.cy = new Int32Array(n);
    this.u = new Int16Array(n); this.v = new Int16Array(n); this.u2 = new Int16Array(n); this.v2 = new Int16Array(n); this.s = new Int16Array(n); this.s2 = new Int16Array(n);
    this.src = [this.u, this.v, this.s, this.s2, this.u2, this.v2];        // attribute index order used by MODE_ATTRS
    this.D = new Int32Array(6); this.A0 = new Int32Array(6); this.Dy = new Int32Array(6); this.acc = new Int32Array(6); this.dl = new Int32Array(6); this.L = new Int32Array(6);
  }
  load(i, m, v) { this.x[i] = m.vsx[v]; this.y[i] = m.vsy[v]; this.z[i] = m.vcz[v]; this.cx[i] = m.vcx[v]; this.cy[i] = m.vcy[v]; this.u[i] = m.vu[v]; this.v[i] = m.vv[v]; this.u2[i] = m.vu2[v]; this.v2[i] = m.vv2[v]; this.s[i] = m.vsh[v]; this.s2[i] = m.vsh2[v]; }
  /** scratch slot copy.  Slots 0..3 are the 'S0..S3' scratch vertices of the original (0x19a408 + 0x40*i) -- the clipped vertices; the originals are 0..2 */
  copy(dst, src) {
    if (dst === src) return;
    this.x[dst] = this.x[src]; this.y[dst] = this.y[src]; this.z[dst] = this.z[src]; this.cx[dst] = this.cx[src]; this.cy[dst] = this.cy[src];
    this.u[dst] = this.u[src]; this.v[dst] = this.v[src]; this.u2[dst] = this.u2[src]; this.v2[dst] = this.v2[src]; this.s[dst] = this.s[src]; this.s2[dst] = this.s2[src];
  }
  /** near plane intersection of edge (p = in front, q = behind) stored into slot d (0x38303..: 12 bit fraction t = (zp-near)/(zp-zq)) */
  interp(d, p, q, sc) {
    const near = sc.near; let t = 0; const dz = this.z[p] - this.z[q];
    if (dz !== 0) t = asI32(BigInt.asIntN(64, B(Math.trunc(0x40000000 / dz)) * B(this.z[p] - near)) >> 18n);
    const w0 = 0x1000 - t, w1 = t;            // weight of p, weight of q
    const invn = idiv(0x40000000, near >> 8);
    const mix = (a, b) => asI32((B(b) * B(w1) + B(a) * B(w0)) >> 12n);
    // screen position: ((t*cx_q>>12)+((4096-t)*cx_p>>12)) * (2^30/(near>>8)) >> 26 + centre*16
    const cxm = asI32((B(w1) * B(this.cx[q])) >> 12n) + asI32((B(w0) * B(this.cx[p])) >> 12n), cym = asI32((B(w1) * B(this.cy[q])) >> 12n) + asI32((B(w0) * B(this.cy[p])) >> 12n);
    this.x[d] = asI32((B(cxm) * B(invn)) >> 26n) + sc.cx * 16; this.y[d] = asI32((B(cym) * B(invn)) >> 26n) + sc.cy * 16;
    this.u[d] = mix(this.u[p], this.u[q]); this.v[d] = mix(this.v[p], this.v[q]); this.u2[d] = mix(this.u2[p], this.u2[q]); this.v2[d] = mix(this.v2[p], this.v2[q]);
    this.s[d] = mix(this.s[p], this.s[q]); this.s2[d] = mix(this.s2[p], this.s2[q]);
    this.z[d] = mix(this.z[p], this.z[q]); this.cx[d] = cxm; this.cy[d] = cym;
  }

  /**
   * 0x37e91 triangle setup + 0x30e5c gradients + 0x31400 scanline/span loops.
   * vertices (slots i0,i1,i2) in 1/16 pixel; the texture mapping is affine when (flags>>10)&7 == 0, otherwise perspective correct, re-projected every 1<<(n-1) pixels.
   * mode = which face function: MODE.GOURAUD 0x30e5c, TEX 0x2edb0, GOURAUD2 0x2e264, BLEND 0x3269c, SHADEDST 0x32dc8, LIGHTMAP 0x332e0 (all share this setup, only the pixel op differs).
   */
  tri(sc, fb, mat, flags, i0, i1, i2, mode = 0) {
    const X = this.x, Y = this.y, Z = this.z;
    let A = i0, Bv = i1, C = i2, t;
    if (Y[A] > Y[Bv]) { t = A; A = Bv; Bv = t; } if (Y[Bv] > Y[C]) { t = Bv; Bv = C; C = t; } if (Y[A] > Y[Bv]) { t = A; A = Bv; Bv = t; }
    const yA = Y[A], yB = Y[Bv], yC = Y[C], dy = yC - yA;
    if (dy <= 0 || dy >= 0x8000) return;
    const ymin = sc.cymin, ymax = sc.ymax_, xmin = sc.cxmin, xmax = sc.xmax_, pitch = sc.pitch;
    if ((yC >> 4) < ymin || (yA >> 4) > ymax) return;
    const xA = X[A], xB = X[Bv], xC = X[C];
    let xlo = xA, xhi = xA; if (xB < xlo) xlo = xB; if (xC < xlo) xlo = xC; if (xB > xhi) xhi = xB; if (xC > xhi) xhi = xC;
    if ((xlo >> 4) > xmax || (xhi >> 4) <= xmin || (xhi >> 4) - (xlo >> 4) >= 0x8000) return;
    // edge slopes (12 bit fraction per 1/16 row)
    const dxLong = idiv((xC - xA) * 4096, dy);
    let dxUp = 0, dxLow = 0, p24 = 0;
    if (yC - yB !== 0) dxLow = idiv((xC - xB) * 4096, yC - yB);
    let wid = asI32(B(xA - xB) << 4n);
    if (yB - yA !== 0) {
      dxUp = idiv((xA - xB) * 4096, yA - yB);
      wid = asI32((BigInt(Math.imul(dxLong, yB - yA)) >> 8n) + B(asI32(B(xA - xB) << 4n)));
      if (wid === 0) return;
      p24 = idiv((yB - yA) * 65536, dy);
    } else if (wid === 0) return;
    const inv50 = idiv(0x40000000, wid);
    let pre = 15 - (yA & 15); const r0 = ymin - (yA >> 4); if (r0 > 0) pre += r0 << 4;
    const x1 = Math.imul(xA, 4096);
    let xLong = (Math.imul(dxLong, pre) + x1) | 0; const stepLong = dxLong << 4;
    let xUp = (Math.imul(dxUp, pre) + x1) | 0; const stepUp = dxUp << 4;
    let xLow = (Math.imul((yA - yB) + pre, dxLow) + Math.imul(xB, 4096)) | 0; const stepLow = dxLow << 4;
    const yEnd = Math.min(yC >> 4, ymax), rowsLow = yEnd - (yB >> 4);
    const row0 = Math.max(yA >> 4, ymin); const rows = yEnd - row0; if (rows <= 0) return;
    const dxAC = xC - xA, x2c = xA - 16, inv6c = idiv(0x40000000, dy);
    const persp = (flags >> 10) & 7;
    const ATT = MODE_ATTRS[mode], na = ATT.length;
    const D = this.D, A0 = this.A0, Dy = this.Dy, acc = this.acc, dl = this.dl, L = this.L, src = this.src;
    let IZ0 = 0, DIZ = 0, DIZy = 0;
    if (persp === 0) {
      for (let k = 0; k < na; k++) {
        const a = src[ATT[k]], aA = a[A], aB = a[Bv], aC = a[C];
        const e = Math.imul(aC - aA, p24) + ((aA - aB) << 16) | 0;
        const dAx = asI32((B(e) * B(inv50)) >> 26n);
        let w = asI32((B(dAx) * B(dxAC)) >> 8n); w = -(w - (((aC - aA) << 8) | 0)) | 0;
        const dAy = asI32((B(w) * B(inv6c)) >> 22n);
        D[k] = dAx; Dy[k] = dAy; A0[k] = asI32((B(dAy) * B(pre) - B(dAx) * B(x2c) + (B(aA + 1) << 16n)) >> 4n);
      }
    } else {
      // perspective: planes of 1/z and attribute/z (0x30e83..0x311cc)
      const iz = (z) => asI32(B(Math.trunc(1099511627776 / z)) >> 12n);
      const izA = iz(Z[A]), izB = iz(Z[Bv]), izC = iz(Z[C]);
      {
        const e = (Math.imul(izC - izA, p24) + ((izA - izB) << 16)) | 0;
        DIZ = asI32((B(e) * B(inv50)) >> 30n);
        const sum = B(-DIZ | 0) * B(dxAC) + (B(izC - izA) << 12n);
        const e2 = asI32(sum >> 12n);
        DIZy = asI32((B(e2) * B(inv6c)) >> 18n);
        IZ0 = asI32((B(DIZy) * B(pre) - B(DIZ) * B(x2c) + (B(izA >>> 0) << 12n)) >> 4n);
      }
      for (let k = 0; k < na; k++) {
        const a = src[ATT[k]], aA = a[A], aB = a[Bv], aC = a[C];
        const pA = Math.imul(aA, izA) >> 8, pB = Math.imul(aB, izB) >> 8, pC = Math.imul(aC, izC) >> 8;
        const val = B(pC - pA) * B(p24) + (B(pA - pB) << 16n);
        const e = asI32(val >> 8n);
        const dAx = asI32((B(e) * B(inv50)) >> 22n);
        const sum = B(-dAx | 0) * B(dxAC) + (B(pC - pA) << 12n);
        const e2 = asI32(sum >> 8n);
        const dAy = asI32((B(e2) * B(inv6c)) >> 22n);
        D[k] = dAx; Dy[k] = dAy; A0[k] = asI32((B(dAy) * B(pre) - B(dAx) * B(x2c) + ((B(aA + 1) * B(izA)) << 4n)) >> 4n);
      }
    }
    // ---- scanlines
    const leftIsShort = wid > 0, S = persp ? 1 << (persp - 1) : 0, sh = persp - 1;
    let rowptr = row0 * pitch;
    for (let r = rows; r > 0; r--) {
      const xS = (r > rowsLow) ? xUp : xLow;
      let l = (leftIsShort ? xS : xLong) >> 16, rr = (leftIsShort ? xLong : xS) >> 16;
      if (l < xmin) l = xmin; if (rr >= xmax) rr = xmax;
      const n = rr - l;
      if (n > 0) {
        if (persp === 0) {
          for (let k = 0; k < na; k++) { acc[k] = (Math.imul(D[k], l) + A0[k]) | 0; dl[k] = D[k]; }
          this._fill(fb, rowptr + l, n, mat, mode);
        } else {
          // one reciprocal per span of S pixels (0x31560..0x3177e); the accumulators run on from span to span, only the increments are re-derived
          let spans = (n + S) >> sh; const rem = n & (S - 1);
          let ivz = (Math.imul(DIZ, l) + IZ0) | 0, o = rowptr + l;
          let recip = idiv(4294967296, ivz >> 4);
          for (let k = 0; k < na; k++) { L[k] = (Math.imul(D[k], l) + A0[k]) | 0; acc[k] = asI32((B(L[k]) * B(recip)) >> 16n); }
          while (spans > 1) {
            ivz = (ivz + (DIZ << sh)) | 0;
            recip = idiv(4294967296, ivz >> 4);
            for (let k = 0; k < na; k++) { L[k] = (L[k] + (D[k] << sh)) | 0; dl[k] = (asI32((B(L[k]) * B(recip)) >> 16n) - acc[k]) >> sh; }
            this._fill(fb, o, S, mat, mode); o += S; spans--;
          }
          if (rem > 0) {
            recip = idiv(4294967296, (Math.imul(DIZ, rem) + ivz) >> 4); const inv = idiv(0x40000000, rem);
            for (let k = 0; k < na; k++) { const E = asI32((B((Math.imul(D[k], rem) + L[k]) | 0) * B(recip)) >> 16n); dl[k] = asI32((B(E - acc[k] | 0) * B(inv)) >> 30n); }
            this._fill(fb, o, rem, mat, mode);
          }
        }
      }
      IZ0 = (IZ0 + DIZy) | 0;
      rowptr += pitch; xLong = (xLong + stepLong) | 0; xUp = (xUp + stepUp) | 0; xLow = (xLow + stepLow) | 0;
      for (let k = 0; k < na; k++) A0[k] = (A0[k] + Dy[k]) | 0;
    }
  }

  /** pixel loops of the self modifying inner loops (0x31494, 0x2f268, 0x2ea16, 0x32b60, 0x33100, 0x33a82); acc[]/dl[] = running attribute values / per pixel increments */
  _fill(fb, o, n, mat, mode) {
    const acc = this.acc, dl = this.dl, tex = mat.tex, ush = 24 - mat.ubits, vmaskSh = mat.vmask << (24 - mat.vbits), vshift = 24 - mat.vbits - mat.ubits, umask = mat.umask;
    let u = acc[0], v = acc[1], s = acc[2], q = acc[3];
    const du = dl[0], dv = dl[1], ds = dl[2], dq = dl[3];
    switch (mode) {
      case 0: { const shd = mat.shade;                        // 0x30e5c: shade[(s>>16)&255][tex]
        for (; n > 0; n--, o++) { fb[o] = shd[(((s >> 16) & 0xff) << 8) | tex[((u >> ush) & umask) + ((v & vmaskSh) >> vshift)]]; u = (u + du) | 0; v = (v + dv) | 0; s = (s + ds) | 0; } break; }
      case 1: for (; n > 0; n--, o++) { fb[o] = tex[((u >> ush) & umask) + ((v & vmaskSh) >> vshift)]; u = (u + du) | 0; v = (v + dv) | 0; } break;                       // 0x2edb0
      case 2: { const t1 = mat.shade, t2 = mat.shade2;       // 0x2e264: two shade tables, second shade = vertex +0x32
        for (; n > 0; n--, o++) { const a = t1[(((s >> 16) & 0xff) << 8) | tex[((u >> ush) & umask) + ((v & vmaskSh) >> vshift)]]; fb[o] = t2[(((q >> 16) & 0xff) << 8) | a]; u = (u + du) | 0; v = (v + dv) | 0; s = (s + ds) | 0; q = (q + dq) | 0; } break; }
      case 3: { const t = mat.shade;                         // 0x3269c: table[(texel<<8)|dst] (translucency / additive through a 256x256 table)
        for (; n > 0; n--, o++) { fb[o] = t[(tex[((u >> ush) & umask) + ((v & vmaskSh) >> vshift)] << 8) | fb[o]]; u = (u + du) | 0; v = (v + dv) | 0; } break; }
      case 4: { const t = mat.shade; s = acc[0]; const d0 = dl[0];   // 0x32dc8: no texture, dst = table[(s>>16)&255][dst]
        for (; n > 0; n--, o++) { fb[o] = t[(((s >> 16) & 0xff) << 8) | fb[o]]; s = (s + d0) | 0; } break; }
      case 5: { const lm = mat.lmap, t = mat.shade; let p = acc[2], r = acc[3]; const dp = dl[2], dr = dl[3];   // 0x332e0: light map lookup through the second uv set
        for (; n > 0; n--, o++) { const a = lm[(((r >> 16) & 0xff) << 8) | ((p >> 16) & 0xff)]; fb[o] = t[(a << 8) | tex[((u >> ush) & umask) + ((v & vmaskSh) >> vshift)]]; u = (u + du) | 0; v = (v + dv) | 0; p = (p + dp) | 0; r = (r + dr) | 0; }
        acc[2] = p; acc[3] = r; break; }
    }
    if (mode !== 4) { acc[0] = u; acc[1] = v; if (mode === 0 || mode === 2) acc[2] = s; if (mode === 2) acc[3] = q; } else acc[0] = s;
  }
}
