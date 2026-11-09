# Scene 'twirl' (147.6 s .. 157.5 s): notes

Port: `web/js/scenes/twirl.js`. Verified against the golden run: **pixel-exact (index frames identical, MAE 0.00) for all frames except the ~3 frames around each palette flash** (whole-run MAE with palette 14.7 is dominated by the first 3 start-up frames of the golden capture and by the 4 variant-switch flashes; mid-scene frames are MAE 0.0-1.9). **Flash timing re-checked with `golden.py --k=1` (149.3 s, invert + white flash at 149.526 s): the palette jumps on the same tick in the golden run and in the port, and the fade-out matches tick by tick (19 ticks); the 'flash 10 ticks early' seen with `--k=10` is the harness quantising events to 10-tick frames.** The 'small steady palette difference' (mean |dDAC| 0.49, `nigga` had the same 0.49) was **a port bug in the palette order of operations, now fixed (fade.js + twirl.js)**: (1) the original's 0x26098 calls flash 0x1c498 and base-palette 0x1c364 back to back, and the following table entry 0x1c454 (invert) acts on the NEW base, whereas the port applied the flash/invert at the script entry and the new base one tick later from `basePalette`, so the fade restarted from the already-ticked integer `cur` (float fraction lost: finals 1 DAC step off, and the invert flash was the inverse of the OLD palette); `Fade.setBase` now redoes a flash/invert that is exactly one tick old on the new base. (2) `basePalette` used the 10-tick frame grid `EV` (meant for the picture) so for events 2-4 the base palette changed up to 9 ticks before the flash; it now changes at the script entry tick itself (the 0x26098 events passed in `seg.events`). Result against `golden_tickclock.py 147.5 3000 --k=1` (DAC dumps, all 768 entries, 2962 frames): before 811 differing frames (steady offset 0.49 for ~1.5 s per variant, plus up to 9-tick misplaced jumps), after **59 frames differ, all in the first 1-2 ticks of a flash (the golden fires the script entry 1-2 ticks after the port: one main-loop iteration = 2 ticks at K=1, same effect as the flower flash) or the scene-start catch-up; every steady and fading frame is bit-identical** (mean |dDAC| over all frames 0.13, almost all of it those latency frames; steady segments 0.0). Whole-demo palette diff old vs new fade.js: changes only in 136.6-142.7 s (nigga, same fix, golden-checked: 0.489 -> 0.042 mean, one latency frame left), 149.5-152.0 s and 155.4-157.5 s (twirl); no other scene's palette changes, so logo/intro/water/credits/flower are untouched. The picture (index frames) is untouched by this change.

## Function map (linear addresses)
| addr | role |
|---|---|
| 0x25ea0 | init at program start (not scene start): loads jeesus1.raw/jeesus.pal, allocs 2x0x3e800, fills the 5 parameter sets (floats @0x197c68+32k), builds the tables |
| 0x2629c(160,100) | 'pre-table': polar -> screen inverse map. For r=0..511 (step 0.43) x a=0..1023 (step 2*pi/1024): pixel (160+r cos a, 100+r sin a) (x87 FIST with CW=0x1f7f => truncation) gets word pair (a>>2)-128, (r>>2)-128; later writes win. Then added into the 'twirl table' @[0x197d38] |
| 0x26408 | converts each dword (lo=angle, hi=radius) into word pair T0=(radius&0xff), T1=(radius<<8)+(angle&0xff) = a texture offset around the middle of the 64 KB texture |
| 0x26678 | start handler: loads param set 1, white flash (0x1c498), sets palette, A=0x2620c, B=0x26264 |
| 0x2620c (A) | every ISR tick (285.7 Hz): 4 float32 phase accumulators @0x197d2c/34/50/58 += step (@0x197d0c/1c/20/08) |
| 0x26264 (B) | per frame: 0x265a4 (wobble table W[256]) then 0x2654c (pixel loop) then 0x1cbec/0x1cb14 (flip) |
| 0x265a4 | W[j] = (trunc(sin(acc50 + j*p18)*p10) << 8) + (trunc(acc2c) << 8) + trunc(acc58) + trunc(sin(acc34 + j*p14)*p24)  (16-bit) |
| 0x2654c | for all 64000 pixels: `out = tex2[ int16(T1[i] + W[T0[i]]) ]`, tex2 = texture + 0x8000 (signed 16-bit offset) |
| 0x26098 | the 4 timed events (table entries 30:24, 30:48, 30:12, 31:36): idx++ (mod 5) selects texture/palette (jeesus1, nigga2, nigga4, jeesus2, flight/river + map.pal), parameter set (1+k)%5, white flash, palette with colour 0 forced to black |
| 0x26738 | stop |

Parameter set layout (8 floats s0..s7 -> d18,d20,d10,d08,d0c,d24? ...): d08=s3 (step acc58), d0c=s4 (step acc2c), d10=s2 (amp of sin(b)), d14=s7 (a step per j), d18=s0 (b step per j), d1c=s5 (step acc34), d20=s1 (step acc50), d24=s6 (amp of sin(a)).

## Oddities
* The script table is walked sequentially: entry 30:12 is listed after 30:48 so it fires in the same frame as 30:48 (two events at once, 3 events -> variant 3 directly). `script.js` was patched to clamp entry ticks to a running maximum (table order) and `0x26098` added to FLASHES.
* A runs per ISR tick, B per frame: acc = tick * step exactly (float32 accumulation, reproduced with Math.fround). The picture shown lags one frame (10 ticks) behind the clock; the port renders `t-10`.
* The twirl itself costs nothing per frame: all the geometry (spiral) is a precomputed 64000-entry polar table, the animation is only the 256-entry W table indexed by *radius*, i.e. rings get shifted in texture space (rotation = +/-angle byte, zoom = row byte), so a 320x200 spiral costs one table lookup per pixel.

## asm snippets
`0x26562..0x2659b` (the whole per-pixel loop, 8 instrs): 
```
26565: movsx edx, word [eax-2]        ; T0 = radius byte
2656b: mov   dx, word [edx*2+0x197868]; W[T0]
26573: add   dx, word [ecx]           ; + T1 (texture offset)
26576: movsx ecx, dx                  ; wrap to signed 16 bit
2657f: mov   dl, byte [ecx+edx]       ; edx = tex+0x8000 : signed index into the 64K texture
```
The `tex+0x8000` bias turns the 16-bit wrap-around into free texture wrapping.

`0x27a78` = float->int rounding helper used for *every* conversion: `fnstcw; or cw,0x0f00 (mov byte [esp+1],0x1f); fldcw; frndint; fldcw` i.e. switches the x87 to truncate mode around frndint (Watcom `__CHP` equivalent).

`0x26408`: `xor ch,ch; xor bh,dh; shl edx,8; add edx,ecx` unpacks (angle,radius) into (radius, radius<<8+angle) with byte-register tricks, no shifts of the angle.
