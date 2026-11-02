# Scene 'credits' (29.46 s .. 59 s) - reversed

Port: `web/js/scenes/credits.js` (+ `web/js/creditsdata.js` = the flight-path table, `web/js/engine3d_credits.js` = extensions of the engine, see "To merge").
Fidelity (golden.py 29.459 900 frames, `--k=10`, compared with the real code in the emulator): **839 of 841 frames have 0 differing palette indices** up to 58.9 s (the 2 others are the first two
start-up frames, where the original shows half drawn page buffers).  cmp.py RGB MAE over the whole scene = 3.5 (median 0.000): the only non-zero frames are the white flashes / fades, which are
script.js business and come ~2 frames (20 ticks) late in the golden run (see "Timing").  ~1 ms/frame in node.

## What is on screen
A flight through a procedural tube.  The tube is NOT a static object: `tuubi.sro` (11 rings x 12 vertices = 132 vertices, 240 faces, scale 7.0) is re-skinned every frame from the 'credits flight path' table
(1024 rings), so the same 11 vertex rings always sit in front of the camera and the texture `tunnel.raw` (256 x 1024 texels, shade table `tunnel.shd`) scrolls.  12 additive "smoke/flare" billboards
(`sauhu.raw` 64x64 + `smoke.shd`) sit along the path (the bright orbs), `wtrmask.raw/.int` darkens the screen borders until 9:48, the credit names (`kredu*.raw`) are blended on top with `tunnel.int`, and from 9:48
a spike ball (`piikkis.sro`, 260 vertices / 252 faces, env-mapped with `piikkis.raw`, face function 0x2edb0) flies towards the camera and passes it.

## Function map (linear addresses)
| addr | role |
|---|---|
| 0x233c8 | start handler: A = 0x21f30 (`0x1caf4`), B = 0x22794 (`0x1cb04`), base palette `credits/tunnel.pal` ([0x107448], `0x1c364`).  No flash of its own |
| 0x233e8 | stop handler (A = B = 0) |
| 0x22d10 | init (called once at program start): loads all 17 files (names at 0x1020e8..), scene 0x50 [0x107460], camera 'it camera' [0x10745c], tube node [0x10747c], tube copy [0x107468] (untouched vertices), ball [0x107464], materials [0x107474] (tunnel) / [0x107450] (ball), sprites, calls 0x2284c and 0x22c70 |
| 0x2284c | **flight path generator** (1024 rows x 0x6c bytes at [0x107424], alloc 0x1b000): row = 3 x i32 ring centre, 12 x i32 ring vertex brightness (0..1008), 12 x f32 vertex radius factor (0.67 .. 1.6). Position = running sum of a vector built from ~20 sines of the ring index (`fild/fsin/fcos` chain 0x228bd..0x22a1c, lengths via 0x2f510/0x2f750 normalise), brightness/radius from `rand()` (0x2f4cd) + sines (0x22a1c..0x22bb9).  rand() makes it deterministic only for a given boot, so the 110 KB table is **embedded** (`creditsdata.js`, dumped from the emulator) |
| 0x22c70 | 12 smoke billboard nodes (class 0x10481c, 0x104 bytes) [0x1072a8+4i]: [0xd8]=sauhu.raw, [0xdc]=smoke.shd, stride/w/h = 0x40, [0xec] scale 1.0, [0xf0] size factor 0.35 (0x3eb33333), draw fn 0x31dc8 |
| 0x21f30 | **A**, per tick (see below) |
| 0x221fc | per frame: camera position + look-at + the logo-like roll of 0x22470 |
| 0x22470 | per frame: the 11 x 12 tube vertices (position, u, v, shade), 12 smoke positions, 0x223fc seam vertices, camera roll |
| 0x223fc | copies vertex 0 of every ring to the 'seam' vertices 0x106fe8+0x40k (u = 0x1005): the faces 22 and 23 of ring gaps 0..8 point at them (patched at 0x232f6..0x2335d) so the texture wraps at u = 4096 |
| 0x22794 | **B**, per frame: scene fb = draw buffer, 0x221fc, 0x22470, `ball.flags` bit0 = (flag [0x107430] == 0), 0x2d27c clear, 0x286ac render, `wtrmask` sprite (type 2, only while [0x107430] == 0), credit sprite `[0x1073c0 + 4*[0x107438]]` at (0, 117) if 0 <= index < 5, 0x1cbec/0x1cb14 flip |
| 0x21f1c | script event (7:00, 7:32, 8:00, 8:32, 9:00, 9:32): white flash (0x1c498) + `[0x107438]++` (starts at -1) |
| 0x21f10 | script event 9:48: `[0x107430] = 1` (ball on, wtrmask off, ball approach starts) |
| 0x31878 / 0x317d4 / 0x31dc8 | billboard draw / per-frame projection / mode-1 wrapper (engine, now ported in `engine3d_credits.js`) |
| 0x2c77c + 0x30cec | look-at (target - position -> rows right, up, forward) |

