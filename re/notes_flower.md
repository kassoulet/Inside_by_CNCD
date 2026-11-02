# Scene 'flower' (68.9 .. 98.4 s) - reversed

Port: `web/js/scenes/flower.js` + `web/js/engine3d_flower.js` (extensions to engine3d.js, see "merge"). Golden compare (harness caveat below): **856 frames, mean MAE 7.67, 8.6 % pixels off by >8; 75 % of the frames are pixel exact (MAE < 1), median 0.00**.
All remaining error is (a) the palette-flash frames (script.js applies the white/invert flashes 0..10 ticks earlier than the original, MAE 60..190 on ~8 % of the frames), (b) a handful of pixels per frame from x87 80-bit vs double rounding in the engine (MAE 1.0..1.5 in some stretches). Mean MAE of the non-flash frames (<60) is 1.03. Render time 1.0 ms/frame in node.

## Harness caveat (important for whoever compares)
In this scene the frame function B ends with a spin loop (`0x2571b: cmp [0x103984],0 ... 0x25724` where golden.py injects K more ISR ticks), so the golden run advances **20 ticks per frame but its music clock only 10** (events then fire 2x too late in tick terms).
`re/golden_tickclock.py` (my copy of golden.py) drives the virtual AMF clock from the ISR tick counter; use `--k=5` (5+5 ticks per frame). Everything below was verified against that.
Two empirical timing facts: (1) the picture shown by the capture is the A-state of **15 ticks earlier** (LAG=15; 14 or 16 doubles the error: one tick of spin/morph changes ~35 % of the pixels), (2) script events (0x25358/0x253f0) take effect at the next **10-tick frame boundary relative to the scene start** (applied tick = 530, 1410, 2820, 3170, 4220, 4930, 5630, 6330, 7040 for nominal 528, 1407, 2813, 3165, 4220, 4923, 5626, 6329, 7033) -> `ceil(tick/10)*10` in the port. The palette flashes in the golden show up ~12 ticks later than script.js's `0x1c498/0x1c454` (same frame-boundary + display latency effect) - lead may want to quantise palette events likewise.

## Function map (linear addresses)
| addr | role |
|---|---|
| 0x25730 | init, called once at program start: scene (0x2c878, 'flower scene'), 3 materials 0x44 bytes ('flower tunnel-mat1/2', 'flower flower-mat'), camera node 0xc8 ('flower camera'), loads the 12 .sro + jeesus.shd/.pal/jeesus1.raw/jeesus2.raw, `0x24030` (lws, scale 3000.0 = 0x453b8000 pushed at 0x25896); tunnel vertices get a fixed shade table (loop 0x259e9, below); odd tunnel faces get material 2 |
| 0x258c4 | script start handler: builds scene graph (camera, tunnel mesh [0x19761c] with face fn 0x30e5c, flower mesh [0x197620] with face fn 0x2edb0 + node flag [+0xc5]|=0x10, parent = camera, pos (0,0,1500), sort bias 0x35200, 10 morph target meshes [0x197624..] not added to the scene), faces >= 350 of the tunnel hidden, scene fov [+0x3c]=0x100, near [+0x44]=0x2000, camera = scene[+0x38]; installs A=0x2540c (0x1caf4) B=0x255f8 (0x1cb04), base palette jeesus.pal (0x1c364) |
| 0x2540c | callback A (per 285.7 Hz tick): tunnel face window, flower morph phase, texture scroll, camera frame counter, flower spin/rotation |
| 0x255f8 | frame function B: clear (0x2d27c), 0x240d8 camera/object poses, material scroll offsets, 0x2d4c8 morph, 0x286ac render, present 0x1cbec, spin on [0x103984] |
| 0x25358 | event "open": flower node enabled, phase=0, spin=0, state=1, idx=(idx+1)%9; ends with flash 0x1c498 (idx even) or invert 0x1c454 (idx odd) |
| 0x253f0 | event "close": flower node flag |= 1 (disabled), state=0, flash 0x1c498 |
| 0x25e90 | stop (A=B=0) |
| 0x24030 | loads 'flower/tunnel1.lws' (0x1c614), NUL terminates at +0xa47 (file size 2631), calls the parser; errors 'scene file not found' / 'scene read error' / 'not a scene file' (0x102460..) |
| 0x24480 / 0x24588 | LWS parser: token scan by 0x25050 (strcmp-ish on 'LWSC','FirstFrame','LastFrame','ObjectMotion','CameraMotion','EndBehavior' at 0x10386c), ints 0x24d70, floats 0x24dfc; 0x24588 reads one *Motion block and expands it to one sample per frame |
| 0x250cc | cubic Hermite / Catmull-Rom spline (floats 0.5, 2, -3, 3, -2 at 0x1024ad..0x1024bd) |
| 0x240d8 | pose at the float frame counter [0x19785c]: for the 2 objects (camera idx 0, tunnel idx 1): 6 x 0x250cc between samples rem+1 and rem+2 (rem = trunc(f) % 266), `0x2c868` set pos, `0x2c8dc(0..)` reset matrix, then 0x305ac rotY(+a4), 0x305c4 rotX(-a3), 0x305dc rotZ(-a5) |
| 0x24090, 0x25164, 0x25258 | reset f=0 / dead code for "type 2" objects (vertex pack/unpack, never selected: all types are 0 or 3) |
| 0x2d4c8 | morph: dst = A + trunc((B-A)*t) for vertex xyz (+8..+0x10), face normals (+0x20..0x28 of the 0x34-byte face) and vertex normals (+0x34..0x3c) |
| 0x2edb0 | petal face function: **affine/perspective texture mapper WITHOUT the shade table** (same gradient setup as 0x30e5c, inner loop 0x2f268 stores the raw texel) |
| 0x37e3c | common prologue of all face functions: if material[+0x18]&1 the three vertices get their uv from the material rectangle [+0x20..+0x34] (tunnel) |
| 0x36cc4 | env-map uv generator "N2" (node flag [+0xc5] bit 4): uv from 2*vertex normal rotated into camera space plus camera x,y/64 |

