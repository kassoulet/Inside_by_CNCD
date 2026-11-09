// Palette fade engine = exact port of the demo's palette code (all float32 like the original).
//   base  [0x105890]  : target palette (768 bytes, 6-bit)
//   cur   [0x1058a4]  : palette currently on the DAC (bytes)
//   fcur  [0x1058b8]  : float copy;  add [0x105884]: per-tick adders;  steps [0x1058ac], target factor [0x103790]
const f32 = Math.fround;
export class Fade {
  constructor() {
    this.base = new Uint8Array(768); this.cur = new Uint8Array(768);
    this.fcur = new Float32Array(768); this.add = new Float32Array(768); this.steps = 0; this.f = 0; this.fl = null;
  }
  clone() { const c = new Fade(); c.base.set(this.base); c.cur.set(this.cur); c.fcur.set(this.fcur); c.add.set(this.add); c.steps = this.steps; c.f = this.f; c.fl = this.fl && Object.assign({}, this.fl); return c; }
  // 0x1c4ac(f, n): fade current -> base*f in n ticks
  fadeTo(f, n) {
    if (n <= 0) n = 1; const inv = 1 / n;
    for (let i = 0; i < 768; i++) { this.fcur[i] = this.cur[i]; this.add[i] = f32((this.base[i] * f - this.cur[i]) * inv); }
    this.f = f; this.steps = n;
  }
  // 0x1c364(pal): new base palette (clamped to 63), re-aim the running fade at it
  // Scene-local palette changes (twirl 0x26098) are called by script.js one ISR tick after the flash they belong to (the script entry fires, tick(), then basePalette -> here),
  // whereas the original does flash(old) ... 0x1c364(new) back to back and the invert/flash acts on the NEW base.  So a flash/invert that is exactly one tick old is redone
  // on the new base (fresh start, from this tick on = what the golden run shows).  A re-aim from the already-ticked int palette would lose the float fraction (steady +-1 DAC error).
  setBase(pal) {
    for (let i = 0; i < 768; i++) this.base[i] = Math.min(pal[i], 63);
    const l = this.fl;
    if (l && l.age === 1) { if (l.inv) this.invert(l.steps); else this.flash(l.add, l.steps); } else this.fadeTo(this.f, this.steps);
  }
  // 0x1c3ec(add, steps): cur = clamp(base+add) at once, fade back to base
  flash(add, steps) { this.fl = { add, steps, age: 2 }; for (let i = 0; i < 768; i++) { const v = this.base[i] + add; this.cur[i] = v < 0 ? 0 : v > 63 ? 63 : v; } this.fadeTo(1, steps); }
  white() { this.flash(63, 15); }                                   // 0x1c498
  invert(steps = 20) { this.fl = { inv: true, steps, age: 2 }; for (let i = 0; i < 768; i++) this.cur[i] = (63 - this.base[i]) & 63; this.fadeTo(1, steps); }   // 0x1c454
  black(steps = 40) { this.fadeTo(0, steps); }                      // 0x1c438
  // 0x1c540: one ISR tick
  tick() {
    if (this.fl && --this.fl.age <= 0) this.fl = null;
    if (this.steps <= 0) return; this.steps--;
    for (let i = 0; i < 768; i++) {
      let v = f32(this.fcur[i] + this.add[i]); if (v < 0) v = 0; if (v > 63) v = 63; this.fcur[i] = v; this.cur[i] = v | 0;
    }
  }
}
