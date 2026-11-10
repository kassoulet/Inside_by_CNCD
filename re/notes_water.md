# Scene 'water' (118.07 .. 136.6 s) - reversed

Port: `web/js/scenes/water.js` (+ data `web/js/waterdata.js`). No `engine3d_water.js` was needed: the engine's `MODE.TEX` (0x2edb0), `MODE.BLEND` (0x3269c) and `FLAG.ENV_UV_N2` (0x36cc4) are exactly what this scene uses.
**Fidelity: bit-exact.** 0 differing palette indices and MAE 0.00 on all 528 water frames against the original (`golden.py 0 ...` full run, frames 3375..3902) through the real Timeline/fade
(`render_node`), and 0 differing indices on frames 2..499 against `golden.py 118.07` (see "Rand/tick phase" below for the constants that select which run is reproduced). Cost 0.8 ms/frame.

## Function map (linear addresses)
| addr | role |
|---|---|
| 0x23dec | init, called once at program start: heap mark [0x1075f0]; loads waterenv.raw -> [0x1075dc] (256x256 env texture), water.shd -> [0x10760c] (16 KB, **never read by the drawing code of this scene**), water.pal -> [0x107614], water.raw -> [0x107608] (320x200 background), fish.sro -> [0x1075f8], water.int -> [0x107610] (64 KB 256x256 blend table), obuke.sro -> [0x1074b8]; 2 materials 0x44 bytes ('water material' [0x107568], 'fish material' [0x10756c]; both texture = waterenv.raw, 8+8 bits; shade/`mat+8` = water.shd resp. water.int), engine scene [0x1075ec] (320x200, fov [+0x3c]=0x100, near [+0x44]=0x1c00, ambient [+0x40]=0); then 0x239f4 builds the objects |
| 0x239f4 | scene graph: node 'camera' [0x1075e8] (vector (0,0,-1600), identity matrix), 'water object' [0x1075fc] = obuke.sro, scale 0x9999/65536 = 0.6, face function 0x2edb0, node flags [+0xc4]=0x1000 (ENV_UV_N2), position vector (-600,0,0) in [0x107488], matrix [0x1074d8] = Euler(0, 0x3fc65718_4ae79455 = 0.1745 (10 deg), 0); 8x 'waterfish' [0x107570+4i] = fish.sro, scale 0x2666/65536 = 0.15, face function 0x3269c, flags 0x1000, sort bias [+0xcc] = 0xfffc1800 (-0x3e800); random start: pos = (rand()%3000-1500, 0, rand()%1000), matrix = Euler(0,pi/2-ish..) then rotY(rand()%300 deg) (0x23b8b..0x23c29). Added to the scene in the order camera, spiral, fish0..7 (this is the draw order for equal depth keys) |
| 0x23f90 | start handler: clear both screens, set base palette (0x1c364 water.pal), allocs two `w*h*2` byte 16 bit buffers 'water frame 1' -> [0x1075e4] and 'water frame 2' -> [0x1075d8] (**zero initialised**), A=0x23c78, B=0x23d78 |
| 0x24014 | stop handler: A=B=0, free the heap back to the mark |
| 0x23c78 | **A**, once per 285.7 Hz tick: `matrix[0x1074d8] *= Euler(0, 0x3f92f1a9_fbe76c8b = 0.0185 rad, 0)` (0x305f4 + 0x30070). 5.29 rad/s, 0.84 turns/s about the object's own Y axis. (0x23c44 is an unused identical copy) |
| 0x23d78 | **B**, once per rendered frame: scene[+8] = draw buffer; 0x23cac (copy the double vectors to the camera / spiral node ints [+0x10..+0x18] and the matrices [0x107590], [0x1074d8] into node+0x28 via 0x2fe68); clear row 0,1 and 198,199 (memset 0x280 bytes at fb and fb+0xf780); 0x238d4(fb) = fish step + drops + wave step + refraction draw; 0x286ac render the 3D scene on top (no clear!); 0x1cbec present |
| 0x238d4 | water frame: 8x 0x23400(i); 3 drop attempts; 0x1d234 (wave + draw); swap [0x1075e4] <-> [0x1075d8] |
| 0x23400 | per fish i (see below) |
| 0x1d234 | the ripple step + refraction draw (self modifying, see snippet 1) |
| 0x2de80 | world point -> screen (doubles): camera-space = Mcam^T (P - campos), x128 = c.x*128, `sx = cx + (fx*2^-14)*(128 c.x)/c.z`, same for y with fy; fails (-1, output untouched) when c.z < near/256 = 28 |
| 0x2edb0 / 0x3269c | face functions: affine texture copy `fb = tex[uv]` (spiral) / `fb = water.int[(tex[uv]<<8) | fb]` (fish, translucent blend through a 64 KB LUT) |