## Objects
| file | vertices | faces | use |
|---|---|---|---|
| tunneli1.sro | 732 | 1440 | tunnel (20324 bytes), uv from the .sro are replaced by the material rectangle |
| kukka1.sro, kukka1-2 .. kukka1-8 | 111 | 125 | morph shapes (8 petal variants; kukka1 also the base mesh) |
| kukka2.sro, kukka2-2.sro | 109 | 129 | two more shapes (loaded as morph targets; their vertex count is smaller: 0x2d4c8 lerps min(nv) vertices) |
| tunnel1.lws | - | - | 2631 bytes: 1 object (tunneli1, zero motion), 1 light (ignored by the parser), camera with 19 keys, frames 1..265 at 30 fps |
Header of these .sro: `u32 filesize, u32 vertexOfs=0x14, u32 nverts, u32 faceOfs, u32 nfaces` (the logo ones have the magic 0x001df020 and a 0x20 header; the loader 0x2cbb0 ignores word 0). Vertices 12 bytes {i16 x,y,z; u16 u,v,pad}, faces 8 bytes {u16 w0 (ignored: loader stores flags 0), a,b,c}. The uv of the flower vertices in the file is junk (replaced by the env map).
Textures: jeesus2.raw (256x256) = tunnel, jeesus1.raw = flower, jeesus.shd = 64 shade rows used by the tunnel only, jeesus.pal = palette. Materials: flags [+0x18]=1 for tunnel-mat1/2, u/v masks 0xff, bits 8/8 ([+0x40/0x41] = 8, 8). flower-mat has no uv rectangle.

## LWS format and interpolation
```
LWSC / 1 / FirstFrame 1 / LastFrame 265 / ... / LoadObject ... / ObjectMotion (unnamed) / 9 / <nkeys> / <x y z heading pitch bank sx sy sz> / <frame linear tension continuity bias> ... EndBehavior 1
CameraMotion (unnamed) / 9 / 19 / (key line, param line) x19
```
`0x24588`: channel scale: x*3000, **-y*3000**, z*3000, angles*0.01745277777 (= pi/180 with a 3.14150 pi, constant at 0x10249d); stored per frame as 9 floats {x, y, z, pitch(lws field 5), heading(lws field 4), bank, 1, 1, 1} (field order swapped: stored[3] = lws pitch, stored[4] = lws heading).
Expansion: for each key segment (frames f0..f1-1) `t=(f-f0)/(f1-f0)`, value = **Catmull-Rom Hermite** (tangents (p2-p0)/2, (p3-p1)/2, first/last key duplicated; tension/continuity/bias are ignored, param [0x103868]=0) -> sample index f+1 (index 0 duplicates index 1; the tail repeats the last key; 512 entries per object, stride 0x24). Verified against the emulated table to float32 rounding (rel. err 5e-6).
Runtime: frame counter f (float32, +0.15 per tick = 42.9 frames/s; reset to 0 when f > 260 -> **the 6.07 s camera loop** = 1734 ticks), pose = Hermite again between sample rem+1 and rem+2 with t = f - trunc(f). Camera node: pos = trunc(x,y,z); matrix = I, rotY(+heading), rotX(-pitch), rotZ(-bank) (fit against the emulated camera matrix, max err 1e-7). The tunnel has an identity pose.

