# Scene 'tunnel2' = the 'temple' scene (157.45 s .. 182.75 s) - reversed

Port: `web/js/scenes/tunnel2.js` (uses `Billboard`/`CScene` from `web/js/engine3d_credits.js`; script.js got a 1-line `startFlash` hook).
Fidelity (golden.py 157.451 740 frames, `--k=10`): **bit exact on every frame from the start of the scene up to the fade-out at 181.04 s (669 of 669 frames, 0 differing pixels; the earlier 'sub-pixel billboard rounding' diagnosis was wrong, see below)**;
cmp.py RGB MAE over the whole 722 frames = **0.27** (was 0.37 before the fade-out fix) (the rest: the two start frames, where the golden palette flash comes ~10 ticks later than ours).  ~1.5 ms/frame in node.
It is NOT the 'credits' tunnel: it shares no objects with it (the lead's table said "dark tunnel with flares (credits/smoke.shd ...)" - the files are `temple/*`): a glass temple seen by a camera orbiting in it, three light beams, ten flares.

## Files / objects
`temple/temple.raw` (256x256), `temple.int` (256x256 blend table), `temple.pal`, `flare.raw` (128x104), `flare.shd` (256x256 additive table; rows from 0x2000 are used as the beams' shade table), `mesta21/22/23.sro`, `putki.sro` (3 identical copies in the DAT, the demo uses the first).
* `mesta21` 49 vertices / 84 faces, face function TEX (0x2edb0), env-mapped; `mesta22` 192 / 256, BLEND (0x3269c: `dst = temple.int[(texel<<8)|dst]`, the glass), env-mapped;
  `mesta23` 173 / 268, GOURAUD (0x30e5c), own uv, flag 0x40 (ambient + the point light), 
  all scaled 0x1999/65536 (~0.1) at load, node matrix identity, at the origin.  **`mesta2x.sro` have a different 0x14 byte header** `{u32 size, vertex ofs 0x14, nverts, face ofs, nfaces}` instead of the 0x20-byte one with the magic 0x001df020 - the loader 0x2cbb0 ignores the first dword (the port patches it).
* three pipes `putki.sro` (15 vertices, 20 faces), SHADEDST (0x32dc8: `dst = shade[(s<<8)|dst]`, no texture) with material 2 (shade = flare.shd + 0x2000), ENV flag set but unused.  Pipe 0 and 1: vertices translated by -vertex[12] (0x2d72c) then scaled (1.5, 1.5, 5.3f) (0x2d6c8, float arguments, truncated), pipe 2 scaled (3, 3, 4.6f) without translation. Positions (0,-150,0), (0,-150,0), (0,100,0), static matrices: Euler(pi/2 + P, Q, 0), Euler(pi/2 - P, -Q, 0), Euler(pi/2, 0, 0).
* 10 flare billboards (class 0x10481c, draw fn 0x31dc8: shade-table blend), texture flare.raw (stride 0x80, 128 x 104), scale 1.0, size factor 0.25.  Direction vectors from `rand()` at init (0x1fda8: x = rand()%1000-500, y = rand()%300+70, z = rand()%1000-500), table 0x106c78 (doubles); embedded in tunnel2.js.
* camera node [0x106e74] = child of the pivot node [0x106ecc] (both created by 0x1f900); light node [0x106e5c] (flags 0x80, range 500 -> animated, peak 0x640) at the origin.
* scene: fov parameter 0xaa (170), near 0x2000, ambient 0, 320x200.  Creation order: pivot, camera, mesta21, mesta22, mesta23, pipe0..2, flare0..9, light.  **Draw order for equal depth keys = REVERSE creation order** (0x317d4 / the face lists are built at the head: the last created node is drawn first; in the port `scene.meshes.reverse()`).

## Function map (linear addresses)
| addr | role |
|---|---|
| 0x2061c | start handler: memset both page buffers (0x277a4, 0xfa00 bytes each), **white flash 0x1c498**, base palette `temple.pal` [0x106ed0] (`0x1c364`), A = 0x2007c, B = 0x20424 |
| 0x20668 | stop (A = B = 0), scripted at ~23.5 s into the scene (6702 ticks) - after that the screen is black (fade-out 35:48, 0x1c438; it starts 10 ticks later than the generic firing tick - tunnel2's script poll runs one 10-tick frame late - modelled by `scriptLag: 10` in tunnel2.js + script.js; palettes then match the golden run exactly on every fade-out frame. After the stop the index frames differ but the DAC is black, so RGB is identical) |
| 0x20464 | init (once): loads the 11 files (names 0x101b34..), materials [0x106ebc]/[0x106ec0] (0x2c5e4), scene [0x106eb4] (fov 0xaa), calls 0x1f900, 0x1f9c8; [0x106e64] = 10 flares |
| 0x1f900 | pivot node [0x106ecc] (identity, matrix 0x106a68), camera [0x106e74] (parent = pivot; local position vector 0x106ab0 = (0, 320, -850), local matrix 0x106e10 = Euler(0.2618, 0, pi)) |
| 0x1f9c8 | the six meshes (loop 0x1f9e5), per-object face function/material/scale patches (0x1faa3..0x1fd0a), flare nodes (0x1fd5a loop), light (0x1feb4..0x1ff02) |
| 0x2007c | **A**, per tick: `call 0x1ff10`, then the (dead) ping-pong counter [0x106e58] += [0x1037f8] between 0x96 and 0x2bc (nothing reads it) |
| 0x1ff10 | per tick: `M_pivot *= Euler(0, 0.01, 0)`, `M_cam *= Euler(0, 0, 0.005)`, per flare `M_i *= Euler(-0.01*(10-i), -0.03*i, 0)` (dead: billboards ignore their matrix), then the pipe matrices 0x106ba0/0x106be8 from the global tick (see below) |
| 0x20424 | **B**, per frame: scene fb = draw buffer, 0x200b0, 0x286ac, flip.  **No screen clear** (see below) |
| 0x200b0 | per frame node update from the tick counter [0x1058c4] |
| 0x31878 .. | billboard draw (shared with credits and flight) |

## Animation (c4 = global tick counter [0x1058c4] at the call; in the golden run c4 = scene tick + 10)
```
pivot.matrix = Ry(0.01)^n                          (n = number of A calls = scene tick; accumulated product, Stepper)
cam.matrix   = Euler(0.2618, 0, pi) * Rz(0.005)^n
cam.local    = trunc( (0, 320, -850) * g ),  g = 0.6 + 0.3*sin(c4*0.001122208506340478)        (0x203a6: zoom in/out, period ~5600 ticks)
P = sin(c4*0.00558659217877095)*35 deg,  Q = cos(c4*0.00432152117545376)*33.3 deg           (0x1ffe0..0x2000c)
pipe0.mat = Euler(P + pi/2, Q, 0),  pipe1.mat = Euler(pi/2 - P, -Q, 0)                      (0x20044: written by A into 0x106ba0/0x106be8, copied to the nodes by B)
flare i pos = trunc( V_i * (0.15 + |0.7*sin((c4 + 13 i)*0.0036886757654002217)|) )          (breathing around the origin)
light.range = trunc(|sin(c4*0.002168726957276079)|*1000)
pipe vertex 5+i (i = 0..5): w = sin((c4 + 265 + 53 i)/(55 + 11 i + 971.1)) * 243.2;  shade(pipe0) = trunc(w+256), pipe1 = trunc(w+320), pipe2 = trunc(w+352)   (0x20291..0x2038c)
```
So the scene is a closed form of the tick except for the two accumulated matrices.

## Stale pixels (page buffers are never cleared)
B calls 0x286ac without the `0x2d27c` clear that the other scenes do (compare with credits B 0x227eb..0x227f7).  The two page buffers alternate, so every pixel a face does not cover keeps the colour of the frame *two frames earlier* (cracks between faces, anything off the geometry): 
the first port without it differed by ~100-900 pixels/frame, with it 1.4.  The port replays the frames with two buffers (`Stepper`, checkpoints every 16 frames; frame k = scene tick 10k).

## Timing
LAG = 20 = 10 (flip) + 10 (phase of golden.py 157.451: the scene counters start 10 ticks after the music clock; the credits run has 20), c4 = scene tick + 10 as in the golden run (`make(dat, {c4off})` for a real absolute tick; only the phase of the sinusoids changes).
The start flash (0x1c498 before 0x1c364) needs `scene.startFlash = true`, which makes script.js call `f.white()` before `setBase` (1-line edit in the STARTS branch).

## Approximations / gaps
* flare direction table embedded.  The ~1.4 differing pixels/frame that used to remain were NOT x87 rounding: they were ties in the depth sort (equal key = trunc(z)/16) between faces/flares, drawn in creation order instead of reverse creation order (additive flares and glass faces do not commute).  Found by hooking 0x31878 in the emulator (tools/bbcheck.mjs replays the recorded inputs/outputs of 2943 calls through `bbGeom`: 0 mismatches; the sequence of drawn flares only differed by swapped tie pairs).
* **FPU precision control is DOUBLE (53 bit) in the demo** (0x27a78 only raises it to extended around its `frndint`).  The Ax/Ay/W/H doubles stored by 0x31878 match plain JS double arithmetic in the original operation order on 2943/2943 calls, an 80-bit model (BigInt/long double) mismatches 1843 of them.  So no extended-precision emulation is needed anywhere in the engine; this also holds for flightlib.js's SpriteNode and the other 0x31878 users (same function).
* the dead per-flare matrices, the ping-pong counter and the pipes' ENV uv are not computed.
* the two first frames (white flash before the first B) differ from the golden run (its screen still holds stale buffers there).

## Interesting asm
1. **Double constants passed through the stack with `push hi; push lo`** (0x1ff1e..0x1ff42): the Euler helper 0x305f4 takes three doubles on the stack; the compiler builds the 0.01 rad/tick with two immediate pushes and leaves the zeros for x and z:
```
1ff22 push 0x3f847ae1 ; 1ff27 push 0x47ae147b        ; double 0.01
1ff1e/20/2c/2e push 0 ...                            ; 0.0, 0.0
1ff38 call 0x305f4  ; tmp = Euler(0, 0.01, 0)
1ff3d mov eax, 0x106a68 ; 1ff42 call 0x30070         ; M_pivot *= tmp   (once per 285.7 Hz tick)
```
2. **One sinusoid, three shades** (0x202ec..0x20371): the three beams share a single `w`; the stack holds w, w+256, w+320... and each `fadd dword [0x101b2c]` (320.0) / `[0x101b30]` (352.0) derives the next beam's value while the previous `fistp` is still pending - the x87 stack is used as a 3-register scratch:
```
202ee fadd dword ptr [0x101b28]      ; w + 256.0 (float32 constant)
20305 fadd dword ptr [0x101b2c]      ; w + 320.0
20327 mov word ptr [esi + ebx + 0x30], ax   ; pipe0 vertex shade (+0x30 = gouraud shade word)
20330 fadd dword ptr [0x101b30]      ; w + 352.0
20371 mov word ptr [esi + 0x30], ax  ; pipe2
```
3. **The missing clear** (0x20424..0x20463 vs 0x227e6..0x227f7): no `call 0x2d27c`; the 8-instruction frame function is `scene.fb = draw buffer; update; render; flip`.  The black start (0x2061c memsets both buffers) is the only clear.
4. **Sprite-like objects sorted with the meshes**: the flares are scene nodes whose per-frame handler (0x317d4) inserts a draw item with key = trunc(z)/16 into the same radix sorted list as the mesh faces, so a flare is occluded by nearer glass faces but additively lights the faces behind it (draw function 0x31dc8 = `dst = flare.shd[(texel<<8)|dst]`).
