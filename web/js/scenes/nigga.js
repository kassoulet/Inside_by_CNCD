// Scene 'nigga' (59.0-68.9 s and 136.6-147.6 s).  See re/notes_nigga.md.
// Variants 1/2 (warped 7x7 quad mesh, two textures combined through a 256x256 table, + sprite): engine mesh drawn by face function 0x33a82 (= MODE.LIGHTMAP), bit-exact against the emulator.
// Variants 3/4 (original: textured+Gouraud-lit 'kuubio' room box, camera/light animation, shadow quad): APPROXIMATION, see notes.
import { Scene, Node, Mesh, Light, Material, parseSRO, mat3, MODE } from '../engine3d.js';
const R = 10000 / 35, LAG = 10, FRAME_TICKS = 20;   // the golden captures (K=10) render one nigga frame per 20 ticks (the frame-wait spin loop injects extra ISR ticks); the frame rate is machine bound, so this is a REAL-tick quantity (see render3: scaled by spd)
const hexd = (h) => new DataView(Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16))).buffer).getFloat64(0, true);
// Variants 3/4 (0x20bf3..0x20f5c): the 'kuubio' room box (poksi.sro, 98 vertices, Gouraud + shade table through MODE.GOURAUD 0x30e5c), one point light and a 4 vertex shadow quad drawn through
// a 16 level table (MODE.BLEND 0x3269c) with the engine ('Surrender'); everything below was read from the emulator (node/material dumps) and the code:
// camera at a fixed position/matrix (set by the start handler; after event 0x21f00 its y drops by 30 per frame), box matrix Ry(0.01 per tick) drawn with the 10 tick frame lag,
// light position/peak and the shadow vertex 1 are closed forms of the global tick T (the x87 code at 0x20c18 / 0x20d2f).
const V34 = {
  3: { cam: [-1600, 2000, -2200], camM: ['7fa790473492eb3f', 'c6eb265832ccc1bf', 'b60291be4b3edf3f', '504a1e32d35b9abf', '4d47d491785aee3f', '0369947bc132d43f', '4b63183cd938e0bf', 'b8d2def9fd34d2bf', 'd426f021b209ea3f'].map(hexd),
       shM: [-0.9899924966004454, 0, 0.1411200080598672, 0.1407665005492413, 0.0707372016677029, 0.9875125521345757, -0.009982434469478687, 0.9974949866040544, -0.07002929888153839],
       sv: [[0, 0, 0], [0, 0, 0], [400, -2400, 0], [1948, -1600, 0]], sbits: 7, tex: 'nigga9', sh: 'shadow9' },
  4: { cam: [-550, 2000, -500], camM: ['48ae2b7785b9d83f', '4de3e5a5f421e7bf', 'cedd0d2aee54e23f', '772120026019d63f', 'ca737dac820ee63f', 'dc10bf2cb161e43f', '696b64aa8b5eebbf', '281f67a60cb4a8bf', 'ccb6ee013982e03f'].map(hexd),
       shM: [Math.cos(1), 0, Math.sin(1), 0, 1, 0, -Math.sin(1), 0, Math.cos(1)],
       sv: [[900, 700, 500], [0, 0, 500], [900, 700, -700], [-750, 700, -700]], sbits: 8, tex: 'nigga4', sh: 'shadow4' },
};
const S0 = Math.ceil(58.995 * R - 1e-9), N1 = Math.ceil(68.917 * R - 1e-9) - S0;           // A ticks in period 1
const E1 = Math.ceil(61.533 * R - 1e-9) - S0;                                              // 0x20680 event (period 1), in A ticks
const PRE = { st: [0.07, 0.05, -0.06], f: [0.3, 0.2, 0.4, 0.6, 0.7, 0.5], a: [425, 130, 250] };
const POST = { st: [-0.07, -0.08, -0.06], f: [-0.3, -0.2, -0.4, -0.6, -0.7, -0.5], a: [-435, -150, -250] };   // set by 0x20680
const POS = { 1: [0, 44], 2: [0, 0], 3: [46, 53], 4: [94, 28] };   // measured against the golden frames (0x31df0 args: v3 = 320-w,200-h)
const SPR = { 1: ['sprite1', 164, 156], 2: ['sprite2', 172, 200], 3: ['sprite9', 274, 147], 4: ['sprite4', 170, 168] };
const FILE = { 1: 'nigga1', 2: 'nigga2', 3: 'nigga9', 4: 'nigga4' };
export default function make(dat) {
  const V = {}, B3 = {};
  function box3(v) {      // engine scene of variant v (3 or 4), built once
    if (B3[v]) return B3[v];
    const d = V34[v], sc = new Scene({ width: 320, height: 200, fov: 0x100, near: 0x1600, ambient: 0x70 });
    const cam = sc.camera = new Node(); cam.setPos(...d.cam); cam.setMatrix(Float64Array.from(d.camM)); sc.add(cam);
    const tx = dat.get(`nigga/${d.tex}.raw`), qn = dat.get(`nigga/${d.tex}.qnt`);
    const mBox = new Material({ tex: tx, shade: qn, ubits: 8, vbits: 8, flags: 1, uvs: [0, 0xff0, 0xff0, 0xff0, 0xff0, 0] }), mBox1 = new Material({ tex: tx, shade: qn, ubits: 8, vbits: 8, flags: 1, uvs: v === 3 ? [0, 0, 0, 0xff0, 0xff0, 0] : [0, 0, 0xff0, 0, 0, 0xff0] });   // the two per-triangle uv sets of the room (materials 0x106fdc / 0x106fd4), alternating faces
    const box = new Mesh(parseSRO(dat.get('nigga/poksi.sro')), mBox, 8); box.setMapper(MODE.GOURAUD); for (let f = 1; f < box.nf; f += 2) box.fmat[f] = mBox1; sc.add(box);
    const light = new Light(0x1388, 1408); sc.add(light);
    const mSh = new Material({ tex: dat.get(`nigga/${d.sh}.raw`), shade: dat.get(`nigga/${d.sh}.sdw`), ubits: d.sbits, vbits: d.sbits });
    const quad = new Mesh({ nv: 4, nf: 2, x: Int16Array.from(d.sv.map(p => p[0])), y: Int16Array.from(d.sv.map(p => p[1])), z: Int16Array.from(d.sv.map(p => p[2])), u: new Uint16Array(4), v: new Uint16Array(4),
      fi: Int32Array.from([0, 1, 2, 2, 1, 3]), fw: new Uint16Array(2) }, mSh, 1);
    quad.vu.set([4080, 0, 4080, 0]); quad.vv.set([0, 0, 4080, 4080]); quad.setMapper(MODE.BLEND); quad.setPos(300, 3000, 600); quad.setMatrix(Float64Array.from(d.shM));
    quad.flags |= 0x100; quad.bias = 666666; sc.add(quad);       // node flag +0xc5 bit 0 (no cull), sort bias 666666: drawn after the room
    const rotY = mat3.euler(0, v === 4 ? -0.01 : 0.01, 0);   // the start handlers (0x2185c / 0x21ba0) reset the box matrix to identity and set the per-tick rotation (0x106ed8) to Ry(+-0.01)
    const cp = [mat3.identity()], cur = mat3.identity(); let curT = 0;
    const matrixAt = (t) => { const k = Math.min(Math.floor(t / 64), cp.length - 1); if (t < curT || Math.floor(curT / 64) < k) { mat3.copy(cur, cp[k]); curT = k * 64; }
      while (curT < t) { mat3.mul(cur, rotY); curT++; if (curT % 64 === 0 && cp.length === curT / 64) cp.push(Float64Array.from(cur)); } return cur; };
    return B3[v] = { sc, cam, box, light, quad, matrixAt, d };
  }
  function render3(fb, u, rt, v) {
    const o = box3(v), T = rt.tick - LAG, d = o.d, c = Math.cos, sn = Math.sin, tr = Math.trunc;
    const e4 = v === 4 ? rt.events.find(e => e.fn === '0x21ba0') : null;
    o.box.setMatrix(o.matrixAt(Math.max(0, u - (e4 ? e4.tick : 0))));
    const ev = rt.events.find(e => e.fn === '0x21f00'), nf = ev && u >= ev.tick ? Math.floor((u - ev.tick) / (FRAME_TICKS * (rt.spd || 1))) : 0;   // frames since the event (frames are real-time, u is in scene ticks: x spd; verified vs K=1 golden: no +1): y -= 30 per frame, and x -= 15 in variant 4 (0x20861..0x2088f)
    o.cam.setPos(d.cam[0] - (v === 4 ? 15 * nf : 0), d.cam[1] - 30 * nf, d.cam[2]);
    o.light.peak = tr(400 * sn(T * 0.0033255736614566014) + 1200);
    if (v === 3) {
      o.quad.vx[1] = tr(2048 - 512 * c(T * 0.005537098560354375) * sn(T * 0.004805382027871216)); o.quad.vy[1] = tr(1024 * c(T * 0.0056625141562853904) * sn(T * 0.0061236987140232705));
      o.light.setPos(tr(1750 * c(T * 0.005537098560354375) * sn(T * 0.004805382027871216)), tr(1750 * c(T * 0.0056625141562853904) * sn(T * 0.0061236987140232705)), tr(1750 * c(T * 0.00508646998982706) * sn(T * 0.006648936170212766)));
    } else {
      o.quad.vx[1] = tr(-750 + 200 * c(T * 0.007656967840735069) * sn(T * 0.004805382027871216)); o.quad.vy[1] = tr(500 + 500 * c(T * 0.0056625141562853904) * sn(T * 0.0088261253309797));
      o.light.setPos(tr(1750 * c(T * 0.007656967840735069) * sn(T * 0.004805382027871216)), tr(1750 * c(T * 0.0056625141562853904) * sn(T * 0.0088261253309797)), tr(1750 * c(T * 0.00508646998982706) * sn(T * 0.006648936170212766)));
    }
    o.sc.clear(fb, 0); o.sc.render(fb);
  }
  for (const v of [1, 2, 3, 4]) {
    const pal = dat.pal(`nigga/${FILE[v]}.pal`); pal[0] = pal[1] = pal[2] = 0;
    V[v] = { pal, tex: dat.get(`nigga/${FILE[v]}.raw`), shd: v < 3 ? dat.get(`nigga/${FILE[v]}.shd`) : null, spr: dat.get(`nigga/${SPR[v][0]}.raw`), sw: SPR[v][1], sh: SPR[v][2] };
  }
  const at = new Float64Array(256);
  const ev = (seg, fn) => { const e = seg.events.find(x => x.fn === fn); return e ? e.tick : 1e9; };
  const variantAt = (seg, t) => seg.fn === '0x217bc' ? (t >= ev(seg, '0x21ba0') ? 4 : 2) : (t >= ev(seg, '0x2171c') ? 1 : 3);
  const PH = new Map();
  function phase(P, m) {   // the three phase accumulators [0x103810/824/838] += step every ISR tick, in float32 (verified on the emulator's vertex attributes: 0 of 6656 values differ, against 98 with m*step)
    let t = PH.get(P); if (!t) PH.set(P, t = [[0, 0, 0]]);
    while (t.length <= m) { const q = t[t.length - 1]; t.push(q.map((x, i) => Math.fround(x + Math.fround(P.st[i])))); }
    return t[m];
  }
  function warp(n, v) {   // vertex attributes (+0x28,+0x2a,+0x2c,+0x2e) for A tick n; 0x207a0..0x20b79
    const ev2 = E1, E2 = N1 + 0;  // period-2 event handled by caller through n offset (see render)
    const P = n.post ? POST : PRE, p = phase(P, n.m);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const a = P.f[0] * i + p[0] + P.f[1] * j, b = P.f[2] * i + p[1] + P.f[3] * j, c = P.f[4] * i + p[2] + P.f[5] * j, k = (j * 8 + i) * 4;
      if (v < 3) {
        at[k] = Math.trunc(i * 512 + P.a[0] * Math.sin(a) + P.a[1] * Math.sin(b) + P.a[2] * Math.sin(c));
        at[k + 1] = Math.trunc(j * 512 + P.a[0] * Math.cos(a) + P.a[1] * Math.cos(b) + P.a[2] * Math.cos(c));
        at[k + 2] = Math.trunc(j * 512 + P.a[2] * Math.sin(a) + P.a[1] * Math.cos(b) + P.a[0] * Math.sin(c));
        at[k + 3] = Math.trunc(i * 512 + P.a[2] * Math.cos(a) + P.a[1] * Math.cos(b) + P.a[0] * Math.sin(c));
      } else { at[k] = i * 512; at[k + 1] = j * 512; at[k + 2] = 0; at[k + 3] = 0; }
    }
  }
  function drawSprite(fb, v) {
    const vv = V[v];
      // sprite (0x324ec): transparent blit, colour key 0, clipped
    const px = POS[v][0], py = POS[v][1];
    for (let y = 0; y < vv.sh; y++) { const Y = py + y; if (Y < 0 || Y >= 200) continue;
      for (let x = 0; x < vv.sw; x++) { const X = px + x; if (X < 0 || X >= 320) continue; const q = vv.spr[y * vv.sw + x]; if (q) fb[Y * 320 + X] = q; } }
  }
  const G12 = {};
  function grid(v) {   // variants 1/2: the 8x8 vertex warped grid as an engine mesh drawn by face function 0x33a82 (= MODE.LIGHTMAP: texel2 = tex[(v2,u2)], pixel = shd[texel2<<8|texel1])
    if (G12[v]) return G12[v];
    const sc = new Scene({ width: 320, height: 200, fov: 0x100, near: 0x1600, ambient: 0x70 }), cam = sc.camera = new Node(); cam.setPos(0, 0, -1300); sc.add(cam);
    const sp = 350, o = 1400, x = new Int16Array(64), y = new Int16Array(64), z = new Int16Array(64), fi = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x[j * 8 + i] = -o + sp * i; z[j * 8 + i] = -o + sp * j; }
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) { const a = j * 8 + i; fi.push(a, a + 1, a + 8, a + 8, a + 1, a + 9); }
    const m = new Material({ tex: V[v].tex, shade: V[v].shd, lmap: V[v].tex, ubits: 8, vbits: 8 });
    const mesh = new Mesh({ nv: 64, nf: 98, x, y, z, u: new Uint16Array(64), v: new Uint16Array(64), fi: Int32Array.from(fi), fw: new Uint16Array(98) }, m, 1);
    mesh.setMapper(MODE.LIGHTMAP); mesh.flags |= 0x100; sc.add(mesh);
    const rotY = mat3.euler(0, 0.01, 0), cp = [Float64Array.from(V34[3].shM)], cur = Float64Array.from(cp[0]); let curT = 0;   // M(n) = G0 * Ry(0.01)^n accumulated tick by tick like 0x30070 (G0 = start matrix read from the emulator)
    const matrixAt = (t) => { const k = Math.min(Math.floor(t / 64), cp.length - 1); if (t < curT || Math.floor(curT / 64) < k) { mat3.copy(cur, cp[k]); curT = k * 64; }
      while (curT < t) { mat3.mul(cur, rotY); curT++; if (curT % 64 === 0 && cp.length === curT / 64) cp.push(Float64Array.from(cur)); } return cur; };
    return G12[v] = { sc, mesh, matrixAt };
  }
  const pend = {};
  return {
    id: 'nigga', palette: V[2].pal, _dbg: B3,
    basePalette(t, seg) { return V[variantAt(seg, t)].pal; },
    render(fb, t, rt) {
      const seg = rt.seg, per2 = seg.fn !== '0x217bc', u = Math.max(0, t - LAG), v = variantAt(seg, u);
      if (v >= 3) { render3(fb, u, rt, v); drawSprite(fb, v); return; }
      const nA = (per2 ? N1 : 0) + u;                                        // A ticks since the first start of the scene
      const e2 = N1 + (Math.ceil(146.449 * R - 1e-9) - Math.ceil(136.604 * R - 1e-9));
      const st = per2 ? (nA >= e2 ? { post: 1, m: nA - e2 } : { post: 1, m: nA - E1 }) : (nA >= E1 ? { post: 1, m: nA - E1 } : { post: 0, m: nA });
      warp(st, v);
      const g = grid(v); g.mesh.setMatrix(g.matrixAt(nA));
      for (let k = 0; k < 64; k++) { g.mesh.vu[k] = at[k * 4]; g.mesh.vv[k] = at[k * 4 + 1]; g.mesh.vu2[k] = at[k * 4 + 2]; g.mesh.vv2[k] = at[k * 4 + 3]; }
      g.sc.clear(fb, 0); g.sc.render(fb); drawSprite(fb, v); return;
    },
  };
}
