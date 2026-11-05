# INSIDE (CNCD, 1996) - asm snippets worth reading

All addresses are linear addresses of the unpacked image (`INSIDE.EXE` = PMODE/W stub + Watcom C/C++ 32-bit flat model; the image is dumped at its entry point by
`re/unpack_pmodew.py`). Every listing below was produced with `re/ds.py ADDR N` from `re/mem0.bin` and re-checked against the emulated program
(Unicorn). Watcom register convention: arguments in EAX, EDX, EBX, ECX, then the stack; result in EAX.

The code is a 1996 software 3D engine for a 486/Pentium: no MMX, no SSE, x87 for the geometry, integer 16.16 fixed point for the pixels. The tricks are the
period-typical ones, but a few are unusually clean.

---

## 1. The self-modifying inner loop (0x30e5c, loop at 0x31494..0x314d7)

The gouraud-textured triangle filler cannot afford a single memory operand for per-triangle constants: the setup code (0x3134c..0x313f8) **writes the constants
into the instruction stream** of the loop. The file image contains `0xdeadbabe` placeholders.

```
31496: mov eax, ebx             ; u accumulator
31498: mov edx, esi             ; v accumulator
3149a: sar eax, 0x46            ; imm8  @0x3149c = 24 - ubits          -> integer texel column
3149d: and edx, 0xdeadbabe      ; imm32 @0x3149f = vmask << (24-vbits)
314a3: and eax, 0xdeadbabe      ; imm32 @0x314a4 = umask
314a8: add ebx, 0xdeadbabe      ; imm32 @0x314aa = du per pixel
314ae: sar edx, 0x46            ; imm8  @0x314b0 = 24 - vbits - ubits  -> row offset (already * pitch)
314b1: add eax, edx
314b3: mov ch, byte [esp+0x66]  ; byte 2 of the shade accumulator = table row (shade >> 5)
314b7: add esi, 0xdeadbabe      ; imm32 @0x314b9 = dv
314bd: mov cl, byte [eax+IMM]   ; imm32 @0x314bf = texture base
314c3: add dword [esp+0x64], IMM; imm32 @0x314c7 = ds
314cb: mov dl, byte [ecx+IMM]   ; imm32 @0x314cd = shade table base      (cl = texel, ch = row)
314d1: dec ebp / mov [edi], dl / lea edi,[edi+1] / jne 0x31496
```

Why it is nice:

* **three accumulators, no multiply, 12 instructions per pixel**: u and v are 8.24 numbers; the v accumulator is masked *in place* and shifted by the patched
  `sar`, which lands it already multiplied by the row pitch, so a single `add` produces the texel offset.
* the **texture base and the shade-table base are absolute addresses in the displacement fields**, not registers: the loop has two spare registers.
* the two shift counts and two masks come from the material's `ubits/vbits` ([mat+0x40/0x41]), so one routine serves a 64x64 and a 256x1024 texture.
* the shade is taken with `mov ch, [esp+0x66]` - byte 2 of a 16.16 accumulator, i.e. `shade>>16`, **without any shift**. `cl`=texel, `ch`=row gives the 16-bit
  index `row*256+texel` into a 64x256 shade table for free.

The same pattern is used in all six face functions (0x30e5c gouraud, 0x2edb0 flat texture, 0x2e264 two-level shade/fog, 0x3269c blend, 0x32dc8 shade-the-destination,
0x332e0 light map); `web/js/engine3d.js` reproduces them bit-exactly (180/180 random triangles recorded from the real code, 0 differing pixels).

## 2. Choosing the left or the right edge by patching an opcode (0x3134c, 0x31418)

Triangle setup has to know whether the long edge is on the left or on the right of the middle vertex. The compiler-free answer:

```
3134c: mov al, 0xeb            ; modrm for  mov ebp, ebx   (8b eb)
       cmp ecx, 0
       jle +2
       mov al, 0xfb            ; modrm for  mov edi, ebx   (8b fb)
       mov [0x31419], al       ; rewrite the second byte of the instruction at 0x31418
```

The per-scanline code never tests the orientation: the instruction `mov edi,ebx` / `mov ebp,ebx` was patched once per triangle so that start and end of the span
land in the right registers.

## 3. The truncating float -> int cast (0x27a78)

