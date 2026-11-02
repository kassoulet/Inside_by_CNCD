# Scene 'flight' (98.4 s .. 118.1 s) - reverse notes

## Function map (linear addresses)
| addr | what |
|---|---|
| 0x1e948 | init (called at program start): loads lens1-5.raw, flare.shd, sun.raw, map.raw/.fog/.shd, river.raw, ship.sro, map.pal; builds world 0x106008 (320x200), landscape material 0x10600c (map.raw 512x512, shd=map.shd, fog=map.fog, masks 0x1ff/shift 9), env material 0x106000 (river.raw 256x256, no shade table, map.fog), calls 0x1d330 (camera obj 0x106004), 0x1d450 (terrain mesh + height table), 0x1d36c (vertex shade table), 0x1d8d0 (3 ship objects 0x105ea0/a4/a8 from ship.sro, random start orientation via rand()), 0x1e3d4 (sun sprite 0x1e294 + 8 lens-flare sprites 0x1e330) |
| 0x1ec28 / 0x1ec7c | scene start (set map.pal, `0x1c4ac(1.0,0x3c)` 60-tick fade up, A=0x1e1f8, B=0x1e8e4) / stop |
| 0x1e1f8 (A, per ISR tick) | steps the 3 ships (0x1ddbc(i, dt*c_i)), control point = ship 0, camera follow (0x1e0f8) |
| 0x1ddbc | ship physics step: position += orientation*speed, sinusoidal steering driven by `[0x1058c8]`, reflection at bounds around the leader |
| 0x1e8e4 (B, per frame) | 0x1e76c (doubles -> object ints/matrices), 0x1e638 (camera pushed away from ships by rand() when closer than R), 0x1e4d0 (flares visible only if the sun is within the screen +-12 px), 0x1dab8 (terrain vertices), 0x1dc64 (fog per vertex), 0x2d27c (clear 0xdd), 0x286ac (render) |
| 0x1d450 | 19x19 vertex / 648 face mesh (obj 0xdeec), height table 128x128 (sum of sin/cos terms via 0x1d2e0/0x1d308), then 3x3-ish box smoothing (0x1d79c) and mirroring (0x1d7f7/0x1d853) |
| 0x1d36c | per cell shade: `s = clamp_min(160, cos(atan(dh*k)+c)*a*b)` stored next to the height (8 bytes per cell {h,shade}) |
| 0x2e264 / 0x30e5c | face rasterisers (fog / no-fog variant), perspective texture mapping with self-modifying code |
| 0x36fa0 | vertex transform+projection; 0x31dbc/0x31dc8 sprite classes (sun / flare) |

## Data
* Height table [0x105ff8]: 128x128 cells x {i32 height, i32 shade}; heights -1448..246 (y is down, camera flies at y~-1024), shade 160..1023. NOT map.raw (map.raw is only the colour texture). Dumped from the emulator -> `web/js/flightdata.js` (HTS/SHD, Int16).
* map.raw 512x512 palette indices (map.pal); map.shd = 64 rows x 256: `shd[level][texel]`; map.fog = 128 x 256 `fog[level][color]` (rows >=62 are all 221 = sky/fog colour, so level = fogword>>4 is 0..63); river.raw 256x256 environment (fish-eye sky/ground picture) for the ships; flare.shd 256x256 additive blend `out = shd[texel][dst]`; sun.raw 128x128 ready-made palette image, colour-keyed on 221 (sky); lensN.raw sizes 74x63, 52x43, 31x23, 12x11, 4x4 (0 = transparent).
* ship.sro: header u32 {0x1df020, 0x20, nverts=200, faceofs=2432, nfaces=399}; vertex = 12 B {i16 x,y,z, 6 more bytes (packed env data, unused here)}, face = 8 B {u16 0, a, b, c}. Engine scales local coords by ~0.0977 (ints = raw/10.24).