## Callback A (0x21f30), once per tick (state = f(tick), replayed with `Stepper`)
```
t   [0x107434] f32  += 47.0                      (path position; one ring = L = 686 units -> 0.0685 ring/tick, 8400 ticks = 575 rings)
roll[0x10384c] f32  += 0.01745329252             (1 degree/tick)
ti = trunc(t/L), j = ti mod 1024, r = trunc(t) mod L, fs = f32(r/L)
P(j)  = x_j*(1-fs) + x_{j+1}*fs                  (lerp of path rows)
S1 (doubles 0x107390..a0) = 0.8*S1 + 0.2*P(j)     (camera follower, exponential smoothing)
M_ball [0x1072d8] *= Euler(0.01, d1, d2)         (ball spin, 3 constant doubles at the pushes 0x2204f..0x220a0)
if [0x107430]: c850 [0x103850] f32 += -0.015     (starts at 9.0 = ring lead of the ball, decreases ~4.3 rings/s after 9:48: the ball catches up with the camera)
j2 = (j + trunc(c850) + 3) mod 1024
S2 (doubles 0x107320..30) = 0.96*S2 + 0.04*P(j2)  (ball follower, same lerp)
```
The effect of the script flag is seen from the *next main-loop iteration* (script runs after the frame function): in the 10-tick golden loop the flag handler time is quantised to a multiple of 10 ticks
(`q(t)` in credits.js; 5297 -> 5290).

## Frame function details (B at scene tick T uses A-state(T))
* camera node = trunc(S1).  Look-at target = (0.8*cam.x + 0.2*L.x, L.y, L.z) with L = lerp(P(j+3), P(j+4), fs): **only x is blended with the camera position** (a quirk of the original: 0x22329..0x22356 uses the 0.8 constant for the camera x only). Look-at basis (0x30cec): f = norm(target - pos), r = norm(-f.z, 0, f.x), u = norm(f x r), matrix rows r, u, f. Then `cam.mat = lookAt * Rz(roll)` (0x305f4 + 0x30070), the roll is *not* accumulated (the look-at rewrites the matrix each frame).
* tube node at the camera position, identity matrix.  For ring m = 0..10 (path row (s+m) mod 1024, s = trunc(t) / L) and vertex j = 0..11: `p = M_look * (x0*k, y0*k, 0)` with (x0, y0) = original tube vertex j of ring m (copy [0x107468]) and k = the row's radius factor f32[j]; vertex = trunc(row.xyz + p - cam); u = trunc(j*256*16/12) (0..3754), v = trunc(4096*((s mod 10)+m)/10) (table at 0x107338: the texture scrolls one ring per 10 path rings), shade = max(0x70, brightness_j - max(0, trunc(|v| - 7L))) (distance fog, see snippet 1).
* smoke k = 0..11: position = row (s+k) + (180, 180, 0).
* engine settings: scene fov param 0x100 (`[+0x3c]`, focal 32768 x 27306), near 0x4000, ambient 0; tube flags = no back-face culling (`[+0xc5]` bit0), no lighting (flags 0); ball flags 0x1000 (env-map, ENV_UV_N2), toggled disabled by bit0.
* materials: tube = tunnel.raw as 256 x 1024 (ubits 8, vbits 10, masks 0xff/0x3ff) + tunnel.shd; ball = piikkis.raw 256x256 with no shade table (TEX face function).
* credit names: kredu1 173x75 (DESTOP), kredu7 129x75 (WILI), kredu2 146x75 (JOUNI), kredu8 154x70 (JULIET), kredu3 318x82 (YOLK & LEGEND); kredu6 (294x75) is never shown (index 5 is skipped by `cmp [0x107438],5 / jge`). Type 4 sprites (`dst = tunnel.int[(src<<8)|dst]`, key 0) at x = 0, y = 117.0 (0x42ea0000).  wtrmask = type 2 sprite: `dst = wtrmask.int[(mask<<8)|dst]`.

