# ENGINE READY  (web/js/engine3d.js, ES module, node 22 + browser)

**What works, bit-exact against the original running in the emulator**
* scene graph (Node / Mesh / Light, parent chains), `.sro` loader (`parseSRO` + `Mesh`: normals, bbox), camera, projection, back-face cull, near-plane clipping,
  gouraud point lights, radix depth sort, per-vertex environment-map uv (`FLAG.ENV_UV_N2`), 2D sprites (types 1,2,3,4).
* **all six face functions (mappers) of the demo**: `MODE.GOURAUD` 0x30e5c, `TEX` 0x2edb0, `GOURAUD2` 0x2e264, `BLEND` 0x3269c, `SHADEDST` 0x32dc8, `LIGHTMAP` 0x332e0, each affine or
  perspective-correct (face flag bits 10..12).  `node tools/test_mappers.mjs cases.json` replays random triangles recorded from the real code (`tools/mapper_cases.py`): 180/180 cases, 0 differing pixels.
* the logo scene: 278/278 golden frames have 0 differing pixels in palette-index space (see notes_logo.md); 1.9 ms/frame in node.

**Not ported (gaps)**: the billboard/flare node type (chain 0x10481c, constructor 0x31793, per-frame 0x317d4, draw functions 0x31dbc/0x31dc8; used by flight sun/lens flares, tunnel2, credits),
bbox rejection 0x365b8 (speed only), the never-enabled uv generators 0x36c04/0x36dcc/0x36e9c, heightfield/landscape and water code of the other scenes (those are scene code, not engine).

## Quick API (see the header of engine3d.js for the long version, web/js/scenes/logo.js for a complete user)
```js
import { Scene, Node, Mesh, Light, Material, Sprite, parseSRO, mat3, MODE, FLAG, FACE } from '../engine3d.js';
const scene = new Scene({ width:320, height:200, fov:42 /*[scene+0x3c]*/, near:0x3000, ambient:0 });
const cam = scene.camera = new Node(); cam.setPos(0,0,100); scene.add(cam);          // pos = int32 world units, cam.mat = rotation (Float64Array(9), mat3.*)
const mat = new Material({ tex, shade /*[mat+8]*/, shade2 /*[mat+0xc]*/, lmap /*[mat+4]*/, ubits:8, vbits:8 });
const mesh = new Mesh(parseSRO(dat.get('x/y.sro')), mat, /*scale*/1);  mesh.flags |= FLAG.ENV_UV_N2; mesh.setMapper(MODE.TEX); mesh.setFaceFlags(0|(3<<10));  scene.add(mesh);
scene.add(new Light(range, peak));  mesh.setPos(..); mesh.setMatrix(m);  scene.clear(fb,0); scene.render(fb);
```
* Everything per frame is a pure function of the node matrices/positions you set, so scenes stay seekable (the original accumulates the matrices per tick: `M *= Rinc` in the ISR callback;
  `mat3.mul` has the original operation order so `M^t` computed by repeated multiplication is bit identical; logo.js keeps checkpoints every 64 ticks).
* per-face mapper: `mesh.fmapper[f] = MODE.x | function(scene, mesh, f, fb)`; per-face material: `mesh.fmat[f]`; face flags `mesh.fflags[f]` (bit0 hidden, bit8 double sided, bits10..12 subdivision n: 0 affine, else perspective every 2^(n-1) px).
* custom (non 3D) code can use the low level triangle filler directly: `scene.rs` (fill `rs.x/y/z` in 1/16 pixel + `u,v,s,s2,u2,v2` words, then `rs.tri(scene, fb, mat, flags, 0,1,2, mode)`), see tools/test_mappers.mjs.

# Reverse engineering notes

