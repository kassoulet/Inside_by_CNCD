// Scene 'tunnel2' = the 'temple' scene (157.45 s .. 182.75 s): a camera orbiting (pivot node, rotating 0.01 rad/tick) inside a glass temple (temple/mesta21..23.sro, texture temple.raw),
// three light-beam pipes (putki.sro, SHADEDST face function = darken/lighten what is behind), 10 additive flare billboards (flare.raw/flare.shd), one point light.  See re/notes_tunnel2.md.
// original: start 0x2061c, init 0x20464 (+ 0x1f900 scene graph, 0x1f9c8 objects/flares), A = 0x2007c (per tick, 0x1ff10), B = 0x20424 (per frame; 0x200b0 = node update, 0x286ac render)
// The frame function does NOT clear the screen: the two page buffers alternate, so pixels no face covers keep the picture of two frames earlier ('stale pixel' trick), see render().
import { Node, Mesh, Light, Material, parseSRO, mat3, FLAG, MODE } from '../engine3d.js';
import { CScene, Billboard } from '../engine3d_credits.js';
import { Stepper } from '../engine.js';

const trunc = Math.trunc;
const LAG = 20;            // = 10 (display delay of the page flip) + 10 (phase of the golden run: golden.py 157.451 starts the scene counters 10 ticks later); see notes
const C4OFF = 10;          // golden run: [0x1058c4] (global tick) = [0x1058c8] (scene tick) + 10.  (a real run would pass rt.tick; only a phase of the sinusoids)
// flare positions (rand() at init 0x1fda8..: x = rand()%1000-500, y = rand()%300+70, z = rand()%1000-500; dumped from the emulator, table 0x106c78 doubles)
const FLARES = [[-267, 188, -335], [-203, 345, -25], [-491, 342, -204], [-223, 138, 160], [-478, 86, -423], [-170, 228, -114], [-480, 152, -137], [-260, 196, -250], [-45, 134, 469], [-83, 118, -374]];
const PI2 = 1.5707963268, DEG = 0.01745329252;