## Terrain algorithm (ported in web/js/flightlib.js)
* camera cell gx=trunc(cam.x/512), gz likewise; mesh centred at (gx*512, 0, gz*512); vertex (r,c): local (-4608+512c, h, -4608+512r) with h = HTS[(gz+r)&127][(gx+c)&127], shade likewise; texture coord u = trunc(((gx%18)+c)*8192/36), v likewise with gz,r (1/8 texel units: `(u>>3)&511`; period 18 cells, no popping); fog word = clamp((dist-2662)*0.00078125*63*16, 0, 0x3f0), dist from the camera (position inside the cell: cam%512) to the vertex, 2662 = 0.8*3328 ([0x1037e8]).
* projection: c = diag(0.78125, 0.78125*5/6, 1) * M^T (p-cam)/512 (M = camera object matrix at +0x28 as 9 doubles row-major), sx=160+256*X/Z, sy=100+256*Y/Z, near plane Z=0.125 cells (0x19a020 = 8192 16.16). Vertex stores sx,sy in 1/16 pixel.
* faces: per cell (c,c+1,c+19) and (c+19,c+1,c+20); painter's algorithm sorted far to near on mean depth (face key = sum z/48); pixel = fog[fl][shd[sl][tex[v][u]]], sl = shade>>4, fl = fog>>4.
* ships: environment-mapped with river.raw; u,v from the view-space vertex normal (128+127*n); drawn in the same sorted list as the terrain faces. The original stores per-vertex env data in the SRO; here normals are recomputed from the faces (approximation).
* sun/flares: sun = ship0 + (-143360,-20480,0) (0x1e3d4/0x1e4d0), drawn first (far); sprites project with F=200 on BOTH axes (no 5/6), size DK/Z with DK~25400 and an extra 5/6 on the height; 8 flares at C+k*(S-C), k = 0,-0.2,0.5,0.3,-1.3,-0.9,-0.47,-2.0 (C=(160,100), S=sun screen), drawn last, additive through flare.shd, only when S is within the screen +-12 px; their sprite size is (5/6, 25/36) of the file size.

## Camera / ships
The ship sim (A, every tick, rand()-driven steering/camera nudges 0x1e638) is stateful; it is exported as a per-frame (10 ticks) float32 table of camera+3 ships (pos3+matrix9) from the emulator run started at 98.4 s (`PATH` in flightdata.js, 562 frames) and interpolated linearly: render() is a pure function of sceneTick. Display lag: sceneTick T shows state T/10-2.6 (render of iteration k is presented ~2.6 frames later). The tables come from the golden run that starts at 98.4 s (rand state of a full run from 0 would differ).

## Verified asm snippets
1. 0x1d3ca..0x1d3f4 shade from slope: `fild [dh]; fmul k; fld1; fpatan` = atan(dh*k) in ONE x87 instruction (atan2(y,1)), then `fcos`, scaled, stored as float, `fcomp` against 160.0 (0x43200000) with a branch that overwrites the value by 160.0 - a branch-based clamp-min on the FPU stack.
2. 0x2ea16..0x2ea71 texture/shade/fog inner loop, self-modifying: `sar eax,0x46 / and edx,0xdeadbabe / add ebx,0xdeadbabe` - the 0x46 shift, the 0xdeadbabe masks and increments are patched per polygon (0x2e8a0..0x2e962 write them into 0x2ea1c..0x2ea67), then `mov cl,[eax+tex]; mov dl,[ecx+shd]; mov dh,[esp+0xa6]; mov al,[edx+fog]` = three chained 8-bit table lookups per pixel with the shade (ch) and fog (dh) levels taken from byte 2 of two 16.16 accumulators.
3. 0x1dd1d..0x1dd33 fog: `fld d; fmul 0.00078125; fmul 63; fmul 16` -> word clamp 0..0x3f0 (stored at vertex+0x32), face fog test 0x1dd7e: faces whose 3 vertices have fog 0 get the cheaper rasteriser 0x30e5c instead of 0x2e264.
4. 0x2e264.. perspective: per vertex `xor eax,eax; inc dh; idiv [z]` = (0x100<<32... ) / z reciprocal, attributes premultiplied (u,v,shade,fog)/z and spans subdivided at power-of-two lengths (`shl eax,cl`).

## Fidelity (JS vs golden, START 98.4, 562 frames, 10 ticks/frame)
mean MAE ~11.8 (0..255 RGB), ~38 % pixels off by >8 after the 60-tick fade (terrain texture noise dominates; geometry, fog, sun, flares, ships visibly match). Approximations: ship env normals recomputed; exact span-subdivision/rounding of the rasteriser not replicated; path table instead of re-deriving the sim; sun size constant DK fitted; per-vertex hidden flag/frustum clipping of the original ignored.