## Memory layout / structures (all dword offsets verified in the dumps)
**scene** (0x50 bytes, allocated by the scene init, e.g. 0x1ef9c: `0x274d8(0x50)`, then `0x2c878` sets defaults, `0x2c618` the viewport):
`+0` pipeline list (0x1039c0), `+4` first node (list linked by node+4), `+8` destination buffer, `+0x10/+0x14` centre (160,100), `+0x18/+0x1c` focal fx,fy (computed per frame), `+0x20` pitch (320), `+0x24` height (200),
`+0x28/+0x2c/+0x30/+0x34` clip xmin,xmax,ymin,ymax, `+0x38` camera node, `+0x3c` fov parameter (42 = 0x2a), `+0x40` ambient shade, `+0x44` near z (0x3000), `+0x48` 0x400000, `+0x4c` flags (1 = keep fx/fy, 2 = keep centre, 4 = use clip size for fov).
focal: `fx = trunc((pitch*32768)*fov*1.220703125e-05) = 5376 = 42*128`, `fy = trunc((height*32768)*fov*1.6276041666666666e-05) = 4480` (the 0.8333 = 200/240 = non square pixel, 4:3 on 320x200).
**node** (0xc8 bytes + data): `+0` handler chain (list of {fn,next}; meshes use 0x104a84), `+4` next node in scene, `+8` prev/link, `+0xc` parent, `+0x10..0x18` position int32, `+0x1c..0x24` world position,
`+0x28` 3x3 double matrix (stride 0x18), `+0x70` world matrix, `+0xb8..0xc0` camera-space position*128 (set per frame by 0x28158), `+0xc4` flags (bit0 disabled, 0x40 ambient+lights apply, 0x80 = light; byte +0xc5: 0x10 env uv),
`+0xc8/+0xcc` light range / peak intensity (for lights; for meshes +0xcc is a depth sort bias), `+0xd0` vertex array, `+0xd4` nverts, `+0xd8` face array, `+0xdc` nfaces, `+0xe0..0xf4` bbox, `+0xf8` radius.
Light example (logo): range 0x226, peak 0x640, position (0,0,0).
**vertex** (0x40 bytes): `+0` next, `+4` flags (bit1 = used this frame, bits16..20 outcodes left/right/top/bottom/near = 0x10000..0x100000), `+8,+0xc,+0x10` x,y,z int32 (int16 sro value * scale), `+0x14,+0x18` screen x,y (1/16 pixel),
`+0x1c` camera z (*128), `+0x20,+0x24` camera x,y >> 11 (used for near clipping), `+0x28/+0x2a` u,v int16 (sro u>>4 unsigned = 0..4095, v = -(sro v>>4)), `+0x2c/+0x2e` second uv, `+0x30` shade int16 (0..0x3e0), `+0x32` second shade, `+0x34..0x3c` vertex normal (length 819 = 0.8*1024).
**face** (0x34 bytes): `+0` next, `+4` sort key, `+8` function pointer, `+0xc` sort list link, `+0x10` material, `+0x14/+0x18/+0x1c` vertex pointers, `+0x20..0x28` normal (length 1024, = (P2-P1)x(P3-P1) truncated), `+0x30` flags
(1 hidden, 2 visible this frame, 0x100 double sided, bits10..12 subdivision, 0x100000 may need near clipping).
**material** (0x44): `+0` texture ptr, `+4` table A (lightmap), `+8` shade table, `+0xc` shade table 2, `+0x18` flag 1 = take uv from the material, `+0x38/+0x3c` u/v masks, `+0x40/+0x41` u/v bits (texture 1<<(ubits+vbits)).
**.sro**: `u32 0x001df020, u32 0x20 (vertex offset), u32 nverts, u32 faceofs, u32 nfaces`, pad to 0x20; vertex 12 bytes `{i16 x,y,z; u16 u,v; u16 0}`; face 8 bytes `{u16 0; u16 i1,i2,i3}`. Loader 0x2cbb0 (+ 0x2c918 face normals, 0x2ca70 vertex normals, 0x2cde8 bbox).
**sprite** (0x28): `+0` type (1 copy, 2 table blit, 3 colour keyed copy, 4 keyed table blit), `+4` 1.0f, `+8` source stride, `+0xc` width, `+0x10` height, `+0x18` data, `+0x20` table, `+0x24` key. Created by 0x31e50(data, stride, height, width, name); drawn by 0x31df0(sprite, x_float, y_float) (x,y truncated).

