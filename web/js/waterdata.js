import { mat3 } from './engine3d.js';
const PI_2 = new Float64Array(new BigUint64Array([0x3ff921fb544486e0n]).buffer)[0];   // the original's pi/2 constant (slightly below Math.PI/2)
// Data for scene water (SEED and FISH derived, checked against the emulator at the first call of the frame function 0x23d78):
//  - SEED: Watcom rand() state [0x104818] at that moment (derived below from srand(0x45eafc) + 1055 draws)
//  - FISH: the 8 fish nodes ([0x107570+4i]): integer position (+0x10..0x18) and 3x3 double matrix (+0x28) as left by the init 0x23dec (rand() based: x=rand()%3000-1500, z=rand()%1000, heading rand()%300 degrees)
//  - T0: value of the global tick counter [0x1058c4] at the first B call (phase of the fish sin/cos motion only; it is 20 when the run starts at 118.07 s, 28954 in the full run)
// DERIVED (re/notes_water.md "Rand/tick phase"): the program init calls srand(0x45eafc); the rand() draws that follow are, in order, 9 flight init draws, 30 more from the other init handlers,
// then the 8 fish (0x23b8b: z = r%1000, x = r%3000-1500, heading r%300 degrees: draws 40..63), then 992 more (intro drops, flower, credits, water 0x25a30...) up to the first B call = 1055 draws in all.
// The count is fixed only for a run started mid-demo (golden.py 118.07 / 98.38): the catch-up fires every earlier script entry once at one tick. From t=0 it depends on the frame rate (per-frame callers).
const SEED0 = 0x45eafc, CALLS = 1055, FISH_AT = 39;
const lcg = (s) => (Math.imul(s, 0x41c64e6d) + 0x3039) | 0;
export const SEED = (() => { let s = SEED0; for (let i = 0; i < CALLS; i++) s = lcg(s); return s >>> 0; })();   // 845024719
export const FISH = (() => {
  let s = SEED0; const r = () => { s = lcg(s); return (s >>> 16) & 0x7fff; };
  for (let i = 0; i < FISH_AT; i++) r();
  return Array.from({ length: 8 }, () => {
    const z = r() % 1000, x = r() % 3000 - 1500, h = r() % 300;
    const mat = mat3.euler(PI_2, 0, 0); mat3.rotY(mat, h * 0.01745329252);      // 0x2c8dc(pi/2,0,0), then 0x305ac(h * 0.01745329252)
    return { pos: [x, 0, z], mat };
  });
})();
export const T0 = 20;
export const OBMAT_AT_B0 = [0.9360612600019099, 0.0, 0.3518370610433706, 0.0, 1.0, 0.0, -0.3518370610433706, 0.0, 0.9360612600019099];   // obuke matrix 0x1074d8 at the first B call (= Ry(0.1745329)*Ry(0.0185)^10), used as a check