## Algorithm
**Frame function B (n = 0, 1, 2 ... one per 10 ticks in the golden run).** Time `t` = global tick counter [0x1058c4] at the call (T0 + 10 n).
1. *Fish update* `0x23400(i)`, i = 0..7, in order (all of them use the same rand() stream, see order below):
   * `S = sin((t+171i)*0.0015848) + cos((t-57i)*0.0027020) + 0.1*cos(t*0.0081301)` (doubles at 0x1022e4..0x1022fc);
   * heading: `rotY(M_i, S*0.01745329252)` (0x305ac -> 0x30344, post-multiplication), speed `= max(30 S + 10, 15)`;
   * `pos = trunc(pos + M * (0,0,speed))` (0x2fd58 = 'move along the fish's local Z'); the *un-truncated* double position is what gets projected;
   * `0x2de80(scene, pos) -> (sx, sy)`; the fish turns around (`rotY(M, pi)`; four independent tests, they can cancel) when `sx < -70`, `sx > 390`, `sy < -70` or `sy > 270`;
   * splash value = 600, but `if rand()%300 == 0: value = rand()%40000` (stored as int16, so values > 32767 become negative = a hole);
   * if `3 < sx < 317 and 3 < sy < 197` the value is stored in the *write buffer* [0x1075e4] as a **triangle** of 15 cells: for bx = -2..2, dy = -3 .. bx-1: `buf[(trunc(sy)+dy)*320 + trunc(sx)+bx] = value` (the inner loop restarts at the constant -3 and stops below the outer index);
   * stateless part, done in the same call but only dependent on t: vertices 4,5,6 of the 8-vertex fish are wiggled: `x4 = trunc(-15 sin(.0222 t))`, `x5 = trunc(-20 sin(.02703 t))`, `x6 = trunc(25 sin(.01639 t))` and the *normals* get `nx4 = trunc(800 sin(.0222 t))`, `ny5 = trunc(800 sin(.02703 t))`, `nz6 = trunc(800 sin(.01639 t))` (the normals are what the env mapping reads, so the texture swims over the fins; the face normals (back-face test) are never recomputed).
2. *Drops*: [0x103854]=3 attempts per frame; each: `if rand() % [0x103858](=200) == 0`: `x = rand()%300 + 10`, `y = rand()%180`, `v = rand()%20000`, then 7 columns (x-3..x+3) x 7 rows (y+7 .. y+13) of `v` into the write buffer.
3. *Wave + refraction* 0x1d234: for i = 0 .. (H-4)*W-1 (cell `c = i + 320`, pixel `p = i + 640`): `v = ((D[c-1]+D[c+1]+D[c-320]+D[c+320]) >> 1) - E[c]; v -= v >> 4; v = clamp(v, -0x3fff, 0x3fff); E[c] = v; fb[p] = bg[p - (v >> 5)]`
   where D = [0x1075d8] (current), E = [0x1075e4] (old, also the buffer the splashes were just written into, so a splash of value s enters as `-s`). Afterwards the two pointers are swapped. The wave is a 4-neighbour wave equation with damping 1/16; the picture is the 320x200 `water.raw` looked up at a **linear** offset of -(v>>5) bytes (not a 2D displacement), cells 0..319 and the last rows are never updated; screen rows 0,1,198,199 stay black. The height cell row is one above the pixel row.
4. *3D*: camera at (0,0,-1600), identity, fov = 0x100 (fx = 32768, fy = 27306, centre 160,100), near 0x1c00; spiral at (-600,0,0) with the accumulating matrix; 8 fish; all with env-map uv from the normals (`u = -((trunc(2 n . M row0 + 2048)) & 0xfff) - cx/64`, v similar, engine `FLAG.ENV_UV_N2`) on waterenv.raw. The spiral is opaque (0x2edb0); fish are blended through `water.int` over whatever is on the screen (picture, ripples, spiral).
Note the scene has **no lights** and does not use water.shd at all.

**rand() order per frame** (exactness requires it): for i in 0..7: `rand()` (+1 more if `%300==0`); then for each of the 3 drop attempts: `rand()` (the 1/200 test), and only if it fired 3 more (x, y, value).

## Rand/tick phase (the only free constants)
The scene is a pure function of (rand state at the first B call, global tick at the first B call, frame index). The tick phase T0 is a run constant (`waterdata.js`). The rand state and the fish start are now DERIVED (same method as the flight start, `notes_flight.md` "start state"):
* the program init calls `srand(0x45eafc)` (the only srand); a run started mid-demo (`golden.py 118.07`) fires every earlier script entry once at one tick (catch-up), so the draws up to the first B call are deterministic. Hooking rand (0x2f4cd, caller/tick/state) in `golden.py 118.07 4`: 1055 draws between srand and the first B call (callers: flight init 9, other init handlers/catch-up of the intro 0x1f1b7/0x1f1d7 130x2 + flower 0x1fdad/0x1fdd7/0x1fdfe 10x3 + credits..., then **the 8 fish of 0x23b8b: draws 40..63** (z = r%1000, x = r%3000-1500, heading r%300 degrees; matrix = Euler(pi/2,0,0) then rotY(h*0.01745329252)), then the per-frame caller 0x25a30 x732 etc.). LCG replay from 0x45eafc: after 39 draws the 8 fish positions and matrices are bit-identical to the captured ones, after 1055 draws the state is 845024719 = the captured seed. `waterdata.js` now computes `SEED` and `FISH` this way (no captured rand constants left; `T0` and `OBMAT_AT_B0` remain captured values/phases).
* the same 1055 count gives the flight start state (`flightlib.js` INIT): flight and water see the same count because both runs fire the same catch-up.
* **Timing caveat**: the count is NOT fixed in general. In a run from t=0 the per-frame / per-tick callers (intro 0x1f3c0, ISR 0x1f2c9/0x1f2f6, water 0x25a30 once per main-loop frame) draw once per main-loop iteration, so the number of draws before the water scene depends on how many iterations fit in a tick, i.e. on the machine speed. The full-run golden (K=10) has seed 1366540578 (T0 28954); that is not derivable, it stays reachable as `make(dat, {seed: 1366540578, t0: 28954})`. The fish start (draws 40..63, program init) does NOT depend on timing: same in every run.
Verification after the change: `golden.py 118.07 500` vs `render_node.mjs` (Timeline speed 1, i.e. `tl.speed = 0.25` because water has the x4 factor of `spd()`, so sceneTick = k and one B call per 10 ticks as in the golden run; the player default 0.25 therefore plays water at the golden's 28.6 fps, it was 14.3 fps with the old x2), compared frame by frame (JS frame i = golden frame i; `ix.py`'s tick matching is off by one frame here because of the golden meta label): frames 2..499 498/498 exact, 0 differing indices (same as before the change).
Runs reproduced:
* `golden.py 118.07` run: seed 845024719 ([0x104818]), [0x1058c4] = 20 -> **default** in the port; the port reproduces that run bit-exactly. (cmp.py shows MAE ~8 for it only because the golden meta label of frame 0 is `tick_total=10` while the scene tick is 0: shift the comparison by one frame and it is 0.)
* full run `golden.py 0`: seed 1366540578, [0x1058c4] = 28954 -> `make(dat, {seed:1366540578, t0:28954})`, also bit exact.
The fish initial state (position, matrix) is the same in both runs (init at program start; `FISH` in waterdata.js is derived from srand(0x45eafc), it equals the values read from memory at the first B call).
**Quirk reproduced**: the very first B call (n = 0) runs *before the first render*, i.e. before 0x284e4 has filled the scene's centre/focal fields, so `0x2de80` returns (0,0) for every fish and no splash/turn happens; from the second call on the projection is real (the port calls `scene._setup()` and special-cases n = 0).
**Timing**: display lag = 2 frames (a B call n is on screen when the golden capture index = trigger frame + n + 2, i.e. `LAG = 2`); the spiral matrix at call n is `Ry(0.1745) * Ry(0.0185)^(10(n+1))` (10 A ticks happen before the first B). The scene is frame-rate dependent in the original (fish step and wave step per *frame*; spiral spin per tick); the port steps once per FRAME_TICKS = 10 ticks (Stepper with a checkpoint every 32 frames, state = 2x128 KB buffers + rand + 8 fish).

## Data
* `water.raw` 64000 bytes indexed with `water.pal` (256 x RGB 6 bit); `waterenv.raw` 256x256 env texture (reused as the 'metal' look of the spiral); `water.int` 256x256: `out = int[src<<8 | dst]` (not a simple add; the palette is not ordered); `water.shd` 16 KB (64x256), unused.
* `water/obuke.sro`: **not** the logo one (that is `logo/obuke.sro`): 8024 bytes, header `{0x1f58, 0x14, 287 verts, 0xd88, 570 faces}` - the loader 0x2cbb0 ignores the first dword (engine `parseSRO` rejects it: the port patches a copy to 0x1df020). A tight corkscrew of 287 vertices and 570 faces.
* `fish.sro`: 208 bytes, 8 vertices, 10 faces, standard header.

## Asm snippets (verified with ds.py)
**1. Ripple + refraction, self-modifying (0x1d234)**: the prologue patches three immediates of the inner loop (`mov [0x1d2bf],edx` = the source picture base inside the `mov al,[ecx+ebx+imm32]` at 0x1d2bc, `mov [0x1d2c5],ebx` = the destination inside `mov [ecx+imm32],al`, `mov [0x1d2d2],eax` = the loop count) so that the loop needs only one running index `ecx`:
```
1d26e: movsx ebx, word [edi-2]        ; left   (edi = current height buffer, shorts)
1d272: movsx eax, word [edi+2]        ; right
1d276: movsx edx, word [edi-0x280]    ; up     (one row = 320 shorts = 0x280 bytes)
1d27d: movsx ebp, word [edi+0x280]    ; down
1d284: add eax,edx / add ebx,ebp / add ebx,eax ; sar ebx,1       ; (l+r+u+d)/2
1d28c: movsx eax, word [esi]  ; sub ebx,eax                      ; - old height (esi = the *other* buffer)
1d291: mov eax,ebx ; sar eax,4 ; sub ebx,eax                     ; damping: v -= v/16
1d298..1d2af: clamp to +-0x3fff
1d2b4: mov [esi],bx                    ; in place: the old buffer becomes the new one
1d2b7: sar ebx,5 ; neg ebx
1d2bc: mov al,[ecx+ebx+0x123456]       ; picture pixel at a *linear* offset -(h>>5)
1d2c3: mov [ecx+0x12345678],al         ; screen
```
It is the classic two-buffer water (`new = neighbours/2 - old`, damped): the buffer that received the splashes is the one that is overwritten, so a splash enters as a negative impulse.
**2. Translucent fish through a 64 KB LUT (0x3269c inner loop)**: `dh`/`dl` build the 16 bit table index without any shift or or:
```
32b83: mov dh, [eax-0x21524542]   ; texel (self-modified base = env texture) -> high byte
32b89: mov dl, [edi]              ; screen pixel -> low byte
32b8b: mov al, [edx-0x21524542]   ; water.int[texel<<8 | pixel]  (base patched at 0x32b8d from mat+8)
32b91: mov [edi], al
```
The u/v accumulators use `and edx,mask / sar eax,imm` with the shift counts and masks patched at the triangle setup (0x32a63..0x32aaf) from the material's bit counts [mat+0x40/0x41], so one routine serves any texture size.
**3. The splash triangle (0x23850..0x238c9)**: the inner counter is initialised from a register that is *never updated* (`mov esi,ebx` at 0x2384f executes once, the outer loop re-enters at 0x23851 `mov edx,esi`), so the inner loop runs from -3 up to the outer index: a 15 cell wedge instead of a square, written as `mov word [ecx], ax` with `ax = (int16)trunc(splash)`; values above 32767 become negative (a hole instead of a bump).
**4. First-frame quirk (0x23d98 .. 0x2de80)**: B calls the fish step (which projects with 0x2de80 using scene+0x10..0x1c) before the first `call 0x286ac` has run the setup stage 0x284e4 that fills those fields; at the first B call all of them are 0 so every fish projects to (0,0).

## Approximations
None known in the picture: 528/528 frames are index-exact. Remaining risks: (1) x87 80-bit intermediates vs JS doubles (never mattered: matrices of the 8 fish were bit-identical over the checked frames); (2) the rand state / tick phase are run dependent constants (see above); (3) the stale-output case of 0x2de80 (fish nearer than 28 world units) never occurs.
For the engine owner: `parseSRO` should not insist on the magic (water/obuke.sro has 0x1f58); `Scene._setup()` is called once at construction by water.js.
