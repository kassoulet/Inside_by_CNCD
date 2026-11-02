// Shared helpers for the scene ports.
export const W = 320, H = 200;
/** Watcom C rand() (0x2f4cd): seed = seed*0x41c64e6d + 0x3039; return (seed>>16)&0x7fff.  Deterministic, so the demo's 'random' parts are reproducible. */
export class Rand {
  constructor(seed = 1) { this.s = seed >>> 0; }
  next() { this.s = (Math.imul(this.s, 0x41c64e6d) + 0x3039) >>> 0; return (this.s >>> 16) & 0x7fff; }
}
/** Replayable simulation helper: state after n steps with checkpoints, so scenes whose state is accumulated per tick can still seek anywhere.
 *  init() -> state; step(state, n) mutates state to step n+1; clone(state) -> deep copy */
export class Stepper {
  constructor(init, step, clone, every = 64) { this.init = init; this.step = step; this.clone = clone; this.every = every; this.cp = []; this.n = -1; this.s = null; }
  at(n) {
    if (this.s === null || n < this.n) {
      let c = null; for (const x of this.cp) if (x.n <= n) c = x;
      if (c) { this.s = this.clone(c.s); this.n = c.n; } else { this.s = this.init(); this.n = 0; this.cp = [{ n: 0, s: this.clone(this.s) }]; }
    }
    while (this.n < n) { this.step(this.s, this.n); this.n++; if (this.n % this.every === 0 && !this.cp.some(x => x.n === this.n)) this.cp.push({ n: this.n, s: this.clone(this.s) }); }
    return this.s;
  }
}