## Per tick state (callback A 0x2540c) - all closed form / replayed in `stateAt`
* `ctr` ([0x103944]) += 1; faces: idx = trunc(ctr*0.75); if idx+348 < 1440: face idx+348 shown, face idx hidden (initially faces >= 350 are hidden) -> a window of 348 faces slides along the tunnel (0.75 face/tick). Wrap together with f > 260 (ctr=0, all visible, faces >= 350 hidden again).
* scroll X=Y = (X+0x3b)&0xfff = (59*n)&0xfff; materials: mat1 uv rectangle (X,Y),(X+0x1000,Y),(X+0x1000,Y+0x1000), mat2 (X,Y),(X+0x1000,Y+0x1000),(X,Y+0x1000): even faces mat1, odd mat2 -> each quad of the tunnel shows the whole 256x256 texture once, scrolled by 3.7 texels/tick.
* if open: phase [0x103948] (float32) += 0.02 ([0x1038f4] float table); the morph pair for B is (target0=kukka1, target idx+1), idx = [0x10394c] (0..8; initial state is open with idx 0), blend t = |sin(phase)| (float32): the flower breathes with a 157 tick period.
* spin [0x103954] (float32) += 0.02 per tick (reset to 0 by the open event); flower matrix = euler(ax = [0x103918+4*idx] deg (-100,-70,-130,-80,-120,-90,-100,-110,-80), ay = spin, az = 0) via 0x2c8dc -> 0x305f4.
* Script events: 14:24 .. 19:12 alternate open/close (9 opens: idx 1..8, 0). Opening re-enables the node, resets phase and spin and picks the next shape; closing disables the flower, leaving only the tunnel.
Draw order: flower sort bias 0x35200 (= nearer than the tunnel); flower is a child of the camera 1500 units ahead (so its world position = camera + R_cam * (0,0,1500)).

