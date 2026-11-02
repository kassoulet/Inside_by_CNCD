// Scene 'flower' (68.9 .. 98.4 s).  See re/notes_flower.md.  Start handler 0x258c4, init 0x25730, callback A (per tick) 0x2540c, frame function B 0x255f8, stop 0x25e90.
//  - tunnel (tunneli1.sro: 732 vertices, 1440 faces) textured with jeesus2.raw: face uv comes from the material rectangle (mat+0x20..0x34, scrolled by 59/tick), vertex shade = a fixed
//    pseudo random table made by the init (embedded below), a sliding window of 349 faces is visible (A advances it 0.75 face/tick); camera flies along the .lws camera path (266 frames, 0.15 frame/tick).
//  - flower: kukka1.sro (111 vertices, 125 faces) morphing between kukka1 and one of the other 9 shape files, t = |sin(phase)|, child of the camera 1500 units ahead, spinning;
//    unshaded texture (jeesus1.raw) with env-map uv generated from the normals (ENV_UV_N2).  Script events 0x25358 (open: next shape, white/invert flash) and 0x253f0 (close).
import { Node, Mesh, Material, mat3, FLAG } from '../engine3d.js';
import { FlowerScene, parseSROAny, identityShade, loadLWS, sampleCamera, morphMesh } from '../engine3d_flower.js';

// per vertex shade of the tunnel written by the init at 0x259e9 (300*sin(.05*x)*cos(.04*y) + 700*sin(.04926*i) + rand()%600-300 clamped to 0..0x3ff; the rand() state is the one of
// the program start, so the values were dumped from the emulated original after the init)
const TUNNEL_SHADE = Int16Array.from([
  0,0,362,0,119,0,16,274,529,802,814,83,361,25,262,882,619,276,550,377,575,529,453,362,
  630,676,678,897,895,549,921,541,448,640,738,757,894,1018,620,778,462,343,447,614,313,407,182,537,
  217,629,313,352,346,378,505,316,279,563,451,0,54,7,0,0,114,472,90,185,48,0,0,0,
  18,33,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,46,0,157,168,257,166,128,505,283,622,0,337,609,438,543,484,317,933,673,715,
  10,406,488,424,780,609,392,63,941,726,609,1023,788,575,770,679,746,782,427,842,515,563,748,939,
  515,237,701,751,618,902,767,300,635,614,491,498,441,425,242,423,429,0,327,0,0,635,0,295,
  0,412,293,0,0,0,0,0,0,0,18,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,289,37,589,183,0,0,285,0,580,
  144,261,467,640,635,344,623,363,664,298,319,664,625,677,232,571,404,310,753,550,936,992,574,803,
  899,730,340,547,714,680,353,393,865,842,549,431,769,815,1023,465,428,563,291,426,314,245,555,0,
  529,7,316,0,309,0,18,0,0,318,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,293,0,0,
  306,0,308,113,331,0,182,0,410,330,457,517,489,933,507,509,419,543,576,823,814,700,485,501,
  807,813,237,511,652,409,443,457,986,1023,1023,842,568,735,466,685,772,834,713,248,400,483,864,461,
  131,229,228,867,558,585,424,445,0,190,108,330,192,213,0,0,171,0,0,0,0,0,0,0,
  0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,82,0,0,0,0,
  216,0,0,0,0,100,0,496,135,24,0,534,354,266,41,329,33,453,565,396,602,637,1023,794,
  635,496,482,830,555,649,957,429,495,179,676,846,494,857,717,915,915,505,647,470,550,821,309,708,
  506,729,724,823,277,579,641,378,512,587,598,0,619,300,353,584,11,0,452,24,303,175,0,79,
  152,0,0,27,0,0,0,0,169,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,99,0,0,0,0,0,0,46,84,0,202,0,0,0,198,169,215,499,749,0,273,
  0,297,249,332,215,590,125,696,800,826,474,422,719,490,767,735,568,587,885,619,633,628,912,580,
  1023,485,1023,1023,826,984,706,628,694,1023,1022,243,653,498,212,337,0,347,630,266,567,274,371,232,
  53,386,256,0,371,0,83,129,0,0,55,0,0,0,0,22,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0]);
const f32 = Math.fround;
const PITCH_DEG = [-100, -70, -130, -80, -120, -90, -100, -110, -80];      // [0x103918]
const SHAPES = ['kukka1', 'kukka1-2', 'kukka1-3', 'kukka1-4', 'kukka1-5', 'kukka1-6', 'kukka1-7', 'kukka1-8', 'kukka2', 'kukka2-2'];
const SPEED = f32(0.02);   // [0x1038f4..] float table
const FRAME_TICKS = 10;      // script events are polled by the main loop once per frame (10 ticks): an event takes effect at the next frame boundary
const LAG = 15;            // display latency in ticks: the golden capture shows the A state of 15 ticks earlier (exact minimum, +-1 tick doubles the error)

