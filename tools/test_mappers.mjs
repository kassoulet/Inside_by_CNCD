// node tools/test_mappers.mjs cases.json : replay the emulator-recorded mapper cases (tools/mapper_cases.py) through engine3d.js
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const { Scene, Material, MODE } = await import(web + '/js/engine3d.js');
const cases = JSON.parse(fs.readFileSync(process.argv[2]));
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const stat = {};
for (const c of cases) {
  const sc = new Scene({ width: 320, height: 200 }); sc._setup(); sc.xmax_ = c.W;
  const mat = new Material({ tex: b64(c.texb), shade: b64(c.tB), shade2: b64(c.tC), lmap: b64(c.tA), ubits: c.tw, vbits: c.th });
  const fb = b64(c.fb0); const rs = sc.rs;
  c.verts.forEach((v, i) => { rs.x[i] = v.x; rs.y[i] = v.y; rs.z[i] = v.z; rs.u[i] = v.u; rs.v[i] = v.v; rs.s[i] = v.s; rs.s2[i] = v.s2; rs.u2[i] = v.u2; rs.v2[i] = v.v2; });
  try { rs.tri(sc, fb, mat, c.flags, 0, 1, 2, MODE[c.mode.toUpperCase()]); } catch (e) { stat[c.mode + ' ERR ' + e.message] = (stat[c.mode + ' ERR ' + e.message] || 0) + 1; continue; }
  const out = b64(c.out); let bad = 0, drawn = 0; const f0 = b64(c.fb0);
  for (let i = 0; i < 64000; i++) { if (fb[i] !== out[i]) bad++; if (out[i] !== f0[i]) drawn++; }
  const k = c.mode + ' persp=' + ((c.flags >> 10) & 7); stat[k] = stat[k] || { cases: 0, exact: 0, badpx: 0, drawn: 0 };
  const e = stat[k]; e.cases++; if (!bad) e.exact++; e.badpx += bad; e.drawn += drawn;
}
console.table(stat);
