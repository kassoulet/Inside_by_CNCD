// Scene 'flight': heightfield fly-over with 3 ships and a sun/lens flare (see re/notes_flight.md).
import { Terrain } from '../flightlib.js';
import { PATH, NF } from '../flightdata.js';
const FT = 10;                        // ticks per rendered frame of the path table (original frame function = 10 ticks at the reference speed)
const LAG = 2.6 + (globalThis.__FDF || 0);   // the display lags the simulated state (render in iteration k is presented ~2.5 frames later): sceneTick T shows state T/FT - LAG (tuned on the golden)
const tmp = new Float64Array(48);
function state(tick) {                // linear interpolation of the sampled sim state (closed form of the tick)
  let x = tick / FT - LAG; x = x < 0 ? 0 : x > NF - 1 ? NF - 1 : x;
  const i = Math.floor(x), t = x - i, j = Math.min(i + 1, NF - 1);
  for (let k = 0; k < 48; k++) tmp[k] = PATH[i * 48 + k] * (1 - t) + PATH[j * 48 + k] * t;
  return tmp;
}
export default function make(dat) {
  const pal = dat.pal('flight/map.pal');
  const terr = new Terrain(dat.get('flight/map.raw'), dat.get('flight/map.shd'), dat.get('flight/map.fog'));
  terr.fshd = dat.get('flight/flare.shd');
  const sunTex = dat.get('flight/sun.raw'), L = [1, 2, 3, 4, 5].map(i => dat.get('flight/lens' + i + '.raw'));
  const FL = [[3, 12, 11, 0], [4, 4, 4, -0.2], [4, 4, 4, 0.5], [3, 12, 11, 0.3], [4, 4, 4, -1.3], [0, 74, 63, -0.9], [1, 52, 43, -0.47], [2, 31, 23, -2.0]];   // lens index, w, h, k (0x1e3d4)
  const DK = (globalThis.__P && globalThis.__P.dk) || 25400;
  terr.setShip(dat.get('flight/ship.sro'), dat.get('flight/river.raw'));
  return {
    id: 'flight', palette: pal, startFade: 0x3c,
    render(fb, tick, rt) {
      const p = state(tick);
      fb.fill(221);
      // sun: 143360 units west of ship 0, 20480 up; screen position as for terrain vertices
      const m = p.subarray(3, 12), dx = p[12] - 143360 - p[0], dy = -20480 - p[1], dz = p[14] - p[2];
      const Z = (m[2] * dx + m[5] * dy + m[8] * dz) / 512, X = 0.78125 * (m[0] * dx + m[3] * dy + m[6] * dz) / 512, Y = 0.78125 * (m[1] * dx + m[4] * dy + m[7] * dz) / 512;
      let sx = 0, sy = 0, vis = Z > 0.125;
      if (vis) { sx = 160 + 256 * X / Z; sy = 100 + 256 * Y / Z; terr.sprite(fb, sunTex, 128, 128, sx, sy, DK / Z, DK / Z * 5 / 6, true); }   // sprites use F=200 on both axes (no 5/6 aspect), sizes carry the 5/6
      terr.setup(p[0], p[1], p[2], p.subarray(3, 12));
      for (let k = 0; k < 3; k++) { const o = 12 * (k + 1); terr.setupShip(k, p[o], p[o + 1], p[o + 2], p.subarray(o + 3, o + 12), p[0], p[1], p[2], p.subarray(3, 12)); }
      terr.render(fb, (globalThis.__P && globalThis.__P.noship) ? 0 : 3);
      if (vis && sx > -12 && sx < 332 && sy > -12 && sy < 212)
        for (const [li, w, h, k] of FL) terr.sprite(fb, L[li], w, h, 160 + k * (sx - 160), 100 + k * (sy - 100), w * 5 / 6, h * 25 / 36);
    },
  };
}
