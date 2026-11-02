# Scene 'logo' (script 0x1f164 @ 3:63 = 19.614 s, until 5:63 = 29.46 s)

Port: `web/js/scenes/logo.js` on top of `web/js/engine3d.js`.  **278/278 captured golden frames are bit-exact in palette-index space** (0 differing pixels, frames of the scene from `golden.py 19.0 330`, one-frame lag convention below).  The palette (logo/logo.pal) and the fades/flashes come from script.js/fade.js.  1.9 ms/frame.

## What the scene is
* Start handler 0x1f164: `0x1c364(logo.pal)` (base palette), A = 0x1ee30 (called from the tick ISR path, once per tick), B = 0x1ef1c (per frame).  Init 0x1ef9c (run once when the script is loaded, before the scene starts).
* Files (names at 0x1018a0..0x101950): `logo/twlogo.raw` (256x256 twirl texture), `logo/logo.shd` (16384 = 64 rows x 256 shade table), `logo/logo.pal`, `logo/obuke.sro`, `logo/inside.raw` (249x139 logo text, key 0), `logo/inmask.raw` (253x147 mask, key 0, values 0..15), `logo/inmask.shd` (16 rows x 256).
* **3D**: `obuke.sro` = 130 vertices, 256 faces, a big spiky star (vertex radius <= 516).  The **camera sits inside it** at (0,0,100) looking down +Z (identity matrix, vector 0x106178 = (0,0,100.0)); fov 42, near 0x3000.  The object spins about the origin:
  callback A (0x1ee30) does `M190 = M190 * R` once per ISR tick (285.7 Hz), `M190` starts as identity (0x1edc5), `R = 0x305f4(-0.01, 0.00867..., 0.0123...)` (rotation about X, Y, Z, doubles pushed at 0x1efb9..0x1efd2:
  `0xbf847ae147ae147b, 0x3f816872b020c49c, 0x3f894855da272863`), i.e. `R^t` at scene tick t, no keyframes and no camera path: the camera is fixed.  `R` per tick ~0.7 degrees, the star turns about 2.8 rad over the scene.
  Object flags 0x40 (ambient+lights), one **light** node at the origin (0x1edca..0x1ee01): range 0x226 = 550, peak 0x640 = 1600, flag 0x80.  All faces use the single material (twlogo, shade table = logo.shd, masks 0xff, texture 8x8 bits) and face function **0x30e5c** with affine mapping (flag bits 10..12 = 0).
  Because the camera is inside the star, many triangles cross the near plane: the near-clip code (0x380e0) is exercised heavily (about half of the 93 listed faces per frame), 168 mapper calls per frame.
* **2D**: B draws sprite [0x106514] ('logo mask', type 4) at (31, 9) every frame, and sprite [0x106534] ('logo text', type 3, colour key 0) at (34, 13) once the script event 0x1ef10 (4:32 = 22.152 s) has set [0x10653c] = 1.
  Draw order per frame: clear to 0 (0x2d27c) -> 3D (0x286ac) -> mask -> (text).  The 'mask' darkens the star through `inmask.shd` in the letter shape (shadow/outline), the text is then drawn 3 px right, 4 px down of it.
* Script: 3:63 start (white flash from the global ops), 4:32 `0x1c498` flash + 0x1ef10 (text appears), 5:0 flash, 5:32 inverted flash (0x1c454), 5:63 flash + next scene.  All flashes are script.js business.

## Port details
* `matrixAt(t)` = `R^t` by repeated `mat3.mul` (bit identical to the accumulated original: first renders at ticks 30 and 300 compared exactly), cached with a checkpoint every 64 ticks (seekable, ~1 mul per tick forward).
* **Frame lag**: the picture on screen at tick T was rendered by the frame function one frame earlier, so `render` uses `R^(sceneTick - LAG)` with `LAG = 10` (= FRAME_TICKS of the golden captures; the real player at another frame rate would see 1 frame of lag as well - the constant is at the top of logo.js).
* Verified intermediate data (tick 30 and 300 dumps of vertex/face structs): all 130 vertex normals/shades/camera coords, 256 face normals, sort order, and the final 320x200 buffer.
* Mask event: `rt.events` entry with `fn === '0x1ef10'` (tick relative to the scene start); the golden run started the scene 15 ticks later than Timeline (see below) so its event was at scene tick ~741 vs 726 in the Timeline - both render correctly because the scene is a pure function.

## Fidelity numbers
* palette-index space vs golden (`golden.py 19.0 330 g3`, scene frames aligned by the golden's own `tick_scene`): **0 / 64000 differing pixels in all 278 frames**.
* `tools/cmp.py` (RGB, aligned by absolute time) reports MAE ~19..25 / bad ~55-65 % **only because the golden run (START_SEC 19.0) starts the scene 15 ticks after Timeline does** (golden `tick_scene = tick_total - 190`, i.e. scene start at tick 5619.6, Timeline: 5604) plus the fade; the star spins 0.7 degrees/tick so 15 ticks is a large visible difference.  A direct index comparison with the right scene tick is exact.
  (Suggestion for the lead: the golden harness evaluates the script on its virtual clock one frame late; compare by `tick_scene`.)
* No approximations in the logo scene. The only engine parts not exercised and not ported: bbox rejection (speed only) and flares.