## Function map (linear addresses)
| addr | function |
|---|---|
| 0x2c878 / 0x2c618 | scene defaults / viewport (pitch,height,clip) |
| 0x2c520 / 0x2c8a8 | init node / init node + identity matrix; 0x2c8dc = set matrix from 3 euler angles (0x305f4) |
| 0x2d154 | link node into scene; 0x2c850 = set face function of every face; 0x2cbb0 sro -> mesh |
| 0x27a78 | **trunc to int**: forces the x87 control word to round-toward-zero (`mov byte [esp+1],0x1f; fldcw; frndint`), used before every `fistp`: every float->int in the engine truncates |
| 0x2d27c | clear viewport; 0x286ac render scene = walks the stage list at 0x1039c0: 0x284e4 setup, 0x282b8 world matrices, 0x280e0 per node chains, 0x28384 radix sort, 0x2813c draw |
| 0x28158 | object camera-space position + matrix `Mcam^T * Mobj` (0x30014) |
| 0x36440 / 0x365b8 / 0x36458 / 0x36f78 | node chain: disabled test / bbox outcodes / back-face cull / transform + face list (0x36fa0 transform, 0x369d4 list+key) |
| 0x36cc4 | env-map uv (flag 0x1000); 0x36ba4 + 0x37508 lighting; 0x36c04 / 0x36dcc / 0x36e9c unused uv generators |
| 0x37e3c / 0x37e91 | mapper prologue (uv override, clip test) / triangle setup (y sort, edge slopes, prestep) shared by all mappers; 0x380e0..0x38990 near-plane clipping (builds S0..S3 at 0x19a408+0x40*i and two temp faces 0x19a53c/0x19a508) |
| 0x30e5c 0x2edb0 0x2e264 0x3269c 0x32dc8 0x332e0 | the six face functions (see below) |
| 0x31df0 / 0x31e50 | sprite dispatch / sprite constructor; 0x31fe8 (1) 0x32174 (2) 0x324ec (3) 0x32324 (4) |
| 0x31793, 0x317d4, 0x31dbc, 0x31dc8 | billboard/flare node: constructor, per frame (projects a point, scales by distance), draw functions (**not ported**) |
| 0x2f510 vec(x,y,z doubles) 0x2fe68 mat copy 0x30070 mat*=mat 0x30014 mat=a*b 0x300e0/0x30150 transpose 0x304ec v=M*v 0x2f540/0x2f55c v+=,-= 0x2f650 dot 0x2f6fc length 0x305f4 euler matrix (0x30270/0x30344/0x30418 = Rx,Ry,Rz right-multiplied) | math library, all doubles |
| 0x2c63c | integer distance between two nodes' local positions |

Which scene uses which face function (counted in the emulator during 40-60 frames): credits: 0x30e5c + sprites(0x31dc8); flower: 0x30e5c, 0x2edb0; flight: 0x2edb0, 0x2e264, 0x30e5c + flares; water: 0x2edb0, 0x3269c;
tunnel2: 0x30e5c, 0x3269c, 0x32dc8, 0x2edb0 (0x332e0 is installed by the code at 0x214ab = nigga scene, not seen in the sampled spans; 0x3269c also at 0x1fabc/0x2150b/0x23b76); logo: 0x30e5c.  Subdivision bits were 0 (affine) in every scene I sampled, perspective-correct code exists and is ported/tested but is unused in the captured spans.
Only `0x36cc4` (env uv) is ever enabled.

## Pixel operations of the face functions (all share setup + gradients; `u,v` = 16.16 texel coordinates masked by the material masks, `s>>16 & 255` = table row)
| mode | fn | per pixel |
|---|---|---|
| GOURAUD | 0x30e5c | `out = shade[(s>>16&255)<<8 \| tex[v..u..]]` |
| TEX | 0x2edb0 | `out = tex[...]` (no shading) |
| GOURAUD2 | 0x2e264 | `a = shade[s1<<8 \| tex]; out = shade2[s2<<8 \| a]` (second shade = vertex +0x32) |
| BLEND | 0x3269c | `out = shade[tex<<8 \| dst]` (a 256x256 table: additive/translucent through the existing pixel) |
| SHADEDST | 0x32dc8 | no texture: `out = shade[s<<8 \| dst]` (gouraud darkening/lightening of what is already there) |
| LIGHTMAP | 0x332e0 | `a = lmap[v2<<8 \| u2]` (second uv set, 8 bits each), `out = shade[a<<8 \| tex]` |

