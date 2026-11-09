// Scene 'flight': heightfield fly-over with 3 ships and a sun/lens flare (see re/notes_flight.md).
// Drawn with the engine (engine3d.js): terrain node (19x19 vertices, faces 0x2e264/0x30e5c), 3 ship nodes (ship.sro scaled 0.1, env map uv, face function 0x2edb0), camera node;
// the camera/ship nodes (int positions + double matrices) come from FlightSim (flightlib.js): the original's rand()-driven ship/camera simulation re-derived (0x1ddbc, 0x1e0f8, 0x1e638), stepped from the scene start.
import { Node, Mesh, Material, FLAG, MODE, parseSRO } from '../engine3d.js';
import { makeTerrain, fillTerrain, FlightScene, SpriteNode, FlightSim } from '../flightlib.js';
const NF = 563;                       // frames of the scene (5630 ticks)
const sim = new FlightSim(), rec = (i) => sim.frame(i);   // record i = state at the render of B call i (stepped lazily from the start, cached: seek = lookup / replay)
const FT = 10;                        // ticks per rendered frame of the path table (original frame function = 10 ticks at the reference speed)
const LAG = 3.1 + (globalThis.__FDF || 0);   // exact: golden frame g (sceneTick 10g+11) shows the render of B call g-2
const tmp = new Float64Array(48);
function state(tick) {                // record i = state at the render of B call i; between records linear interpolation (exact at the records)
  let x = tick / FT - LAG; x = x < 0 ? 0 : x > NF - 1 ? NF - 1 : x;
  const i = Math.floor(x), t = x - i, j = Math.min(i + 1, NF - 1), a = rec(i), b = rec(j);
  if (t === 0) { for (let k = 0; k < 48; k++) tmp[k] = a[k]; return tmp; }
  for (let k = 0; k < 48; k++) tmp[k] = a[k] * (1 - t) + b[k] * t;
  for (let o = 0; o < 4; o++) for (let k = 0; k < 3; k++) tmp[o * 12 + k] = Math.trunc(tmp[o * 12 + k]);
  return tmp;
}
export default function make(dat) {
  const pal = dat.pal('flight/map.pal');
  const fshd = dat.get('flight/flare.shd');
  const scene = new FlightScene({ width: 320, height: 200, fov: 200, near: 0x2000 });   // scene fields [+0x3c] = 200, [+0x44] = 0x2000
  const cam = scene.camera = new Node(); scene.add(cam);
  const sro = parseSRO(dat.get('flight/ship.sro')), env = new Material({ tex: dat.get('flight/river.raw'), shade: null, ubits: 8, vbits: 8 });
  scene.far = 0x400000;                                                          // scene [+0x48]
  const sunTex = dat.get('flight/sun.raw'), L = [1, 2, 3, 4, 5].map(i => dat.get('flight/lens' + i + '.raw'));
  const FL = [[3, 12, 11, 0], [4, 4, 4, -0.2], [4, 4, 4, 0.5], [3, 12, 11, 0.3], [4, 4, 4, -1.3], [0, 74, 63, -0.9], [1, 52, 43, -0.47], [2, 31, 23, -2.0]];   // lens index, w, h, k (0x1e3d4, created in this order)
  const flares = FL.map(([li, w, h, k]) => new SpriteNode(L[li], w, h, k, 64, 0x9c000000 | 0, 1, fshd));
  const sun = new SpriteNode(sunTex, 128, 128, 1, 70, 0, 0, null);
  const ships = [];
  for (let k = 0; k < 3; k++) { const m = new Mesh(sro, env, 0.1); m.flags = FLAG.ENV_UV_N2; m.setMapper(MODE.TEX); ships.push(m); }
  for (let k = 7; k >= 0; k--) scene.add(flares[k]);                              // node list order of the original (the list is built by prepending: last created first)
  scene.add(sun); scene.add(ships[2]); scene.add(ships[1]); scene.add(ships[0]);   // 0x1515e20, 0x150d9d0, 0x1505580
  const terr = makeTerrain(dat.get('flight/map.raw'), dat.get('flight/map.shd'), dat.get('flight/map.fog')); scene.add(terr);
  return {
    id: 'flight', palette: pal, startFade: 0x3c, scene,
    render(fb, tick, rt) {
      const p = state(tick);
      fb.fill(221);
      // sun node = ship 0 + (-143360, -20480 absolute, 0); flares (same position) are shown only when the sun is within the screen +-12 px (0x1e4d0)
      const m = p.subarray(3, 12), dx = p[12] - 143360 - p[0], dy = -20480 - p[1], dz = p[14] - p[2];
      const Z = (m[2] * dx + m[5] * dy + m[8] * dz) / 512, X = 0.78125 * (m[0] * dx + m[3] * dy + m[6] * dz) / 512, Y = 0.78125 * (m[1] * dx + m[4] * dy + m[7] * dz) / 512;
      const sx = 160 + 256 * X / Z, sy = 100 + 256 * Y / Z, vis = Z > 0.125 && sx >= -12 && sx < 332 && sy >= -12 && sy < 212;
      cam.setPos(p[0], p[1], p[2]); cam.setMatrix(m);
      sun.setPos(p[12] - 143360, -20480, p[14]);
      for (const f of flares) { f.setPos(p[12] - 143360, -20480, p[14]); if (vis) f.flags &= ~FLAG.DISABLED; else f.flags |= FLAG.DISABLED; }
      for (let k = 0; k < 3; k++) { const o = 12 * (k + 1); ships[k].setPos(p[o], p[o + 1], p[o + 2]); ships[k].setMatrix(p.subarray(o + 3, o + 12)); }
      fillTerrain(terr, p[0], p[1], p[2]);
      scene.render(fb);
    },
  };
}