```
27a78: push eax
       fnstcw [esp]
       push dword [esp]
       mov byte [esp+1], 0x1f         ; round-to-zero control word
       fldcw [esp]
       frndint                        ; the cast
       fldcw [esp+4]                  ; restore
```

Watcom's `__CHP`. The engine calls it before every `fistp`: **all float->int conversions truncate toward zero** (hence `Math.trunc` everywhere in the port). Pay the
`fldcw` twice, but it is the only way to get C semantics from an FPU that rounds to nearest by default. The scenes that matter (water, twirl) depend on it
for bit-exactness: a round-to-nearest port is visibly off by one texel.

## 3b. Reciprocals with a 64-bit dividend built from `inc` (0x315a9, 0x30ebd)

```
315a9: xor edx, edx
       xor eax, eax
       mov ecx, [0x88]
       inc edx                  ; edx:eax = 2^32
       sar ecx, 4
       idiv ecx                 ; 2^32 / (IZ >> 4)  -> 16.16 reciprocal
```

`inc edx` is the shortest way to say "dividend = 2^32"; the per-vertex 1/z for the perspective mapper uses `inc dh` = 2^40. The perspective-correct mapper then
re-derives gradients every 2^(n-1) pixels, where n comes from bits 10..12 of the face flags (the scenes never set them: every captured frame uses the affine loop; the
code is ported and tested anyway).

## 4. Radix depth sort, with a `xor 0xff` that reverses the order (0x28384..0x28488)

Faces are depth-sorted with an LSD radix sort, 3 passes of 8 bits, bucket heads kept on the stack (2x256 dwords):

```
mov edx, [eax+4]        ; key
and edx, 0xff           ; (xor edx,0xff in pass 1)
mov ebx, [esp+edx*4]    ; old head
mov [esp+edx*4], eax    ; push face
mov [eax+0xc], ebx      ; face->next = old head
```

Heads are inserted on top, and the final walk goes from bucket 255 down to 0; the `xor 0xff` of pass 1 flips the least-significant digit so that ties keep a
deterministic order and the final concatenation gives far-to-near. No comparison, no call, O(n), and the port reproduces even the tie order (which matters for
stale-pixel scenes, see the effects write-up).

## 5. The Winograd inner product in the vertex transform (0x37159..0x37199)

```
fld  [esp+0x50]   ; y
fadd A
fxch
fld  x
fadd B
fmulp             ; (y+A)(x+B)
fld  x
fchs
fmul y
fadd T
faddp ...         ; - x*y + T
```

`(y+A)(x+B) - x*y = A*x + B*y + A*B`: two products for the price of one multiply (plus an extra add). The constant `A*B` is folded into the translation `T`,
precomputed per object at 0x3708d..0x3711e. It is the classic Winograd 1968 inner-product trick and it was worth it on a Pentium where `fmul` pairs with `fxch`.

## 6. Branch-free round-toward-zero division by 64 (0x36d10, the environment-map generator)

```
36d10: mov eax, [ebx+0x20]
       mov edx, eax
       sar edx, 0x1f          ; 0 or -1
       shl edx, 6             ; 0 or -64; CF = last bit shifted out = 1 only for -1
       sbb eax, edx           ; eax - edx - CF  = eax + 63 for negatives
       sar eax, 6
```

An arithmetic shift rounds toward -infinity; adding 63 to negative inputs first makes it round toward zero like C's `/ 64`. Here the `shl edx,6` leaves CF
holding the sign, and `sbb` does `- edx - CF` in one instruction.

## 7. The two-buffer water ripple with a *linear* refraction (0x1d234..0x1d2d6)

```
1d26e: movsx ebx, word [edi-2]       ; left
1d272: movsx eax, word [edi+2]       ; right
1d276: movsx edx, word [edi-0x280]   ; up   (a row = 320 shorts = 0x280 bytes)
1d27d: movsx ebp, word [edi+0x280]   ; down
1d284: add eax,edx / add ebx,ebp / add ebx,eax / sar ebx,1     ; (l+r+u+d)/2
1d28c: movsx eax, word [esi] / sub ebx,eax                      ; - old height (esi = the *other* buffer)
1d291: mov eax,ebx / sar eax,4 / sub ebx,eax                    ; damping: v -= v/16
1d298..1d2af: clamp to +-0x3fff
1d2b4: mov [esi], bx                  ; the old buffer becomes the new one, in place
1d2b7: sar ebx,5 / neg ebx
1d2bc: mov al, [ecx+ebx+0x12345678]   ; picture pixel at offset  i - (h>>5)
1d2c3: mov [ecx+0x12345678], al       ; screen pixel i
```

