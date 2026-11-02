// Scene 'water' (start 0x23f90, A = 0x23c78 per tick, B = 0x23d78 per frame, init 0x23dec).  See re/notes_water.md.
//  - background: a 320x200 picture (water.raw) refracted through a classic 2-buffer 16 bit ripple simulation (0x1d234); drops fall at random (0x238d4),
//    and the 8 'waterfish' (3D objects) leave a small triangular splash at their screen position (0x23400).
//  - 3D: obuke.sro (287 v / 570 f, scale 0.6) spinning about Y at (-600,0,0) seen from a camera at (0,0,-1600); both it and the 8 fish (fish.sro, 8 v / 10 f, scale 0.15)
//    are environment mapped (ENV_UV_N2, texture waterenv.raw). Spiral: face function 0x2edb0 (plain texture), fish: 0x3269c (table[texel<<8 | dst] = water.int, translucency).
//  - per rendered frame state (fish heading/position, ripple buffers, rand stream) is replayed with Stepper; one B call per FRAME_TICKS ticks.
import { Scene, Node, Mesh, Material, parseSRO, mat3, MODE, FLAG } from '../engine3d.js';
import { Rand, Stepper } from '../engine.js';
import { SEED, T0, FISH, OBMAT_AT_B0 } from '../waterdata.js';

const W = 320, H = 200, N = W * H, FRAME_TICKS = 10;
const LAG = 2;                                  // display lag in frames between a B call and the screen capture (calibrated against the golden)
const f64 = (hi, lo) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, lo, true); d.setUint32(4, hi, true); return d.getFloat64(0, true); };
const PI_ORIG = f64(0x400921fb, 0x544486e0);    // the 'pi' pushed at 0x23717 (slightly below Math.PI)
const A_ANG = f64(0x3f92f1a9, 0xfbe76c8b);      // per tick Y rotation of the spiral (0x23c80)
const A_INIT = f64(0x3fc65718, 0x4ae79455);     // initial Y angle of the spiral (0x23b09)
const DEG = 0.01745329252;

// the original loader 0x2cbb0 ignores the first dword; water/obuke.sro has magic 0x1f58 instead of 0x1df020 (vertex offset 0x14, 287 v, 570 f) -> patch a copy so parseSRO accepts it
const sro = (u8) => { const c = Uint8Array.from(u8); new DataView(c.buffer).setUint32(0, 0x001df020, true); return c; };

