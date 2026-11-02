# Core reversing notes (loader, container, timer, script, palette) - lead's own findings

All addresses are linear (see `ds.py`). Every listing below was produced with `python3 re/ds.py ADDR N` from the pristine entry-point dump `mem0.bin`.

## Container format of INSIDE.DAT (loader 0x1c0e8, lookup 0x1c22c, LZSS 0x1d1c0)
`u32 usize` + LZSS stream (flag byte LSB-first, 1 = literal; 0 = 2-byte match `b0 | (b1&0xf0)<<4` = distance, `(b1&15)+3` = length). The unpacked 2,721,868 bytes
end with a 96-entry directory of 0x30 bytes `{char name[0x20]; u32 size; u32 offset; u32 pad[2]}` and a final `u32 count`. Lookup = linear strcmp, first match wins
(3x `temple/putki.sro`, 2x `flower/kukka1.sro` are duplicates the demo can never reach). The whole file is read with fread(4) + fread(size-4) and decompressed
in one go at start-up (that is why start-up takes a while on a slow disk).

## Timer: a PIT interrupt phase-locked to the VGA vertical retrace (0x27d48 / 0x27dad / 0x27ecf)
The demo does not use the DSMI timer for its clock: 0x27dad measures the monitor refresh with the PIT (counter 0 in mode 3 counts down by 2), waiting on bit 3 of port 0x3da,
repeating until two measurements agree within 4 counts, then arms the PIT in mode 0 (one-shot, `out 0x43,0x30`) with `period = measured*960/1000/4/2` = 0.24 frame; the ISR 0x27ecf re-arms it,
and every 4th interrupt busy-waits for the next retrace edge and restarts the counter, so that 4 callbacks (0x1c70c) per frame stay locked to vblank: ~280 Hz on a 70 Hz mode 13h monitor.
DSMI is then told 35 time units (1/10000 s) per call (0x1d010: `[0x199f00]*2500*3.4809e-6`, truncated) so the music keeps its tempo:
**1 tick = 3.5 ms of music time, 285.714 ticks per music second**; palette fades and the scene clocks `[0x1058c8]` count these ticks. The demo is not frame-locked: frames take what they take,
animation is a function of ticks.
```
27ded: mov edx,0x3da          ; wait for the retrace pulse (bit 3) ...
27df2: in al,dx / and al,8 / jne 27df2      ;   leave the current one
27df7: in al,dx / and al,8 / je  27df7      ;   wait for the next
27dfc: mov al,0x36 / out 0x43,al / xor al,al / out 0x40,al / out 0x40,al   ; counter 0, mode 3, reload 0 : start counting
 ...  (same wait again)
27e15: xor al,al / out 0x43,al           ; latch
27e19: in al,0x40 / mov ah,al / in al,0x40 / xchg ah,al / neg ax   ; elapsed = 65536-counter = 2 x PIT clocks per frame
27e80: mov ebx,[0x199f14]  ; 960
27e86: mul ebx / mov ebx,0x3e8 / div ebx      ; x0.96
27e90: idiv dword [0x199f0c]                  ; / 4 callbacks per frame
27e96: shr eax,1                              ; mode 3 counted by 2
27eb2: mov al,0x30 / out 0x43,al / mov al,bl / out 0x40,al / mov al,bh / out 0x40,al  ; one-shot, interval = 0.24 frame
```
(verified against the disassembly; the arithmetic gives 4085 clocks = 3.42 ms at 70.086 Hz).

## Script / scene sequencing (0x1cb3c, table 0x1032e4)
`(order<<6)+row` of the DSMI player (`[0x103a5d]`, `[0x103a61]`) is compared with each 12-byte entry `{order,row,handler}` of a 97-entry table; the handler runs once when the music
position reaches it (all due entries in one loop, see 0x1ccd5). Handlers are tiny: scene start = `0x1caf4(A)` + `0x1cb04(B)` (callbacks run from the tick ISR path and the main loop),
stop = both 0 then free the scene memory (0x276fc); `0x1c498` white flash, `0x1c454` inverted flash, `0x1c438` fade to black. The last entry (36:24) is followed by a null handler, which sets the exit flag.
So the whole demo timeline = the AMF song position; `web/js/script.js` carries the table.

## Palette fades (0x1c364 / 0x1c3ec / 0x1c454 / 0x1c4ac / 0x1c540), float32 arithmetic
`0x1c4ac(f, n)`: adder[i] = (base[i]*f - cur[i]) / n stored as float32 (`fild; fmul; fsub; fmul 1/n; fstp dword`); every tick `0x1c540` does `fcur += adder`, clamps to [0, 63.0]
and truncates (`call 0x27a78` = `frndint` with control word 0x1f00, round toward zero) into the byte palette that is then written to the DAC with `out 0x3c9`.
`web/js/fade.js` is a straight port and matches the emulated original to < 1 DAC step on every tick over the first 36 s.
```
1c56e: fld dword [edx+eax]      ; adder
1c571: fadd dword [ecx+edx]     ; + float copy of the palette
1c574: fstp dword [ecx+edx]
 ... clamp to 0 / 63.0 (const at 0x1010e0)
1c5b1: call 0x27a78 / fistp dword [esp] / mov al,[esp]   ; truncate to byte
```