export default function make(dat) {
  const pal = dat.pal('flower/jeesus.pal');
  const texFlower = dat.get('flower/jeesus1.raw'), texTunnel = dat.get('flower/jeesus2.raw'), shd = dat.get('flower/jeesus.shd');
  const matT1 = new Material({ tex: texTunnel, shade: shd }), matT2 = new Material({ tex: texTunnel, shade: shd }), matF = new Material({ tex: texFlower, shade: identityShade() });
  const scene = new FlowerScene({ width: 320, height: 200, fov: 256, near: 0x2000 });      // 0x2c878 + [+0x3c]=0x100, [+0x44]=0x2000
  const cam = scene.camera = new Node(); scene.add(cam);
  const tunnel = new Mesh(parseSROAny(dat.get('flower/tunneli1.sro')), matT1, 1); tunnel.flags = 0;
  tunnel.vsh.set(TUNNEL_SHADE);
  for (let f = 1; f < tunnel.nf; f += 2) tunnel.fmat[f] = matT2;
  const quad = (sc, m, f, fb) => { const mt = m.fmat[f]; const c = mt.corner; m.vu[m.fa[f]] = c[0]; m.vv[m.fa[f]] = c[1]; m.vu[m.fb[f]] = c[2]; m.vv[m.fb[f]] = c[3]; m.vu[m.fc[f]] = c[4]; m.vv[m.fc[f]] = c[5]; sc.drawFace(fb, m, f); };
  tunnel.setMapper(quad);
  scene.add(tunnel);
  const flower = new Mesh(parseSROAny(dat.get('flower/kukka1.sro')), matF, 1); flower.flags = FLAG.ENV_UV_N2; flower.bias = 0x35200;
  flower.parent = cam; flower.setPos(0, 0, 1500);
  scene.add(flower);
  const targets = SHAPES.map(n => new Mesh(parseSROAny(dat.get('flower/' + n + '.sro')), matF, 1));
  const lws = loadLWS(new TextDecoder().decode(dat.get('flower/tunnel1.lws')), 3000);
  const NF = tunnel.nf, ff = tunnel.fflags;

  // ---- A (0x2540c) as a pure function of the tick: state after n ticks, replayed from checkpoints (ticks 1..n; script events applied before the tick that follows them)
  const fresh = () => ({ n: 0, ctr: 0, f: 0, phase: 0, spin: 0, idx: 0, open: 1, ev: 0 });
  let cps = [fresh()], evSig = '';
  const cur = fresh();
  function stepA(s, evs) {
    while (s.ev < evs.length && evs[s.ev].tick <= s.n) {
      const e = evs[s.ev++];
      if (e.fn === '0x25358') { s.phase = 0; s.open = 1; s.spin = 0; s.idx = (s.idx + 1) % 9; } else if (e.fn === '0x253f0') s.open = 0;
    }
    s.n++; s.ctr++;
    if (s.open === 1) s.phase = f32(s.phase + SPEED);
    s.f = f32(s.f + 0.15);
    if (s.f > 260) { s.ctr = 0; s.f = 0; }
    s.spin = f32(s.spin + 0.02);
  }
  function stateAt(n, evs) {
    const sig = evs.map(e => e.fn + e.tick).join();
    if (sig !== evSig) { evSig = sig; cps = [fresh()]; }
    let k = Math.min(Math.floor(n / 256), cps.length - 1); Object.assign(cur, cps[k]);
    if (cur.n > n) Object.assign(cur, fresh());
    while (cur.n < n) { stepA(cur, evs); if (cur.n % 256 === 0 && cps.length === cur.n / 256) cps.push({ ...cur }); }
    return cur;
  }
  const cv = new Float64Array(6);
  let evsRef = null, evs = [];
  return {
    id: 'flower', palette: pal, scene, tunnel, flower, stateAt,
    render(fb, tick, rt) {
      if (tick <= LAG) { fb.fill(0); return; }          // nothing has been drawn yet (the first frame appears LAG ticks after the start)
      const raw = rt && rt.events;
      if (raw !== evsRef) {                              // script events 0x25358 / 0x253f0, quantised to the 10 tick frame loop
        evsRef = raw;
        evs = (raw || []).filter(e => e.fn === '0x25358' || e.fn === '0x253f0').map(e => ({ fn: e.fn, tick: Math.ceil(e.tick / FRAME_TICKS) * FRAME_TICKS })).sort((a, b) => a.tick - b.tick);
      }
      const s = stateAt(tick - LAG, evs);
      // tunnel face window (A: faces idx+348 appear, face idx disappears, idx = trunc(ctr*0.75), frozen once idx+348 >= nf)
      const k = Math.min(Math.trunc(s.ctr * 0.75), NF - 349), lo = s.ctr === 0 ? -1 : k, hi = s.ctr === 0 ? 349 : Math.max(k + 348, 349);
      for (let i = 0; i < NF; i++) ff[i] = (i > lo && i <= hi) ? ff[i] & ~1 : ff[i] | 1;
      const X = (59 * (tick - LAG)) & 0xfff;           // texture scroll [0x10393c]: +0x3b per tick, & 0xfff
      matT1.corner = [X, X, X + 0x1000, X, X + 0x1000, X + 0x1000]; matT2.corner = [X, X, X + 0x1000, X + 0x1000, X, X + 0x1000];
      // flower: open/close, rotation (pitch from the shape table, spin), morph target0 -> target idx+1
      if (s.open) flower.flags &= ~FLAG.DISABLED; else flower.flags |= FLAG.DISABLED;
      mat3.euler(f32(PITCH_DEG[s.idx]) * 0.01745329252, s.spin, 0, flower.mat);
      morphMesh(flower, targets[0], targets[s.idx + 1], f32(Math.abs(Math.sin(s.phase))));
      // camera (0x240d8)
      sampleCamera(lws, s.f, cv);
      cam.setPos(Math.trunc(cv[0]), Math.trunc(cv[1]), Math.trunc(cv[2]));
      mat3.identity(cam.mat); mat3.rotY(cam.mat, cv[4]); mat3.rotX(cam.mat, -cv[3]); mat3.rotZ(cam.mat, -cv[5]);
      scene.clear(fb, 0); scene.render(fb);
    },
  };
}
