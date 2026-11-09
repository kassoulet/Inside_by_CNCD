# Scene 'nigga' (59.0-68.9 s and 136.6-147.6 s): notes

Port: `web/js/scenes/nigga.js`.  **Status: variants 1, 2, 3 and 4 bit-exact** in palette-index space against the original run in the emulator (0 differing pixels). Variants 3 and 4: 140+ checked frames each (a handful of single frames of the variant 3 run differ by a few pixels). Variants 1 and 2 (rebuilt with the engine, see below): 0 differing pixels on every checked frame (variant 2 pre-event ticks 100..700 and post-event ticks 1480..2460, variant 1 ticks 260..1320); before, they were ~4.3 % of pixels off (+-1 texel).

## Variants 1/2: what made them inexact (fixed)
1. The grid was drawn by a private barycentric rasteriser. The original draws it with the engine: 0x33a82 is the *same triangle setup and gradients as MODE.LIGHTMAP (0x332e0)* with the nigga texture as its own 'light map' (texel2 = tex[(v2,u2)]) and the .shd blend table as shade table, so `grid()` in `nigga.js` is a plain `Mesh` (64 vertices, 98 faces, double sided flag 0x100, camera (0,0,-1300), fov 0x100) with `setMapper(MODE.LIGHTMAP)`, per-vertex attributes (+0x28,+0x2a,+0x2c,+0x2e) = (vu, vv, vu2, vv2). Alone this took 4.3 % -> 0.04 % of pixels.
2. The three warp phases are **float32 accumulators** (`+= step` every ISR tick; checked on the emulator's 64x4 vertex attributes: 0 of 6656 differ with float32 accumulation against 98 with `m*step` in double). That removed the last 0.04 %.
3. The grid start matrix is exactly the variant 3 shadow matrix (`shM`, read from the emulator) and M(n) is accumulated per tick (`M <- M*Ry(0.01)`), not the 7-digit closed form.
The attributes drawn are those of tick A-10 (one frame lag, same as the matrix). Golden captures have to be aligned on `tick_scene` (`k = scene start tick + tick_scene`), not on the harness music clock: in the harness the music clock runs at half the ISR tick rate in this scene, so scripted events (0x20680, 0x2171c) land ~2x later in ISR ticks than in `script.js`, and a golden capture starting after the scene start restarts the phases (use a start before 58.9 s / 136.5 s).

## Structure
The scene runs on the "Surrender" 3D engine (same objects as flight/flower): camera 0x106fc0, render context 0x106fc4 (+0x3c = 0x100 focal, aspect 0x6aaa/0x8000), light 0x106fd0, materials 0x106fd4/0x106fdc/0x106fbc, objects:
* 0x106fd8 `grid-sro`: 8x8 vertices, 98 triangles (7x7 quads, vertex = 0x40 bytes, face = 0x34 bytes, two per 0x68 record).  Model coords x=-1400+350i, z=-1400+350j (spacing 700 for variants 3/4), y=0.
* 0x106fcc `kuubio` = nigga/poksi.sro, a 98-vertex/192-face room box (x +-2688, y -3208..3400, z -2024..4088). Drawn only in variants 3/4 (grid in 1/2; the flag bit0 pair at +0xc4 is flipped in 0x2089c / 0x20bf3 inside the frame function).
* 0x106fc8 `shadowmap`/shadowsquare: textured quad (shadow4/9.raw, .sdw) moving with the sprite in 3/4.
* sprites (0x31e50 creates, type 3 = plain transparent bitmap, colour key 0; blit loop 0x3265c): one per variant, tables at 0x106f20.

Variant selection: [0x1037fc]. Start handlers set it and call 0x1c364(palette[variant]) (palettes' first 3 bytes are zeroed at load: colour 0 black = sprite key): 0x217bc -> 2 (nigga2, sprite2.raw 172x200 at (0,0)); 0x21ba0 -> 4 (nigga4+qnt, sprite4.raw 170x168 at (94,28)); 0x2185c -> 3 (nigga9+qnt, sprite9.raw 274x147 at (46,53)=(320-w,200-h)); 0x2171c -> 1 (nigga1, sprite1.raw 164x156 at (0,44)). 0x20680 (events 61.5 s, 146.4 s): flips the sign of all warp frequencies/amplitudes/steps and resets the 3 phases. 0x21f00: [0x103800]=30 (camera drift per frame, 3/4). Stop 0x20728.

## Per-tick / per-frame
A = 0x20738, every ISR tick: three phase accumulators ([0x103810/824/838] += steps) and `0x30070(obj+0x28, 0x106ed8)` for grid and box: M <- M * Ry(0.01 rad): the grid orientation is closed form M(n) = G0 * Ry(0.01 n), G0 = [[-0.98999,0,0.14112],[0.14077,0.07074,0.98751],[-0.00998,0.99749,-0.07003]] (n = ISR ticks since the first scene start; period 2 continues from period 1). The matrix used for drawing is 10 ticks older than M (one frame lag).
B = 0x207a0 (variants 1,2 path 0x2089c..0x20bb5): for each vertex (i,j) the four 16-bit attributes, with a=A1*i+p810+A2*j, b=B1*i+p824+B2*j, c=C1*i+p838+C2*j and amplitudes aA,aB,aC (pre-event: freq .3 .2 .4 .6 .7 .5, amps 425 130 250, steps .07 .05 -.06):
 +0x28 u1 = 512i + aA sin a + aB sin b + aC sin c ; +0x2a v1 = 512j + aA cos a + aB cos b + aC cos c ; +0x2c = 512j + aC sin a + aB cos b + aA sin c ; +0x2e = 512i + aC cos a + aB cos b + aA sin c (all truncated with the 0x27a78 FRNDINT-chop helper).
Projection (engine 0x37e91 reads vertex +0x14/+0x18 as 28.4 screen x/y): sx = 160 + 256 X/Z', sy = 100 + 213.33 Y/Z', Z' = Z + 1300 (camera at z=-1300), (X,Y,Z) = M * model.
Rasterizer 0x33a82 (affine, two textures, no perspective; implemented as MODE.LIGHTMAP of the engine): `texel1 = tex[(v1>>16 & 0xff)<<8 | (u1>>16 & 0xff)]`, `texel2` likewise from attributes (+0x2c,+0x2e), pixel = shd[texel2<<8 | texel1] (the .shd tables are 256x256 *blend* tables, not shade tables). Attributes are 1/16 texel (4096 = 256 texels). In variants 3/4 the shadepoly routine 0x31496 is used instead (tex, then qnt[(I<<8)|tex], I = Gouraud light interpolated in 16.16, 64 levels).

## Timebase oddity
The golden capture runs the frame-wait spin loop 0x20fd6 which injects extra ISR ticks, so in the golden nigga frames one frame = 20 ticks and the animation runs 2x faster than the music clock; events (script) are in music time. Index comparisons were made against golden frames at A-tick = tick_total with the port's lag.

## Variants 3 and 4: the room (verified)
Found by fitting the emulator's own projected vertices (RANSAC DLT on the 98 box vertices: K = diag(256, 213.33) + (160,100), R = Mcam^T W, t = Mcam^T (pos_obj - pos_cam)): the box is an ordinary engine mesh and the earlier "view transform did not match" was the missing 8x vertex scale and the missing material uv override.
* **box** `poksi.sro` at scale **8** (int16 * 8: x +-2688..2696), node flags 0x40, face function 0x30e5c (MODE.GOURAUD) with the room texture `nigga9.raw`/`nigga4.raw` and shade table `*.qnt`. Faces alternate between two materials (0x106fdc even, 0x106fd4 odd) whose flag `[mat+0x18]=1` makes the mapper prologue 0x37e48 write a *per-triangle uv set* into the three vertices before drawing: even (0,0xff0),(0xff0,0xff0),(0xff0,0); odd (variant 3) (0,0),(0,0xff0),(0xff0,0) or (variant 4) (0,0),(0xff0,0),(0,0xff0). (`engine3d.js` now implements `Material.uvs`.)
* **scene** fov param 0x100 (fx 0x8000, fy 0x6aaa), ambient 0x70, near 0x1600. **camera**: fixed matrix and position set by the start handler (v3 (-1600,2000,-2200); v4 (-550,2000,-500), euler angles at [0x103804..]); after event 0x21f00 [0x103800]=30 and every frame `y -= 30` (and `x -= 15` in variant 4); one frame = 20 ticks in the golden captures.
* **box matrix**: reset to identity by the start handler (0x2185c / 0x21ba0) and multiplied by the per-tick rotation Ry(+0.01) (v3) / Ry(-0.01) (v4) (matrix 0x106ed8 is rewritten by the handler: `euler(0, +-0.01, 0)`); the drawn matrix is 10 ticks old.
* **light** (range 5000 = 0x1388): position and peak are closed forms of the global tick T (x87 code 0x20c18 = v3, 0x20d2f = v4), evaluated with T one frame (10 ticks) in the past: peak = trunc(400 sin(0.0033255737 T)+1200); v3 pos = 1750*(cos(0.0055370986T) sin(0.0048053820T), cos(0.0056625142T) sin(0.0061236987T), cos(0.0050864700T) sin(0.0066489362T)); v4 uses 0.0076569678 / 0.0088261253 for the x / y frequencies.
* **shadow quad** (node 0x106fc8, position (300,3000,600), sort bias 666666, no culling, BLEND 0x3269c through a 16 level table `shadowN.sdw`, texture 128x128 (v3 `shadow9`) / 256x256 (v4 `shadow4`)): 4 vertices, matrix G0 (v3) / Ry(1) (v4); vertex 1 (x,y) animated: v3 (2048-512 cos(.0055370986T) sin(.0048053820T), 1024 cos(.0056625142T) sin(.0061236987T)); v4 (-750+200 cos(.0076569678T) sin(.0048053820T), 500+500 cos(.0056625142T) sin(.0088261253T)). Static vertices v3 (0,0,0),(.,.,0),(400,-2400,0),(1948,-1600,0); v4 (900,700,500),(.,.,500),(900,700,-700),(-750,700,-700); uv (4080,0),(0,0),(4080,4080),(0,4080); faces (0,1,2),(2,1,3).
* Checked against `golden.py` with the original's own tick counters (the golden harness runs the frame-wait loop with extra ticks, so frames must be compared at `tick_total`/`tick_scene` of each golden frame, not at the music clock): 0 differing pixels in 140+ consecutive frames of each variant.

## asm snippets (verified, live memory)
1. Self-modifying span loop, as patched at run time for a triangle (0x33a82): the constants 0x13118e7/0x13218e7 are the texture and blend-table addresses, the shifts/masks are poked in by the triangle setup, so the loop has no mask registers:
```
33a82 mov eax,ebx ; 33a86 sar eax,0x10 ; 33a8f and eax,0xff        ; u texel column
33a89 and edx,0xff0000 ; 33a9a sar edx,8 ; 33a9d add eax,edx        ; (v&0xff0000)>>8 = row*256
33aa5 mov cl,[esp+0x9e] ; 33ab7 mov ch,[esp+0xa2]                   ; 2nd texture coords = byte 2 of two accumulators
33ac9 mov dl,[eax+tex] ; 33acf mov dh,[ecx+tex] ; 33ad5 mov dl,[edx+shd] ; blend through 64K table
```
2. Sprite blit 0x3265c: `mov al,[esi]; cmp al,bl; je skip; mov [edi],al` colour-key 0 per pixel.
3. `0x30070`: 3x3 double matrix product executed every ISR tick (`fld [eax+8]; fmul [edx+0x18]; fld [eax]; fmul [edx]; faddp ...`) - the whole scene rotation is one Y rotation by 0.01 rad (matrix at 0x106ed8, cos=0.99995, sin=0.0099998) per tick, so it has a closed form.