## Timing (important for anybody comparing with golden.py)
Frame function B at scene tick T (T = 10, 20, ...; [0x1058c8]) renders what the screen shows one frame later, and the golden run's scene counters ([0x1058c8]) start 20 ticks after the music clock
that drives the script for this scene (`golden.py 29.459`; with 29.5 the offset is 12 ticks more because JS ticks are counted from the exact trigger tick 8417 = 29.4585 s).  The port uses
`LAG = 30` = 10 (flip) + 20 (golden catch-up phase) and `state(T) with T = tick - 30`; the credit sprite / ball flag use the quantised event ticks.  Flash/fade frames (script.js) therefore differ by ~2 frames from the golden.

## Approximations / gaps
* the flight path table (rand() based) is embedded as data (path generator documented, not re-implemented); everything else is computed.
* x87 80-bit intermediates are computed in doubles; 839/841 frames are still bit exact.
* first two frames of the scene (half drawn buffers in the golden run).

## To merge into engine3d.js (everything is in `engine3d_credits.js`, engine3d.js untouched)
* `Billboard` node + `CScene._object/drawBillboard` = node class 0x10481c (flights' sun/flares and tunnel2 use it too): projection (0x317d4: key = trunc(z)/16, z = float32 of camera z*128), draw 0x31878 in 1/16 pixel units, mode 1 (0x31dc8): `fb = shade[(texel<<8)|fb]`, mode 0 (0x31dbc): copy; no colour key.
* `lookAt(node, x, y, z)` = 0x2c77c.
* the ENV_UV_N2 generator I wrote is identical to the one now in engine3d.js (removed from my module).

## Interesting asm
1. **Distance fog written into the vertex shade** (0x22622..0x226ab): integer sum of squares of the freshly computed vertex, `fsqrt`, minus 7 ring lengths, truncated; the excess darkens the ring brightness, floor 0x70 - one `fild/fsqrt/fsubp` pair replaces any lighting code:
```
22675 fsqrt
22677 imul eax, dword ptr [0x107470], 7     ; 7*L
22685 fild dword ptr [esp + 0x80]
2268c fsubp st(1)                           ; |v| - 7L
2268e call 0x27a78                          ; trunc (round-to-zero control word trick)
22693 fistp dword ptr [esp + 0x7c]
2269d jle 0x226a1 ; 2269f sub edx, eax      ; shade = brightness - excess (only if > 0)
226a1 cmp edx, 0x70 ... mov edx, 0x70       ; clamp
```
2. **Seam vertices instead of duplicated geometry** (0x232f6..0x2335d): the 'wrap-around' texture seam of every ring is solved by patching the *vertex pointers inside the faces* (faces store pointers, +0x14/+0x18/+0x1c) of faces 22 and 23 of each ring gap so they point at the 11 extra vertices 0x106fe8 (u = 4096+5, copies of ring vertex 0, refreshed by 0x223fc and chained through their `next` field). Port: 11 extra vertices appended to the mesh.
3. **Scaled billboard blitter with 16.16 texel steps** (0x31d6a, mode 1): the inner loop is 6 instructions, `ah` = texel, `al` = destination pixel, and the 256x256 table `smoke.shd` does the additive blend:
```
31d6a mov eax, ebx ; 31d6c sar eax, 0x10 ; 31d6f add ebx, edx   ; u in 16.16, step in edx
31d71 mov ah, byte ptr [esi + eax]          ; texel (row base in esi)
31d74 mov al, byte ptr [edi]                ; destination
31d76 mov al, byte ptr [ebp + eax]          ; table[(texel<<8)|dst]
```
(the sprite geometry is computed in 1/16 pixel with `fistp` after 0x27a78 truncations; clipping to top/left adds `-(clip*step)/16` start offsets in doubles).
4. **Look-at right vector with `fchs`** (0x30d59..0x30d71): the right axis is (-f.z, 0, f.x) normalised - horizon-locked camera - built by storing the double halves of f.x and -f.z straight into the stack frame:
```
30d59 mov eax, dword ptr [esp + 0x18]      ; f.x low dword
30d5d fld qword ptr [esp + 0x28]           ; f.z
30d69 fchs
30d71 fstp qword ptr [esp]                 ; r = (-f.z, 0, f.x)   (y was zeroed at 30d43)
```
