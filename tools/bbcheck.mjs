// node tools/bbcheck.mjs calls.json : replays the inputs of every call of the original 0x31878 (hook output of an emulator run) through bbGeom and compares the geometry
import fs from 'fs'; import { bbGeom } from '../web/js/engine3d_credits.js';
const calls = JSON.parse(fs.readFileSync(process.argv[2])); let bad = 0, nres = 0, exitMis = 0;
for (const c of calls) {
  const sc = { near: c.near, far: c.far, fx: c.F, fy: c.G, cx: c.cx, cy: c.cy, ymin16: c.ymin16, xmin16: c.xmin16, xmax_: c.xmax, ymax_: c.ymax };
  const g = bbGeom(sc, { Z: c.Z, X: c.X, Y: c.Y, s1: c.s1, k: c.k, w: c.w, h: c.h }), r = c.res;
  if (!g !== !r) { exitMis++; if (exitMis < 5) console.log('exit mismatch', JSON.stringify(c), g && [g.top, g.bot, g.left, g.right]); continue; }
  if (!r) continue; nres++;
  const mine = [g.top, g.bot, g.left, g.right, g.dun, g.dvn, g.DUf, g.U0f, g.Vn], ref = [r.top, r.bot, r.left, r.right, r.du, r.dv, r.DUf, r.U0f, r.V];
  if (mine.some((v, i) => v !== ref[i])) { if (bad++ < 5) console.log('DIFF', JSON.stringify(c), '\n mine', mine, '\n ref ', ref); }
}
console.log('calls', calls.length, 'drawn', nres, 'geometry mismatches', bad, 'exit mismatches', exitMis);
