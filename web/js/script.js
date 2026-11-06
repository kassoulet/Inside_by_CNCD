// The demo script: a port of the table at 0x1032e4 (97 entries {order,row,handler}) executed by 0x1cb3c each frame.
// Position = AMF (order<<6)+row; entries fire in table order the first frame the music position reaches them.
// Everything is expressed in *ticks*: the original's own tick ISR (0x1c70c, PIT interrupt 0x27ecf, calibrated on the VGA retrace: 4 interrupts per frame
// = ~280 Hz) drives the palette fades and the per-scene clocks [0x1058c8].  DSMI is told 35 time units (1/10000 s) per ISR call (0x1d010: [0x199f00]*2500*3.48e-6 = 35),
// so the music clock advances 3.5 ms per tick: TICK_HZ = 10000/35 = 285.714 ticks per music second.  The timeline is a pure function of the tick count.
// The *frame* rate of the original was whatever the PC managed (the demo is not frame-locked); scenes that accumulate state per rendered frame use FRAME_TICKS ticks per frame
// (10 = 28.6 fps, the rate of the golden captures).
import { Fade } from './fade.js';
export const TICK_HZ = 10000 / 35;
export const FRAME_TICKS = 10;
// handler address -> meaning (see WRITEUP-effects.md for how each was identified)
export const OPS = { '0x1c498': 'white', '0x1c454': 'invert', '0x1c438': 'black', '0x1c228': 'nop' };
// scene start handlers (set the per-frame callbacks [0x1058b4]/[0x105888] via 0x1caf4/0x1cb04) -> scene id
export const STARTS = {
  '0x1f8c8': 'intro', '0x1f164': 'logo', '0x233c8': 'credits', '0x217bc': 'nigga', '0x258c4': 'flower', '0x1ec28': 'flight',
  '0x23f90': 'water', '0x2185c': 'nigga', '0x26678': 'twirl', '0x2061c': 'tunnel2',
};
// scene-local handlers that also fire the white flash (they end in 'call 0x1c498')
export const FLASHES = new Set(['0x21f1c', '0x25358', '0x253f0', '0x26098']);
export const END_FN = '0x1c228';
export class Timeline {
  /** times: music_times.json 'times' (order,row)->s; table: script_table.json; scenes: id -> scene object */
  constructor(times, table, scenes) {
    this.scenes = scenes;
    this.entries = table.filter(e => e.order < 1000 && times[e.order]).map((e, i) => ({
      i, order: e.order, row: e.row, fn: e.fn, t: times[e.order][e.row], tick: Math.ceil(times[e.order][e.row] * TICK_HZ - 1e-9),
    }));
    { let m = 0; for (const e of this.entries) { if (e.tick < m) e.tick = m; m = e.tick; } } // the script table is walked sequentially: an entry listed after a later one (twirl 30:12) fires only when its predecessor did
    this.entries.sort((a, b) => a.tick - b.tick || a.i - b.i);
    this.endTick = this.entries.find(e => e.fn === END_FN).tick;
    // scene segments: [startTick, endTick) + scene-local events (entries inside the segment that are not generic fade ops)
    this.segs = [];
    for (const e of this.entries) {
      if (STARTS[e.fn]) { if (this.segs.length) this.segs[this.segs.length - 1].end = e.tick; this.segs.push({ id: STARTS[e.fn], start: e.tick, end: this.endTick, fn: e.fn, events: [] }); }
      else if (!OPS[e.fn] && this.segs.length) {
        if (e.fn === '0x20728' || e.fn === '0x258c4') continue;
        this.segs[this.segs.length - 1].events.push({ tick: e.tick - this.segs[this.segs.length - 1].start, fn: e.fn, t: e.t });
      }
    }
    for (const s of this.segs) s.events = s.events.filter(ev => ev.tick >= 0);
    this.ckpt = [];
    this.reset();
  }
  /** in-scene animation speed factor (1 = the emulated original's 285.7 ticks per music second; scene changes, flashes and fades stay on the music rows) */
  /** speed of a scene: one value for all (a DOSBox-X run with cycles=fixed 90000 fits 0.25 in logo, credits, flower and water; water/tunnel2 were briefly doubled, the fit says no) */
  spd(sg) { return this.speed || 1; }
  setSpeed(v) { this.speed = v; this._sc = new Map(); this.reset(); }
  _scaled(sg) { const s = this.spd(sg); if (s === 1) return sg; let o = this._sc && this._sc.get(sg); if (!o) { o = Object.assign({}, sg, { events: sg.events.map(e => Object.assign({}, e, { tick: e.tick * s })) }); (this._sc = this._sc || new Map()).set(sg, o); } return o; }
  reset() { this.k = -1; this.ei = 0; this.seg = -1; this.lastBase = null; this.fade = new Fade(); this.ckpt = []; this._boot(); }
  _boot() { /* intro init (0x1f811 / 0x1f81f): base = intro palette, cur = black, fade up over 0x78 ticks */
    const s0 = this.scenes.intro; if (s0 && s0.palette) { this.fade.setBase(s0.palette); this.lastBase = s0.palette; this.fade.fadeTo(1, 0x78); } }
  _step() {
    const k = ++this.k, f = this.fade;
    // original loop order per iteration: [tick ISR: palette step + present] -> frame function -> script (fires entries due, effect seen from the next iteration)
    // so entries with tick < k have fired before this iteration's ISR
    while (this.ei < this.entries.length && this.entries[this.ei].tick < k) {
      const e = this.entries[this.ei++];
      const op = OPS[e.fn];
      if (op === 'white' || FLASHES.has(e.fn)) f.white(); else if (op === 'invert') f.invert(20); else if (op === 'black') f.black(40);
      else if (STARTS[e.fn]) {
        this.seg++; const sc = this.scenes[STARTS[e.fn]];
        if (sc && sc.startFlash) f.white();   // start handler 0x2061c (tunnel2) begins with 0x1c498 (white flash), then sets its palette
        if (sc && sc.palette) { f.setBase(sc.palette); this.lastBase = sc.palette; if (sc.startFade) f.fadeTo(1, sc.startFade); }   // scene.startFade = ticks of the 0x1c4ac(1.0,n) fade-up its start handler does (flight: 0x3c)
      }
    }
    f.tick();                                           // ISR: palette step
    const sg = this.segs[this.seg], sc = sg && this.scenes[sg.id];
    if (sc && sc.basePalette) { const p = sc.basePalette(Math.floor((k - sg.start) * this.spd(sg)), this._scaled(sg)); if (p && p !== this.lastBase) { f.setBase(p); this.lastBase = p; } }
  }
  /** state for display tick k: { seg (segment or null), sceneTick, pal (Uint8Array(768) 6-bit), ended } */
  at(k) {
    if (k < this.k) { // restore nearest checkpoint
      let c = null; for (const x of this.ckpt) if (x.k <= k) c = x;
      if (c) { this.k = c.k; this.ei = c.ei; this.seg = c.seg; this.lastBase = c.lastBase; this.fade = c.fade.clone(); } else this.reset();
    }
    while (this.k < k) { this._step(); if (this.k % 1024 === 0 && !this.ckpt.some(x => x.k === this.k)) this.ckpt.push({ k: this.k, ei: this.ei, seg: this.seg, lastBase: this.lastBase, fade: this.fade.clone() }); }
    const sg = this.segs[this.seg] || null;
    return { seg: sg ? this._scaled(sg) : null, sceneTick: sg ? Math.floor((k - sg.start) * this.spd(sg)) : 0, pal: this.fade.cur, ended: k >= this.endTick };
  }
}