## Rendering pipeline details (verified)
* **Camera space**: `d = Mcam^T (obj - cam)`, `cpos = trunc(128*d)`, `M = Mcam^T * Mobj`. Projection rows: `R0 = M0*(fx/256)*2048`, `R1 = M1*(fy/256)*2048`, `R2 = M2*128`, translation `336*x0, 280*y0, z0` (= 16*fx/256 etc.);
  `zf = R2.p + z0` (stored trunc), `xf = R0.p + tx` (stored `trunc(xf)/2048` toward zero as camera x), screen `sx = trunc(xf*(2/zf) + cx*16)` in 1/16 pixel. Outcodes: sx<xmin*16 ... ; `z < near` => code 0x100000, no projection.
* **Faces**: visible if `n . (campos_local - v0) >= 0` (n = int face normal), unless double sided; vertices of visible faces are transformed; triangles whose three vertices are outside the same viewport side are dropped (outcode AND);
  every kept face gets flag 0x100000; sort key `= trunc(trunc((z1+z2+z3)*(1/3)) - bias)/16`, min 0.  The "no clip" variant 0x36acc (screen-space back-face + max z key) is dead code: 0x37108 `or ah,0x10` forces the clip path.
* **Sort** (0x28384): LSD radix, 3 passes of 8 bits on key (pass 1 uses `key&255 ^ 255`), bucket lists built by head insertion, final concatenation from bucket 255 down to 0 => far to near, ties in a deterministic order that the port reproduces.
* **Lighting** (0x37508): per light within `radius+range`: light position in object space `L = Mobj^T (Lw - Ow)`, per used vertex `D = L - v`, `|D| <= range`, `dot = n.D >= 0`, `q = dot/(|D|*512)`, `I = (peak - |D|*peak/range) * q`, `shade = min(0x3e0, trunc(shade + I))`.
  Vertex shade starts at the scene ambient (0x36ba4, only if node flag 0x40). Table row = shade>>5 (accumulator = shade<<11 so `acc>>16` = shade>>5).
* **Near clipping** (0x380e0): count of vertices with z<near: 3 -> reject; 1 -> quad = (esi, edi, S0=clip(esi,ebx), S3=clip(edi,ebx)) drawn as triangles (S2,S1,S0) and (S1,S0,S3); 2 -> one triangle (S2=esi, S1=clip(esi,edi), S0=clip(esi,ebx)) with vertices sorted by z descending.
  clip parameter `t = (zs-near)*(2^30/(zs-zb))>>18` (12 bit), attributes `(t*b + (4096-t)*a)>>12`, screen position `((t*cx_b>>12)+((4096-t)*cx_a>>12)) * (2^30/(near>>8)) >> 26 + centre*16`.
* **Triangle setup** (0x37e91, verified numerically against the emulator for every gradient): sort by y; edge slopes `dxdy = ((x1-x0)<<12)/dy` (16.12 per 1/16 row; per scanline `<<4` => 16.16); prestep `15-(y&15)`: edges are sampled at the *bottom* of the pixel row; plane gradient of an attribute `a` (12 bit uv/shade words):
  `DAx = ((aC-aA)*p + ((aA-aB)<<16)) * (2^30/wid) >> 26`, `DAy = -(DAx*dxAC>>8 - ((aC-aA)<<8)) * (2^30/dy) >> 22`, `A0 = (DAy*pre - DAx*(xA-16) + ((aA+1)<<16)) >> 4` (64 bit intermediates; wid = signed width of the long edge at the middle vertex in 1/256 px, p = (yB-yA)/dy as 16.16).
  Perspective variant: planes of `1/z` (`2^40/z>>12`) and `attr*(1/z)>>8`, a reciprocal `2^32/(IZ>>4)` per span of `2^(n-1)` pixels, increments re-derived per span (`(end - running)>>n-1`, last span `*(2^30/rem)>>30`).

