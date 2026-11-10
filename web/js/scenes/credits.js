// Scene 'credits' (29.5 s .. 59 s): flight through a procedural tube (tuubi.sro re-skinned every frame along the 'credits flight path'), 12 additive smoke/flare billboards,
// the spike ball (piikkis.sro, env-mapped, from 9:48 on), wtrmask table blend + the credit name sprites.  See re/notes_credits.md.
// original: init 0x22d10 (+path 0x2284c, smoke 0x22c70), A = 0x21f30 (per tick), B = 0x22794 (per frame; 0x221fc camera, 0x22470 tube, 0x223fc seam vertices)
import { Node, Mesh, Material, Sprite, parseSRO, mat3, FLAG, MODE } from '../engine3d.js';
import { CScene, Billboard, lookAt } from '../engine3d_credits.js';
import { Stepper } from '../engine.js';
import { PATH_B64 } from '../creditsdata.js';

const fr = Math.fround, trunc = Math.trunc;
const D = (hi, lo) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, lo >>> 0, true); d.setUint32(4, hi >>> 0, true); return d.getFloat64(0, true); };
const SPIN = [D(0x3f847ae1, 0x47ae147b), D(0x3f81c432, 0xca57a787), D(0x3f8930be, 0x0ded288d)];   // 0x220a... pushed doubles: ball rotation per tick (x,y,z)
// the screen shows what the frame function rendered one frame earlier, and the golden run's counters ([0x1058c8]) start 20 ticks after the music clock the script uses (catch-up at the first
// main-loop iteration): LAG = 10 + 20, calibrated against the golden run (pixel exact with it).
const LAG = 30;

let PATH = null;                       // Int32Array/Float32Array views of the 1024x27 table
function path() {
  if (PATH) return PATH;
  const s = atob(PATH_B64), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return PATH = { i: new Int32Array(u8.buffer), f: new Float32Array(u8.buffer) };
}
// the script runs once per main-loop iteration (here: 10 ticks, golden K=10) after the frame function: handler effects are seen from the next iteration
const q = (t) => Math.floor(t / 10) * 10;
const mod = (a, n) => ((a % n) + n) % n;

