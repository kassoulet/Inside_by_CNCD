// Scene 'twirl' (147.6 s..157.5 s).  Port of 0x26678 (start), 0x2620c (A: phase accumulators, per ISR tick), 0x26264 (B: per frame),
// 0x265a4 (256-entry wobble table W), 0x2654c (per-pixel lookup), 0x2629c+0x26408 (polar 'twirl table' T, built once at load), 0x26098 (variant event).
// out[p] = tex[0x8000 + int16(T1[p] + W[T0[p]])]   (T0 = radius byte, T1 = (radius<<8)+angle byte, i.e. a texture offset around the middle of the 64K texture)
const f = Math.fround;
// 8-float parameter sets at 0x197c68 + 32*k (dumped from the running original); event k uses set (1+k)%5, start uses set 1
const SETS = [[0.02, 0.12, 45, 1, 0, 0, 0, 0], [0, -0.04, 99, 0, 0, 0.04, 98, 0.03], [0, 0, 0, 0, -2, 0.02, 189, 0], [0.42, -0.1, 13, 0, -2, 0, 0, 0], [0.34, 0.08, 12, 0, 3, 0, 0, 0]].map(s => s.map(f));
const TEX = ['flower/jeesus1.raw', 'nigga/nigga2.raw', 'nigga/nigga4.raw', 'flower/jeesus2.raw', 'flight/river.raw'];
const PAL = ['flower/jeesus.pal', 'nigga/nigga2.pal', 'nigga/nigga4.pal', 'flower/jeesus.pal', 'flight/map.pal'];
function buildT() { // 0x2629c: for r (512 rings, step .43) x angle (1024, step 2pi/1024): pixel (160+r cos, 100+r sin) <- (angle/4-128, r/4-128); last write wins
  const lo = new Int16Array(64000), hi = new Int16Array(64000);
  for (let ri = 0; ri < 512; ri++) { const r = ri * 0.43, rv = (ri >> 2) - 128;
    for (let ai = 0; ai < 1024; ai++) { const a = ai * 0.006135923;
      const x = Math.trunc(Math.cos(a) * r + 160), y = Math.trunc(Math.sin(a) * r + 100);
      if (x < 320 && x > -1 && y < 200 && y > -1) { const p = y * 320 + x; lo[p] = (ai >> 2) - 128; hi[p] = rv; } } }
  const t0 = new Uint8Array(64000), t1 = new Uint16Array(64000);   // 0x26408
  for (let p = 0; p < 64000; p++) { t0[p] = hi[p] & 255; t1[p] = ((hi[p] << 8) + (lo[p] & 255)) & 0xffff; }
  return { t0, t1 };
}
export default function make(dat) {
  const tex = TEX.map(n => dat.get(n)), pals = PAL.map(n => { const p = dat.pal(n); p[0] = p[1] = p[2] = 0; return p; });
  const palette = dat.pal(PAL[0]);
  let T = null; const W = new Int16Array(256);
  let st = null; // accumulator simulation (monotonic cache)
  const mkst = () => ({ tick: 0, a58: 0, a2c: 0, a50: 0, a34: 0, k: 0 });
  // 0x26098 fires at 149.526 s, then (table order!) 30:48 = 151.372 s and the 30:12 entry (already due) in the same frame, then 155.372 s; relative to 147.603 s.
  // The script runs once per main-loop iteration (FRAME_TICKS=10 ticks) and the picture shown lags the clock by one frame: quantise like the original (checked vs golden).
  const PALD = 0, R = 10000 / 35, S0 = Math.ceil(147.603 * R - 1e-9), LAG = 10;
  const EV = [149.526, 151.372, 151.372, 155.372].map(x => 10 * Math.ceil((Math.ceil(x * R - 1e-9) - S0 + 3) / 10) - 10);
  return {
    id: 'twirl', palette,
    basePalette(t) { let k = 0; for (const x of EV) if (t >= x + PALD) k++; return k ? pals[k % 5] : palette; },
    render(fb, t) {
      t = Math.max(0, t - LAG);
      if (!T) T = buildT();
      const ev = EV;
      if (!st || t < st.tick) st = mkst();
      let par = SETS[(1 + st.k) % 5];
      while (st.tick < t) { // A: once per ISR tick
        while (st.k < ev.length && ev[st.k] <= st.tick) { st.k++; par = SETS[(1 + st.k) % 5]; }
        st.a58 = f(st.a58 + par[3]); st.a2c = f(st.a2c + par[4]); st.a50 = f(st.a50 + par[1]); st.a34 = f(st.a34 + par[5]); st.tick++;
      }
      let k = 0; for (const x of ev) if (t > x) k++;
      par = SETS[(1 + k) % 5]; const tx = tex[k % 5];
      // 0x265a4
      const base = ((Math.trunc(st.a2c) << 8) + Math.trunc(st.a58)) | 0, p10 = par[2], p24 = par[6], p14 = par[7], p18 = par[0];
      let b = st.a50, a = st.a34;
      for (let j = 0; j < 256; j++) { W[j] = (Math.trunc(Math.sin(b) * p10) << 8) + base + Math.trunc(Math.sin(a) * p24); b += p18; a += p14; }
      const t0 = T.t0, t1 = T.t1;
      for (let p = 0; p < 64000; p++) fb[p] = tx[(0x8000 + ((t1[p] + W[t0[p]]) << 16 >> 16)) & 0xffff];
    },
  };
}