## Rendering notes
* Tunnel: 0x30e5c (gouraud texture, affine: all face flags are 0, so **the perspective mapper is not needed by this scene**), shade from the per-vertex table written at init (dump embedded as `TUNNEL_SHADE`): `shade = clamp(trunc(300*sin(0.05*x)*cos(0.04*y) + 700*sin(0.04926*i)) + rand()%600 - 300, 0..0x3ff)` (formula verified: all non clamped dump values lie within the rand range); the rand state at program start is not reproducible without running all inits, hence the dump. Node flag [+0xc4] = 0 so 0x36ba4 does not reset/add lights (no lights in the scene).
* Flower: env-map uv: u = -(trunc(row0.(2n) + 2048) & 0xfff) - trunc(vcx/64), v = (trunc(2048 + row1.(2n)) & 0xfff) + trunc(vcy/64) (M = Mcam^T * Mobj rows 0,1; 2n = twice the vertex normal, vcx/vcy the camera space x,y >> 11 of the vertex). The uv are stored as int16 (negative values wrap in the texture masks). Texture index masks 0xff.
* Scene: fov 256 (fx=0x8000, fy=0x6aaa), near 0x2000; vertex 'in-use' flags come from the faces that survive culling, exactly like engine3d.js.
* Bit exactness: vertex screen coordinates / uv of the flower match the emulated original exactly (0 differences on 81 visible vertices at sc=105); tunnel vertices differ by +-1 in some low bits (x87 extended vs double in the engine's transform).

## Approximations
* x87 80-bit intermediates replaced by doubles (morph lerp, spline, env map): some frames differ by a few pixels.
* LAG=15 and the 10-tick event quantisation are properties of the golden harness (see above); the real machine had its own frame period.
* The shade table dump (`TUNNEL_SHADE`) stands for rand().
* Dead code not ported: 0x24090 loop for "type 2" objects, 0x25164/0x25258.

## Merge suggestions for engine3d.js
`parseSROAny` (no magic check, works for both header variants); `FlowerScene._envmaps` N2 branch (flag ENV_UV_N2, the engine only declares it); the "unshaded mapper = identity shade table" equivalence for 0x2edb0 (a `Material({shade: identityShade()})`); a mapper `quad(...)` that implements 0x37e3c (material uv rectangle) as a prologue of drawFace when `mat.corner` exists.

## Asm snippets (verified with ds.py)
**1. Self-modifying inner loop of 0x2edb0 (0x2f268)** - the loop contains no memory operands for the constants: the setup code (0x2f18e..0x2f1ca) patches the immediates in the instruction stream (0xdeadbabe placeholders): shift counts `24-ubits` into the `sar`, the v mask `vmask<<(24-vbits)` into one `and`, the u mask into the other, the gradients DU/DV into the two `add`s, the **texture base pointer into the displacement of the final byte load**:
```
2f18e: mov cl,0x18 / sub cl,[esi+0x41] / shl ebx,cl       ; vmask << (24-vbits)
2f19a: mov [0x2f271],ebx   ; and edx,imm32  (v mask)      2f195: mov [0x2f276],eax  ; and eax,imm32 (u mask)
2f1a8: mov [0x2f282],al    ; sar edx,imm8 = 24-ubits-vbits   2f1b2: mov [0x2f26e],al ; sar eax,imm8 = 24-ubits
2f1c5: mov [0x2f27c],eax   ; add ebx,imm32 (DU)           2f1ca: mov [0x2f287],ebx ; add esi,imm32 (DV)
2f268: mov eax,ebx / mov edx,esi / sar eax,0x46(patched) / and edx,0xdeadbabe / and eax,0xdeadbabe / add ebx,DU
2f283: add eax,edx / add esi,DV / mov dl,[eax+TEXBASE] / dec ebp / mov [edi],dl / lea edi,[edi+1] / jne 2f268
```
u and v live in two 8.24 accumulators; masking the v accumulator *in place* (shifted down by the patched `sar`) yields `(v>>?)&mask` already multiplied by the row pitch, so one `add` produces the texel offset; the 0x30e5c twin has the same loop plus `mov dl,[shade+..]`. No 'mov al,[tex]; mov al,[shade+eax]' pair here: the petals are unshaded.

**2. Face prologue 0x37e3c: texture coordinates from the material** (the tunnel needs no per-vertex uv; a quad = two triangles sharing the material rectangle, scrolled by changing 6 dwords per frame):
```
37e48: test dword [edx+0x18],1 / je 37e7b
37e51: mov ecx,[edx+0x20] / mov ebp,[edx+0x24] / mov [esi+0x28],cx / mov [esi+0x2a],bp   ; vertex a uv = rect 0
37e5f: ... [edx+0x28],[edx+0x2c] -> edi ;  37e6d: ... [edx+0x30],[edx+0x34] -> ebx
```
**3. Branch free signed division by 64 (truncation) in the env-map generator 0x36cc4:**
```
36d10: mov eax,[ebx+0x20] / mov edx,eax / sar edx,0x1f / shl edx,6 / sbb eax,edx / sar eax,6
```
`shl edx,6` leaves CF = (edx was -1) = sign bit; `eax - edx - CF` adds 63 for negative values (edx=-64, CF=1) so the final `sar` rounds toward zero. The same function does the u wrap with `and ecx,0xfff / neg ecx / sub ecx,eax` (store as 16 bit word, no masking after the subtraction).

**4. Catmull-Rom spline 0x250cc** (x87, 5 constants in the data segment, ~45 instructions, no loop): `fld1; fld t; ... fmul 0.5; fld 2.0 ... fsub; fadd -3.0; fmul t^2 ...` evaluates h00*p1 + h10*m1 + h01*p2 + h11*m2 with m1 = 0.5*(p2-p0), m2 = 0.5*(p3-p1); the same routine expands the keys at load time (0x24588, once per channel and frame) and interpolates between frames at run time (0x240d8), so the camera moves at 42.9 Hz sub-frame resolution although the file has 30 fps keys.

**5. Tunnel sliding window (A, 0x2540c..0x25489):**
```
25415: inc [0x103944] ; fild ; fmul 0.75 ; frndint(trunc, 0x27a78) ; fistp -> edx
25440: add edx,0x15c ; cmp edx,[ebx+0xdc] ; jge skip
25461: and byte [face(idx+348)+0x30],0xfe      ; show
25484: or  byte [face(idx)+0x30],1             ; hide
```
(0x34-byte faces, index*0x34 computed as `lea eax,[edx*4]; sub eax,edx; shl eax,2; add edx,eax; shl edx,2` = 13*4*i.)
