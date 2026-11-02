// Scene 'intro': 320x200 picture revealed by "light drops" (re/notes_intro.md).  Pixel = shd[min(max(lightbuf,0),63)<<8 | tex].
// Per frame (10 ISR ticks): A(t)=0x1f214 per tick moves the emitter centre, then B=0x1f748 once: drops (0x1f37c), blur (0x1f674), draw, shade (0x1f6e8).
import { Rand, Stepper } from '../engine.js';
import { FRAME_TICKS } from '../script.js';
const N = 64000, MAXP = 130, FT = FRAME_TICKS, FLAG_FRAME = 422; // 0x1f1a0 fires after B(4220) = frame 422: from then on the number of live drops grows 22 -> 128
// other scene inits run before the intro starts: the flight init (0x1e948) does srand(0x45eafc) (0x1e95d), then 63 rand() calls
// (0x1d9e3.., 0x1eb6a.., 0x1fdad.., 0x23b90..) happen before A(1): the intro's rand() stream starts from this state.
const LAG = 2;   // the original shows the frame rendered 2 main-loop iterations earlier (present is pipelined): matches golden captures
const SEED_A1 = 4164772783;
const rnd = (r, m) => r.next() % m;

function init() {            // 0x1f770: seed=1 (no rand() before), 130 drops at random places with energy 0; emitter = (200,150)
  const r = new Rand(1), px = new Float32Array(MAXP), py = new Float32Array(MAXP), pe = new Int32Array(MAXP);
  for (let i = 0; i < MAXP; i++) { px[i] = rnd(r, 320); py[i] = rnd(r, 200); }
  r.s = SEED_A1;
  return { s: r.s, px, py, pe, a: 200, b: 150, cnt: 22, flag: 0, lb: new Int16Array(N) };
}
function clone(o) { return { s: o.s, px: o.px.slice(), py: o.py.slice(), pe: o.pe.slice(), a: o.a, b: o.b, cnt: o.cnt, flag: o.flag, lb: o.lb.slice() }; }

// one demo frame = FRAME_TICKS ISR ticks: A runs once per tick (ISR, clock [0x1058c8]), then B once (main loop). n = frames done so far.
function step(S, n) {
  const r = new Rand(0); r.s = S.s;
  for (let t = n * FT + 1; t <= n * FT + FT; t++) {          // ---- A: 0x1f214
    S.a += Math.sin(t * 0.02) * 10 * 4.7 + Math.cos(t * 0.02320185614849188) + Math.sin(t * 0.03690036900369004) * 4.4;
    S.b += Math.cos(t * 0.03184713375796178) * 12 * 3.7 + Math.cos(t * 0.027700831024930747) + Math.sin(t * 0.024330900243309004) * 2.6;
    if (S.a > 319) S.a = rnd(r, 40) + 30;
    if (S.a < 0) S.a = rnd(r, 50) + 250;
    if (S.b > 199) S.b = rnd(r, 20) + 30;
    if (S.b < 0) S.b = rnd(r, 20) + 160;
  }
  // ---- B: 0x1f37c
  const { px, py, pe, lb } = S;
  if (S.flag > 0 && S.cnt < 0x80) S.cnt++;
  for (let i = 0; i < S.cnt; i++) {
    if (rnd(r, 20) === 0) {                                // respawn near the emitter
      px[i] = Math.trunc(rnd(r, 90) + S.a - 40);
      py[i] = Math.trunc(rnd(r, 80) + S.b - 40);
      pe[i] = rnd(r, 0x1964) + S.cnt * 100;
      if (r.next() === 0) pe[i] = -pe[i];                  // (1/32768 chance: sete + idiv 3 is true only for rand()==0)
      pe[i] += (S.cnt - 22) * 30;
    }
    if (px[i] < 0) px[i] = rnd(r, 50) + 260;
    if (py[i] < 0) py[i] = rnd(r, 30) + 160;
    if (px[i] > 319) px[i] = rnd(r, 30) + 50;
    if (py[i] > 199) px[i] = rnd(r, 30) + 45;              // sic: original writes x here
    const x = px[i], y = py[i];
    if (!(1 > x) && !(x >= 319) && !(1 > y) && !(y >= 199)) {
      const dx = 80 - x, dy = 80 - y;
      if (Math.sqrt(dx * dx + dy * dy) >= 60) {            // no light inside the disc around (80,80)
        const o = Math.trunc(y) * 320 + Math.trunc(x), v = lb[o] + pe[i];
        lb[o] = v < -30000 ? -30000 : v > 30000 ? 30000 : v;
      }
    }
  }
  S.s = r.s;
  // ---- 0x1f674: in-place 4-1-1-1-1 /8 smoothing (left/up already smoothed, right/down old), rows 1..197, cols 1..318
  for (let y = 1; y < 198; y++) {
    let o = y * 320 + 1;
    for (let x = 1; x < 319; x++, o++) lb[o] = ((lb[o] << 2) + lb[o - 1] + lb[o + 1] + lb[o - 320] + lb[o + 320]) / 8 | 0;
  }
}
export default function make(dat) {
  const tex = dat.get('intro/intro.raw'), shd = dat.get('intro/intro.shd'), pal = dat.pal('intro/intro.pal');
  const st = new Stepper(init, (S, n) => {
    if (n === FLAG_FRAME) { // 0x1f1a0: flag=1, all drops re-randomised with energy 0x1b58 (consumes rand() before A(4221))
      const r = new Rand(0); r.s = S.s; S.flag = 1;
      for (let i = 0; i < MAXP; i++) { S.px[i] = rnd(r, 320); S.py[i] = rnd(r, 200); S.pe[i] = 0x1b58; }
      S.s = r.s;
    }
    step(S, n);
  }, clone, 48);
  return {
    id: 'intro', palette: pal,
    render(fb, tick) {
      const lb = st.at(Math.max(tick - LAG * FT, 0) / FT | 0).lb;
      for (let i = 0; i < N; i++) { const l = lb[i]; fb[i] = shd[((l < 0 ? 0 : l > 63 ? 63 : l) << 8) + tex[i]]; }
    },
  };
}