export default function make(dat, opt = {}) {      // opt.seed / opt.t0: override rand state and tick phase (tests against a golden run started elsewhere)
  const seed0 = opt.seed !== undefined ? opt.seed : SEED, t00 = opt.t0 !== undefined ? opt.t0 : T0;
  const bg = dat.get('water/water.raw'), pal = dat.pal('water/water.pal');
  const tex = dat.get('water/waterenv.raw');
  const matSpiral = new Material({ tex, shade: dat.get('water/water.shd'), ubits: 8, vbits: 8 });
  const matFish = new Material({ tex, shade: dat.get('water/water.int'), ubits: 8, vbits: 8 });
  const scene = new Scene({ width: W, height: H, fov: 0x100, near: 0x1c00, ambient: 0 });     // 0x23ef2 (+0x3c), 0x23efe (+0x44), 0x23f0a (+0x40)
  scene._setup();                                                // derived constants (focal lengths, centre) are needed by the fish projection before the first render
  const cam = scene.camera = new Node(); cam.setPos(0, 0, -1600); scene.add(cam);              // 0x23a2a..: vector (0,0,-1600), identity matrix
  const spiral = new Mesh(parseSRO(sro(dat.get('water/obuke.sro'))), matSpiral, 0x9999 / 65536); spiral.flags = FLAG.ENV_UV_N2; spiral.setMapper(MODE.TEX);
  spiral.setPos(-600, 0, 0); scene.add(spiral);                                              // vector (-600,0,0) at 0x23ae5
  const fishSro = parseSRO(dat.get('water/fish.sro'));
  const fish = [];
  for (let i = 0; i < 8; i++) {
    const m = new Mesh(fishSro, matFish, 0x2666 / 65536); m.flags = FLAG.ENV_UV_N2; m.setMapper(MODE.BLEND); m.bias = 0xfffc1800 | 0;   // [+0xcc]
    scene.add(m); fish.push(m);
  }
  const vx = [fish[0].vx[4], fish[0].vx[5], fish[0].vx[6]]; void vx;

  // ---- per B-call simulation state --------------------------------------------------------------
  const init = () => ({
    P: new Int16Array(N), Q: new Int16Array(N),      // [0x1075e4] (written, 'old') and [0x1075d8] ('current'); swapped after every frame
    seed: seed0, ob: spiralMatrix0(), obUsed: new Float64Array(9),                  // rand state, spiral matrix (after the 10 A ticks before the first B)
    pos: FISH.map(f => Int32Array.from(f.pos)), mat: FISH.map(f => Float64Array.from(f.mat)), out: new Float64Array(2),
  });
  const rotA = mat3.euler(0, A_ANG, 0);
  function spiralMatrix0() { const m = mat3.euler(0, A_INIT, 0); for (let k = 0; k < FRAME_TICKS; k++) mat3.mul(m, rotA); return m; }
  const clone = (s) => ({ P: s.P.slice(), Q: s.Q.slice(), seed: s.seed, ob: Float64Array.from(s.ob), obUsed: Float64Array.from(s.obUsed), pos: s.pos.map(a => Int32Array.from(a)), mat: s.mat.map(a => Float64Array.from(a)), out: Float64Array.from(s.out) });
  const rnd = new Rand(1);
  const fy = () => scene.fy, fx = () => scene.fx;
  // 0x2de80: world position -> screen (doubles); returns false when nearer than near/256 (the original then leaves the output untouched)
  let firstCall = false;
  function project(ax, ay, az, out) {
    const cx = ax - 0, cy = ay - 0, cz = az - (-1600);            // camera at (0,0,-1600), identity matrix (0x304ec with the transposed camera matrix)
    if (!(scene.near * 0.00390625 <= cz)) return false;
    if (firstCall) { out[0] = 0; out[1] = 0; return true; }       // the very first B call runs before the first render: scene +0x10..+0x1c (centre, focal) are still 0 (0x284e4 fills them)
    const C = 6.103515625e-05;
    out[0] = ((fx() * C) * (cx * 128)) / cz + scene.cx; out[1] = ((fy() * C) * (cy * 128)) / cz + scene.cy; return true;
  }
  // 0x23400(i, t): move fish i, maybe splash into P
  function fishStep(s, i, t) {
    const S = (Math.sin((t + 171 * i) * 0.001584786053882726) + Math.cos((t - 57 * i) * 0.0027019724398811133)) + Math.cos(-t * 0.008130081300813007) * 0.1;
    const M = s.mat[i]; mat3.rotY(M, S * DEG);                    // 0x305ac -> 0x30344
    let speed = S * 30 + 10; if (!(speed >= 15)) speed = 15;
    const p = s.pos[i];
    const nx = p[0] + (M[2] * speed), ny = p[1] + (M[5] * speed), nz = p[2] + (M[8] * speed);   // 0x2fd58: pos += M * (0,0,speed)
    p[0] = Math.trunc(nx); p[1] = Math.trunc(ny); p[2] = Math.trunc(nz);
    const o = s.out; project(nx, ny, nz, o);
    if (o[0] < -70) mat3.rotY(M, PI_ORIG); if (o[0] > 390) mat3.rotY(M, PI_ORIG);
    if (o[1] < -70) mat3.rotY(M, PI_ORIG); if (o[1] > 270) mat3.rotY(M, PI_ORIG);
    rnd.s = s.seed; let splash = 600;
    if (rnd.next() % 300 === 0) splash = rnd.next() % 40000;
    s.seed = rnd.s;
    if (o[0] > 3 && o[0] < W - 3 && o[1] > 3 && o[1] < H - 3) {
      const X = Math.trunc(o[0]), Y = Math.trunc(o[1]), P = s.P;
      for (let bx = -2; bx < 3; bx++) for (let dy = -3; dy < bx; dy++) P[(Y + dy) * W + X + bx] = splash;   // triangle: dy from -3 while dy < bx
    }
  }
  function step(s, n) {                                          // one B call (index n)
    const t = t00 + FRAME_TICKS * n;
    s.obUsed.set(s.ob); firstCall = n === 0;
    for (let i = 0; i < 8; i++) fishStep(s, i, t);
    rnd.s = s.seed;                                              // 0x23903: 3 drop attempts
    for (let k = 0; k < 3; k++) {
      if (rnd.next() % 200 !== 0) continue;
      const x = rnd.next() % (W - 20) + 10, y = rnd.next() % (H - 20), v = rnd.next() % 20000;
      for (let c = -3; c < 4; c++) for (let r = y + 7; r < y + 14; r++) s.P[r * W + x + c] = v;
    }
    s.seed = rnd.s;
    // 0x1d234: P = damped wave step from Q, refraction is done at render time from the new P
    const P = s.P, Q = s.Q;
    for (let i = 0; i < (H - 4) * W; i++) {
      const c = i + W;
      let v = ((Q[c - 1] + Q[c + 1] + Q[c - W] + Q[c + W]) >> 1) - P[c];
      v -= v >> 4;
      if (v > 0x3fff) v = 0x3fff; else if (v < -0x3fff) v = -0x3fff;
      P[c] = v;
    }
    s.P = Q; s.Q = P;                                            // 0x239d4: swap
    // A: 10 ticks of Y rotation before the next B (tick count of the next frame)
    for (let k = 0; k < FRAME_TICKS; k++) mat3.mul(s.ob, rotA);
  }
  const st = new Stepper(init, step, clone, 32);

  const wig = new Float64Array(6);
  function render(fb, tick, rt) {
    const n = Math.max(-1, Math.floor(tick / FRAME_TICKS) - LAG);          // B call index displayed
    if (n < 0) { fb.fill(0); return; }
    // golden check hook
    const s = st.at(n + 1);
    const t = t00 + FRAME_TICKS * n;
    // background: rows 0,1,198,199 black (0x23d98..), rows 2..197 = water.raw sampled at an offset given by the height (0x1d2b7: -(h>>5))
    fb.fill(0, 0, 2 * W); fb.fill(0, (H - 2) * W, N);
    const Q = s.Q;
    for (let i = 0; i < (H - 4) * W; i++) fb[2 * W + i] = bg[2 * W + i - (Q[i + W] >> 5)];
    // 3D
    spiral.setMatrix(s.obUsed);
    // fish vertex wiggle 0x23400 (stateless function of t): vertices 4,5,6 and their normals
    const a = Math.sin(t * 0.022222222222222223), b = Math.sin(t * 0.02702702702702703), c = Math.sin(t * 0.01639344262295082);
    wig[0] = Math.trunc(-a * 15); wig[1] = Math.trunc(-b * 20); wig[2] = Math.trunc(c * 25);
    wig[3] = Math.trunc(a * 800); wig[4] = Math.trunc(b * 800); wig[5] = Math.trunc(c * 800);
    for (let i = 0; i < 8; i++) {
      const m = fish[i]; m.setPos(s.pos[i][0], s.pos[i][1], s.pos[i][2]); mat3.copy(m.mat, s.mat[i]);
      m.vx[4] = wig[0]; m.vx[5] = wig[1]; m.vx[6] = wig[2]; m.vnx[4] = wig[3]; m.vny[5] = wig[4]; m.vnz[6] = wig[5];
    }
    scene.render(fb);
  }
  void OBMAT_AT_B0;
  return { id: 'water', palette: pal, render, scene, st };
}