export default function make(dat) {
  const P = path();
  const pal = dat.pal('credits/tunnel.pal');
  const texTube = dat.get('credits/tunnel.raw'), shdTube = dat.get('credits/tunnel.shd');
  const matTube = new Material({ tex: texTube, shade: shdTube, ubits: 8, vbits: 10, umask: 0xff, vmask: 0x3ff });
  const matBall = new Material({ tex: dat.get('credits/piikkis.raw'), shade: null, ubits: 8, vbits: 8 });      // no shade table: face function 0x2edb0 (TEX) = pixel is the texel
  const scene = new CScene({ width: 320, height: 200, fov: 256, near: 0x4000, ambient: 0 });     // [0x3c]=0x100, [0x44]=0x4000
  const cam = scene.camera = new Node(); scene.add(cam);

  // tube: tuubi.sro (132 vertices = 11 rings of 12, 240 faces), scale 7.0, + 11 'seam' vertices (copies of the first vertex of every ring, u = 0x1005) used by faces 22,23 of ring gaps 0..8 (0x232f6..)
  const sro = parseSRO(dat.get('credits/tuubi.sro')), NV0 = sro.nv;
  const ext = { ...sro, nv: NV0 + 11 };
  for (const k of ['x', 'y', 'z']) { const a = new Int16Array(ext.nv); a.set(sro[k]); ext[k] = a; }
  for (const k of ['u', 'v']) { const a = new Uint16Array(ext.nv); a.set(sro[k]); ext[k] = a; }
  ext.fi = Int32Array.from(sro.fi);
  for (let g = 0; g < 9; g++) { ext.fi[(24 * g + 22) * 3] = NV0 + g; ext.fi[(24 * g + 22) * 3 + 1] = NV0 + g + 1; ext.fi[(24 * g + 23) * 3 + 1] = NV0 + g + 1; }
  const tube = new Mesh(ext, matTube, 7.0); tube.flags = FLAG.NOCULL; scene.add(tube);
  const ox = Int32Array.from(tube.vx.subarray(0, NV0)), oy = Int32Array.from(tube.vy.subarray(0, NV0));   // [0x107468]: untouched copy
  const L = tube.vz[13] - tube.vz[0];                                                                    // [0x107470] = 686 ([v+0x350]-[v+0x10])
  // spike ball (scale 0xcccc/65536), env-map uv from 2*normal (ENV_UV_N2), no lighting
  const ball = new Mesh(parseSRO(dat.get('credits/piikkis.sro')), matBall, 0xcccc / 65536); ball.flags = FLAG.ENV_UV_N2; ball.setMapper(MODE.TEX); scene.add(ball);
  // 12 smoke billboards (0x22c70)
  const sauhu = dat.get('credits/sauhu.raw'), smokeShd = dat.get('credits/smoke.shd');
  const smoke = []; for (let i = 0; i < 12; i++) { const b = new Billboard({ tex: sauhu, shade: smokeShd, stride: 64, w: 64, h: 64, s1: 1.0, k: 0.35, mode: 1 }); scene.add(b); smoke.push(b); }
  // sprites (0x31e50): 2 = wtrmask (table blend), 4 = credit names with tunnel.int
  const tint = dat.get('credits/tunnel.int');
  const wraw = dat.get('credits/wtrmask.raw'), wint = dat.get('credits/wtrmask.int');       // type 2 sprite 0x32174: dst = int[(mask<<8)|dst]
  const wmask = { draw(fb) { for (let i = 0; i < 64000; i++) fb[i] = wint[(wraw[i] << 8) | fb[i]]; } };
  const S = (n, w, h) => new Sprite(4, dat.get('credits/kredu' + n + '.raw'), w, h, w, { key: 0, shade: tint });
  const names = [S(1, 173, 75), S(7, 129, 75), S(2, 146, 75), S(8, 154, 70), S(3, 318, 82)];       // [0x1073c0 + 4*i], i = 0..4 (i=5: kredu6, hidden by the 'cmp [0x107438],5')
  

  // ---- callback A (0x21f30), once per tick: path position, roll, two smoothed path followers, ball spin
  let E = 1e9;                         // tick at which handler 0x21f10 set [0x107430]=1 (ball on, c850 starts to decrease)
  const R = mat3.euler(SPIN[0], SPIN[1], SPIN[2]);
  const lerpP = (j, fs, out, o) => {   // path point j, j+1 lerp with float32 fraction: x_j*(1-fs) + x_{j+1}*fs
    const a = 27 * j, b = 27 * (j + 1), w = 1 - fs;
    out[o] = (P.i[a] * w) + P.i[b] * fs; out[o + 1] = (P.i[a + 1] * w) + P.i[b + 1] * fs; out[o + 2] = (P.i[a + 2] * w) + P.i[b + 2] * fs;
  };
  const tmp = new Float64Array(6);
  const stepper = new Stepper(
    () => ({ t: 0, roll: 0, c850: 9, s1: new Float64Array(3), s2: new Float64Array(3), rot: mat3.identity() }),
    (s, n) => {
      const tn = s.t = fr(s.t + 47.0);
      s.roll = fr(s.roll + 0.01745329252);
      const ti = trunc(fr(tn / L)), j = mod(ti, 1024), T = trunc(tn), r = T % L, fs = fr(r / L);
      lerpP(j, fs, tmp, 0);
      for (let c = 0; c < 3; c++) s.s1[c] = s.s1[c] * 0.8 + tmp[c] * 0.2;
      mat3.mul(s.rot, R);
      if (n + 1 > E) s.c850 = fr(s.c850 + -0.015);      // flag is set by the script handler during tick E
      const j2 = mod(j + trunc(s.c850) + 3, 1024);
      lerpP(j2, fs, tmp, 3);
      for (let c = 0; c < 3; c++) s.s2[c] = s.s2[c] * 0.96 + tmp[3 + c] * 0.04;
    },
    (s) => ({ t: s.t, roll: s.roll, c850: s.c850, s1: Float64Array.from(s.s1), s2: Float64Array.from(s.s2), rot: Float64Array.from(s.rot) }), 128);

  const rz = new Float64Array(9), out = new Float64Array(3);
  function frame(T) {
    const s = stepper.at(T);
    // ---- 0x221fc: camera at trunc(S1), looks at a point a few rings ahead (x blended 0.8 cam / 0.2 path, y and z straight from the path: a quirk of the original)
    const ti = trunc(fr(s.t / L)), j = mod(ti, 1024), r = trunc(s.t) % L, f = r / L;
    cam.pos[0] = s.s1[0]; cam.pos[1] = s.s1[1]; cam.pos[2] = s.s1[2];
    const j3 = mod(j + 3, 1024), j4 = mod(j3 + 1, 1024), w = 1 - f;
    const a3 = 27 * j3, a4 = 27 * j4;
    const lx = P.i[a4] * f + P.i[a3] * w, ly = P.i[a4 + 1] * f + P.i[a3 + 1] * w, lz = P.i[a4 + 2] * f + P.i[a3 + 2] * w;
    lookAt(cam, trunc(lx * 0.2 + cam.pos[0] * 0.8), trunc(ly), trunc(lz));
    // ---- ball (0x223a2): matrix = spin matrix, position = trunc(S2)
    ball.setMatrix(s.rot); ball.setPos(s.s2[0], s.s2[1], s.s2[2]);
    // ---- 0x22470: tube node at the camera, ring vertices from the path
    tube.setPos(cam.pos[0], cam.pos[1], cam.pos[2]);
    const sg = idiv(trunc(s.t), L), s10 = sg % 10, M = cam.mat;
    let vi = 0;
    for (let m = 0; m < 11; m++) {
      const row = 27 * ((sg + m) % 1024), vV = Math.trunc(4096 * (s10 + m) / 10);
      for (let jj = 0; jj < 12; jj++, vi++) {
        const fj = P.f[row + 15 + jj], x0 = ox[vi] * fj, y0 = oy[vi] * fj;
        const px = P.i[row] + (M[0] * x0 + M[1] * y0) , py = P.i[row + 1] + (M[3] * x0 + M[4] * y0), pz = P.i[row + 2] + (M[6] * x0 + M[7] * y0);
        const vx = trunc(px - cam.pos[0]), vy = trunc(py - cam.pos[1]), vz = trunc(pz - cam.pos[2]);
        tube.vx[vi] = vx; tube.vy[vi] = vy; tube.vz[vi] = vz;
        const dist = Math.sqrt((Math.imul(vx, vx) + Math.imul(vy, vy) + Math.imul(vz, vz)) | 0), ex = trunc(dist - 7 * L);
        let sh = P.i[row + 3 + jj]; if (ex > 0) sh -= ex; if (sh < 0x70) sh = 0x70;
        tube.vsh[vi] = sh; tube.vu[vi] = trunc(jj * 256 * 16 * 0.08333333333333333); tube.vv[vi] = vV;
      }
    }
    for (let k = 0; k < 11; k++) {            // 0x223fc: seam vertices = copies of vertex 0 of each ring, u = 0x1000/L + 0x1000
      const q = NV0 + k, p = 12 * k;
      tube.vx[q] = tube.vx[p]; tube.vy[q] = tube.vy[p]; tube.vz[q] = tube.vz[p]; tube.vsh[q] = tube.vsh[p]; tube.vv[q] = tube.vv[p]; tube.vu[q] = idiv(0x1000, L) + 0x1000;
    }
    for (let k = 0; k < 12; k++) { const row = 27 * ((sg + k) % 1024); smoke[k].setPos(P.i[row] + 180, P.i[row + 1] + 180, P.i[row + 2]); }
    // ---- roll: cam.mat = look * Rz(roll)   (0x30070)
    mat3.mul(cam.mat, mat3.euler(0, 0, s.roll, rz));
  }

  return {
    id: 'credits', scriptQuant: 10, scriptLag: 10, palette: pal, scene, tube, ball, cam, frame,
    render(fb, tick, rt) {
      const evs = (rt && rt.events) || [];
      const e = evs.find(x => x.fn === '0x21f10'); if (e) E = q(e.tick);
      const T = Math.max(0, tick - LAG);
      if (T < 10) { fb.fill(0); return; }       // first frame function call at scene tick 10 (the golden run shows 2 odd start-up frames here: stale/half-drawn page buffers)
      frame(T);
      const on = T > E; if (on) ball.flags &= ~FLAG.DISABLED; else ball.flags |= FLAG.DISABLED;
      scene.clear(fb, 0); scene.render(fb);
      if (!on) wmask.draw(fb, 0, 0);
      let c = -1; for (const x of evs) if (x.fn === '0x21f1c' && q(x.tick) < T) c++;
      if (c >= 0 && c < 5) names[c].draw(fb, 0, 117);
    },
  };
}
const idiv = (a, b) => Math.trunc(a / b);