The textbook water-ripple algorithm (`new = neighbours/2 - old`, damped by 1/16), but note three things: the loop patches the source-picture and destination
bases and the loop count into its own immediates (one running index `ecx`, no pointer pairs); the splashes are written into the buffer that is *about to be
overwritten*, so a splash value `s` enters as a negative impulse `-s`; and the **refraction is a one-dimensional offset into the linearised picture**
(`-(h>>5)` bytes, not a 2-D displacement), which looks perfectly right on a 320-wide image because the wave slope is mostly horizontal. 64000 pixels, 16 instructions
each, on a 486.

## 8. The twirl effect: 8 instructions per pixel, free wrap-around (0x26562..0x2659b)

```
26565: movsx edx, word [eax-2]          ; T0 = radius byte (precomputed polar table)
2656b: mov   dx, word [edx*2+0x197868]  ; W[T0]  : 256-entry wobble table, rebuilt per frame
26573: add   dx, word [ecx]             ; + T1   : texture offset (radius<<8 + angle)
26576: movsx ecx, dx                    ; wrap to a signed 16-bit offset
2657f: mov   dl, byte [ecx+edx]         ; edx = texture + 0x8000
```

The whole 320x200 spiral is **precomputed** (a 64000-entry polar table, built once in 0x2629c with r in 0..511 x a in 0..1023). Per frame only 256 words `W[r]` are
recomputed (a few sines per radius), shifting every ring in texture space (rotation = angle byte, zoom = row byte). The texture pointer is biased by +0x8000, so the
16-bit wrap-around of `dx` and the sign extension of `movsx` become **free texture wrapping** with no `and`.

## 9. Reading neighbours as the high half of a dword (0x1f694, intro light smoothing)

```
1f694: movsx eax, word [ebx]       ; centre
1f697: lea   edx, [eax*4]          ; *4
1f69e: movsx eax, word [ebx-2]     ; left (already smoothed)
1f6a4: mov   edx, dword [ebx]      ; low = centre, high = right pixel
1f6a6: sar   edx, 0x10             ; -> right pixel, sign extended
1f6b4: mov   edx, dword [ebx+0x27e]; high word = [ebx+0x280] = the pixel below
...
1f6c4: idiv  ebp                   ; (4c + l + r + u + d) / 8
```

A 16-bit buffer read as 32-bit: the neighbour at +2 is the high half of the load at +0, so a `sar 16` replaces a second `movsx`. The weights sum to 8, so the
light diffuses without changing the total (the smoothing is done in place: left and up neighbours are already filtered, which gives the slightly directional glow
of the "light drops"). The final shade is one table lookup, `fb[i] = shd[(min(light,63)<<8) + fb[i]]` (0x1f715).

## 10. Distance fog written into the vertex shade with one `fsqrt` (0x22622..0x226ab, credits tunnel)

```
22675 fsqrt                                 ; |v|
22677 imul eax, dword [0x107470], 7         ; 7 * ring length
22685 fild dword [esp+0x80]
2268c fsubp st(1)                           ; |v| - 7L
2268e call 0x27a78                          ; truncate
22693 fistp dword [esp+0x7c]
2269d jle 0x226a1 ; 2269f sub edx, eax      ; shade = brightness - excess (only if positive)
226a1 cmp edx, 0x70 ... mov edx, 0x70       ; floor
```

The tube has no lights: each vertex brightness comes from the generated flight-path table, and the fog is the excess distance beyond 7 rings, subtracted from it
before the gouraud rasteriser indexes `tunnel.shd`.

## 11. Seam vertices instead of duplicated geometry (0x232f6..0x2335d)

A cylinder of 12 vertices per ring needs the texture to wrap at u = 4096, but a vertex can only hold one u. The demo does not duplicate the quads' vertices:
it **patches the vertex pointers stored in the faces** (faces 22 and 23 of every ring gap) so they point at 11 extra "seam" vertices (0x106fe8, copies of vertex 0
with u = 4096+5, refreshed per frame by 0x223fc and chained through their `next` field). Zero extra faces, zero extra transforms.

## 12. The splash that came out as a triangle (0x23850..0x238c9, water)