export default function make(dat, opt = {}) {
  const c4off = opt.c4off ?? C4OFF;
  const pal = dat.pal('temple/temple.pal');
  const tex = dat.get('temple/temple.raw'), tint = dat.get('temple/temple.int'), fshd = dat.get('temple/flare.shd');
  const mat1 = new Material({ tex, shade: tint, ubits: 8, vbits: 8 });                                       // [0x106ebc]
  const mat2 = new Material({ tex, shade: fshd.subarray(0x2000), ubits: 8, vbits: 8 });                     // [0x106ec0]: shade = flare.shd + 0x2000
  const scene = new CScene({ width: 320, height: 200, fov: 0xaa, near: 0x2000, ambient: 0 });
  const pivot = new Node(); scene.add(pivot);                                                                   // [0x106ecc]
  const cam = scene.camera = new Node(); cam.parent = pivot; scene.add(cam);                                                   // [0x106e74] 'camera', child of the pivot
  const S1 = 0x1999 / 65536;
  // mesta2x.sro have a different 0x14-byte header (u32 size, vertex ofs, nv, face ofs, nf) instead of the 0x20 byte one with the magic; the loader ignores the first dword
  const sro = (f) => { const u = Uint8Array.from(dat.get('temple/' + f)); new DataView(u.buffer).setUint32(0, 0x001df020, true); return parseSRO(u); };
  const mk = (f, mapper, flags) => { const m = new Mesh(sro(f), mat1, S1); m.flags = flags; m.setMapper(mapper); scene.add(m); return m; };
  const obj = [mk('mesta21.sro', MODE.TEX, FLAG.ENV_UV_N2), mk('mesta22.sro', MODE.BLEND, FLAG.ENV_UV_N2), mk('mesta23.sro', MODE.GOURAUD, FLAG.AMBIENT)];
  // three pipes: putki.sro (15 vertices, 20 faces), recentred on vertex 12 (0x2d72c), scaled (0x2d6c8), face material mat2, SHADEDST
  const pipe = [0, 1, 2].map(k => {
    const m = mk('putki.sro', MODE.SHADEDST, 0); m.fmat.fill(mat2);
    if (k < 2) { const dx = -m.vx[12], dy = -m.vy[12], dz = -m.vz[12]; for (let i = 0; i < m.nv; i++) { m.vx[i] += dx; m.vy[i] += dy; m.vz[i] += dz; } }
    const sx = k < 2 ? Math.fround(1.5) : Math.fround(3.0), sz = k < 2 ? Math.fround(5.3) : Math.fround(4.6);
    for (let i = 0; i < m.nv; i++) { m.vx[i] = trunc(m.vx[i] * sx); m.vy[i] = trunc(m.vy[i] * sx); m.vz[i] = trunc(m.vz[i] * sz); }
    m._normals(); m._bbox(); return m;
  });
  const fl = FLARES.map(() => { const b = new Billboard({ tex: dat.get('temple/flare.raw'), shade: fshd, stride: 0x80, w: 0x80, h: 0x68, s1: 1.0, k: 0.25, mode: 1 }); scene.add(b); return b; });
  const light = new Light(500, 0x640); scene.add(light);                                                       // [0x106e5c]
  const mp5 = mat3.euler(PI2, 0, 0);                                                                           // 0x106c30, static

  // A (0x1ff10): Mpivot *= Euler(0,0.01,0); Mcam *= Euler(0,0,0.005) once per tick (Mcam starts as Euler(0.2618, 0, pi))
  const Ry = mat3.euler(0, 0.01, 0), Rz = mat3.euler(0, 0, 0.005);
  const D = (hi, lo) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, lo >>> 0, true); d.setUint32(4, hi >>> 0, true); return d.getFloat64(0, true); };
  const stepper = new Stepper(
    () => ({ mp: mat3.identity(), mc: mat3.euler(D(0x3fd0c152, 0x382daf40), 0, Math.PI) }),
    (s) => { mat3.mul(s.mp, Ry); mat3.mul(s.mc, Rz); },
    (s) => ({ mp: Float64Array.from(s.mp), mc: Float64Array.from(s.mc) }), 128);

  const m3 = new Float64Array(9), m4 = new Float64Array(9);
  function frame(T) {
    const s = stepper.at(T), c4 = T + c4off;
    // 0x1ff10 (the part after the per-flare loop): pipe orientations from c4
    const P = Math.sin(c4 * 0.00558659217877095) * 35.0 * DEG, Q = Math.cos(c4 * 0.00432152117545376) * 33.3 * DEG;
    mat3.euler(P + PI2, Q, 0, m3); mat3.euler(PI2 - P, -Q, 0, m4);
    // 0x200b0: node update
    pivot.setMatrix(s.mp); cam.setMatrix(s.mc);
    const g = Math.sin(c4 * 0.001122208506340478) * 0.3 + 0.6;
    cam.setPos(0 * g, 320 * g, -850 * g);
    obj.forEach(m => { m.setPos(0, 0, 0); m.setMatrix(mat3.identity(m3.slice())); });
    pipe[0].setPos(0, -150, 0); pipe[0].setMatrix(m3); pipe[1].setPos(0, -150, 0); pipe[1].setMatrix(m4); pipe[2].setPos(0, 100, 0); pipe[2].setMatrix(mp5);
    for (let i = 0; i < 6; i++) {
      const w = Math.sin((c4 + 265 + 53 * i) / ((55 + 11 * i) + 971.1)) * 16.0 * 16.0 * 0.95, v = 5 + i;
      pipe[0].vsh[v] = trunc(w + 256); pipe[1].vsh[v] = trunc(w + 320); pipe[2].vsh[v] = trunc(w + 352);
    }
    for (let j = 0; j < 10; j++) {
      const f = Math.abs(Math.sin((c4 + 13 * j) * 0.0036886757654002217) * 0.7) + 0.15, p = FLARES[j];
      fl[j].setPos(p[0] * f, p[1] * f, p[2] * f);
    }
    light.range = trunc(Math.abs(Math.sin(c4 * 0.002168726957276079)) * 1000);
  }

  // The frame function never clears the screen and the two page buffers alternate: frame k (scene tick 10k, golden K=10) is drawn over the picture of frame k-2.
  // Pixels no triangle covers (cracks between faces, off-screen parts) therefore keep old content.  Emulated by replaying the frames with two buffers (checkpoints every 16 frames).
  const frames = new Stepper(() => ({ b: [new Uint8Array(64000), new Uint8Array(64000)] }),
    (s, n) => { const k = n + 1; frame(10 * k); scene.render(s.b[k & 1]); },
    (s) => ({ b: [Uint8Array.from(s.b[0]), Uint8Array.from(s.b[1])] }), 16);
  return {
    id: 'tunnel2', palette: pal, scene, frame, startFlash: true,
    render(fb, tick) {
      const k = Math.floor((tick - LAG) / 10);
      if (k < 1) { fb.fill(0); return; }
      fb.set(frames.at(k).b[k & 1]);
    },
  };
}