## Verified asm snippets
1. **The self-modifying inner loop** of 0x30e5c (0x31494..0x314d7). The setup (0x3134c..0x313f8) pokes the per-triangle constants straight into the instruction stream (`0xdeadbabe` placeholders in the file):
```
31496: mov eax, ebx            ; u accumulator
31498: mov edx, esi            ; v accumulator
3149a: sar eax, 0x46           ; imm8 @0x3149c = 24 - ubits  -> integer texel u
3149d: and edx, 0xdeadbabe     ; imm32 @0x3149f = vmask << (24-vbits)
314a3: and eax, 0xdeadbabe     ; imm32 @0x314a4 = umask
314a8: add ebx, 0xdeadbabe     ; imm32 @0x314aa = du per pixel
314ae: sar edx, 0x46           ; imm8 @0x314b0 = 24 - vbits - ubits -> row offset
314b1: add eax, edx
314b3: mov ch, byte [esp+0x66] ; byte 2 of the shade accumulator [esp+0x64] = table row (shade>>5)
314b7: add esi, 0xdeadbabe     ; imm32 @0x314b9 = dv
314bd: mov cl, byte [eax+IMM]  ; imm32 @0x314bf = texture base
314c3: add dword [esp+0x64], IMM ; imm32 @0x314c7 = ds
314cb: mov dl, byte [ecx+IMM]  ; imm32 @0x314cd = shade table base   (cl = texel, ch = row)
314d1: dec ebp / mov [edi], dl / lea edi,[edi+1] / jne 0x31496
```
   Three accumulators, no multiply, 12 instructions per pixel, texture and shade table are *embedded as absolute addresses* (no register pressure). The shifts (`sar` immediates) make the same loop work for any texture size.
2. **Left/right edge selection by patching an opcode** (0x3134c..0x31355 and 0x31418): `mov al,0xeb; cmp ecx,0; jle +2; mov al,0xfb; mov [0x31419],al` rewrites the ModRM byte of `mov edi,ebx` (8b fb) into `mov ebp,ebx` (8b eb), so the per-scanline code never branches on which side the long edge is.
3. **Truncating float->int via the control word** (0x27a78): `fnstcw [esp]; push [esp]; mov byte [esp+1],0x1f; fldcw [esp]; frndint; fldcw [esp+4]` — the engine's `(int)` cast; makes every `fistp` in the code truncate toward zero (hence `Math.trunc` everywhere in the port).
4. **Reciprocal with a 64 bit dividend** (0x315a9..0x315b8): `xor edx,edx; xor eax,eax; mov ecx,[0x88]; inc edx; sar ecx,4; idiv ecx` = `2^32 / (IZ>>4)` (`inc edx` builds the 2^32 dividend); the 1/z per vertex uses `inc dh` = dividend 2^40 (0x30ebd..0x30ec6).
5. **Winograd inner product** in the vertex transform (0x37159..0x37199): `fld [esp+0x50](y); fadd A; fxch; fld x; fadd B; fmulp; fld x; fchs; fmul y; fadd T; faddp ...` computes `(y+A)(x+B) - x*y` = `A*x + B*y + A*B` with 1 multiply instead of 2 for two terms (the A*B is folded into the precomputed translation T, 0x3708d..0x3711e).
6. **Radix depth sort** (0x28384..0x28488): 3 passes of `mov edx,[eax+4]; and edx,0xff; xor edx,0xff; mov ebx,[esp+edx*4]; mov [esp+edx*4],eax; mov [eax+0xc],ebx` (stack allocated 2x256 heads), the `xor 0xff` of pass 1 turns the final bucket walk (255 -> 0) into far-to-near order.

## Fidelity / validation recipe
`$PY tools/mapper_cases.py out.json 30` (30 random triangles per mapper, run by the real code in unicorn) then `node tools/test_mappers.mjs out.json` -> all exact.
For whole scenes: golden frames (`re/golden.py`, K=10) vs `scene.render` in palette-index space (see notes_logo.md for the one-frame lag convention).
