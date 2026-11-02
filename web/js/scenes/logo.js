// Scene 'logo' (0x1f164 start, 0x1ee30 = per tick callback A, 0x1ef1c = per frame function B, init 0x1ef9c).  See re/notes_logo.md.
//  - 3D: obuke.sro (130 vertices, 256 faces: a big spiky star, the camera sits INSIDE it at (0,0,100)) textured with the twirl texture twlogo.raw and lit by one
//    point light at the origin; the object spins: callback A multiplies its matrix by a constant small rotation once per 285.7 Hz tick.
//  - 2D: 'logo mask' (inmask.raw 253x147, shade-table blit through inmask.shd) at (31,9), and after script event 0x1ef10 (4:32) the logo text inside.raw 249x139 at (34,13).
import { Scene, Node, Mesh, Light, Material, Sprite, parseSRO, mat3 } from '../engine3d.js';

const f64 = (hi, lo) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, lo, true); d.setUint32(4, hi, true); return d.getFloat64(0, true); };
// the three angles pushed at 0x1efb9..0x1efd2 for 0x305f4(0x106018): rotation about X, Y, Z per tick
// the picture on screen at tick T was rendered by the frame function one frame (FRAME_TICKS = 10 ticks in the golden captures) earlier
const LAG = 10;
const ANG = [f64(0xbf847ae1, 0x47ae147b), f64(0x3f816872, 0xb020c49c), f64(0x3f894855, 0xda272863)];

export default function make(dat) {
  const tex = dat.get('logo/twlogo.raw'), shd = dat.get('logo/logo.shd'), pal = dat.pal('logo/logo.pal');
  const mat = new Material({ tex, shade: shd, ubits: 8, vbits: 8 });
  const scene = new Scene({ width: 320, height: 200 });                       // 0x2c878 + 0x2c618(320,200)
  const cam = scene.camera = new Node(); cam.setPos(0, 0, 100); scene.add(cam);   // 'camera' node, position from the double vector 0x106178 = (0,0,100)
  const light = new Light(0x226, 0x640); scene.add(light);                    // 0x1edca..: range 550, peak 1600, at the origin
  const mesh = new Mesh(parseSRO(dat.get('logo/obuke.sro')), mat, 1); scene.add(mesh);
  const rot = mat3.euler(ANG[0], ANG[1], ANG[2]);                             // 0x106018
  // callback A (0x1ee30): M190 = M190 * rot once per tick; M190 starts as identity (0x1edc5)
  const cp = [mat3.identity()]; let curT = 0; const cur = mat3.identity(); const STEP = 64;
  function matrixAt(t) {
    let k = Math.min(Math.floor(t / STEP), cp.length - 1);
    if (t < curT || Math.floor(curT / STEP) < k) { mat3.copy(cur, cp[k]); curT = k * STEP; }
    while (curT < t) { mat3.mul(cur, rot); curT++; if (curT % STEP === 0 && cp.length === curT / STEP) cp.push(Float64Array.from(cur)); }
    return cur;
  }
  const mask = new Sprite(4, dat.get('logo/inmask.raw'), 253, 147, 253, { key: 0, shade: dat.get('logo/inmask.shd') });
  const text = new Sprite(3, dat.get('logo/inside.raw'), 249, 139, 249, { key: 0 });
  return {
    id: 'logo', palette: pal, scene, mesh, matrixAt,
    render(fb, tick, rt) {
      mesh.setMatrix(matrixAt(Math.max(0, tick - LAG)));
      scene.clear(fb, 0); scene.render(fb);
      mask.draw(fb, 31, 9);
      const ev = rt && rt.events && rt.events.find(e => e.fn === '0x1ef10');
      if (ev && tick >= ev.tick) text.draw(fb, 34, 13);
    },
  };
}