The inner loop counter of the splash writer is initialised from a register that is never reloaded (`mov esi,ebx` at 0x2384f executes once; the outer loop re-enters
at 0x23851 `mov edx,esi`), so the inner loop runs from -3 up to the outer index instead of over a square: a **15-cell wedge** instead of the 5x5 square that was
intended. Values above 32767 become negative via `mov word [ecx], ax` (a hole instead of a bump, 1/300 chance). The port keeps the bug because it is the look of the
original. Similar bug in the intro (0x1f37c): the `y > 199` fixup writes **x** (`x = rand()%30+45`), reproduced too.

## 13. Three beams from one sine (0x202ec..0x20371, temple scene)

```
202ee fadd dword [0x101b28]                 ; w + 256.0
20305 fadd dword [0x101b2c]                 ; w + 320.0
20327 mov word [esi+ebx+0x30], ax           ; pipe 0 vertex shade
20330 fadd dword [0x101b30]                 ; w + 352.0
20371 mov word [esi+0x30], ax               ; pipe 2
```

One `fsin` per vertex; the three beams are the same wave at different offsets, derived on the x87 stack while the previous `fistp` is still pending (the FPU
stack is a 3-register scratch). `w = sin((t+265+53i)/(55+11i+971.1)) * 243.2` also makes the wave slide along the beam.

## 14. The vblank-locked ~280 Hz timer (0x27dad..0x27ecf)

The demo does not trust the DSMI clock. It measures the monitor with the PIT, then arms the PIT as a one-shot at 0.24 frame:

```
27ded: mov edx,0x3da            ; wait for the retrace pulse (bit 3) ...
27df2: in al,dx / and al,8 / jne 27df2     ; leave the current one
27df7: in al,dx / and al,8 / je  27df7     ; wait for the next
27dfc: mov al,0x36 / out 0x43,al / xor al,al / out 0x40,al / out 0x40,al   ; counter 0, mode 3, reload 0
27e15: xor al,al / out 0x43,al             ; latch
27e19: in al,0x40 / mov ah,al / in al,0x40 / xchg ah,al / neg ax   ; elapsed = 2 x PIT clocks per frame
27e80: mov ebx,[0x199f14]  ; 960
27e86: mul ebx / mov ebx,0x3e8 / div ebx   ; x 0.96
27e90: idiv dword [0x199f0c]               ; / 4 callbacks per frame
27e96: shr eax,1                           ; mode 3 counts by 2
27eb2: mov al,0x30 / out 0x43,al / ...     ; one shot
```

The measurement is repeated until two consecutive values agree within 4 counts; the ISR (0x27ecf) re-arms the one-shot and on every 4th interrupt busy-waits for the
next retrace edge so that the 4 callbacks stay locked to vblank (~280 Hz on a 70 Hz mode 13h monitor). DSMI is told `35 x 1/10000 s` per call
(0x1d010: `[0x199f00]*2500*3.4809e-6`) so the music keeps its tempo. **One tick = 3.5 ms of music; 285.714 ticks per second**; the demo script, the palette fades and every
scene clock count these ticks. This is why the JS port can run from the music position alone.

## 15. Float palette fades (0x1c540)

```
1c56e: fld  dword [edx+eax]     ; adder
1c571: fadd dword [ecx+edx]     ; + float copy of the palette
1c574: fstp dword [ecx+edx]
 ... clamp to 0 / 63.0
1c5b1: call 0x27a78 / fistp dword [esp] / mov al,[esp]    ; truncate to a byte
```

`0x1c4ac(f, n)` computes `adder[i] = (base[i]*f - cur[i]) / n` once, the ISR adds it every tick and truncates to the DAC. Flashes, inverted flashes and fade-outs are
all the same routine with different targets. `web/js/fade.js` matches the emulated original to < 1 DAC step on every tick.

**Correction on the tick rate (snippet 14).** 285.714 ticks per music second was derived for a 70 Hz monitor with four tick interrupts per retrace; the demo calibrates its tick from a PIT measurement of the monitor and gives DSMI a tick length computed from it, so the real number of ticks per second of music depends on the machine. A run of the original (reported: DOSBox) shows the in-scene animation at about 0.30-0.35 of the emulated rate. The port keeps the tick-exact scenes and exposes the ratio as the player's *speed* setting (default now 0.25, fitted on a DOSBox-X run: scene cuts follow the 285.7 Hz ticks but the in-scene animation runs at 0.25).
