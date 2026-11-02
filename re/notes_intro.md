# Scene 'intro' (0 .. 19.6 s) - reversed

Port: `web/js/scenes/intro.js`. Verified pixel-exact (palette indices) against the golden run for every frame from the 3rd one on (golden --k=10, 560 frames).

## Function map (linear addresses)
| addr | role |
|---|---|
| 0x1f770 | init (called once at program start): allocs, loads `intro/intro.shd` -> [0x10656c], `intro.pal` -> [0x106578] (set as base palette 0x1c364, fade-in 0x78 ticks 0x1c4ac), `intro.raw` -> [0x106558], 'intro lightbuf' = 320*200*2 bytes (0x1f400) -> [0x106564], 'intro light drops' = 0x820 bytes = 130 particles x16 bytes -> [0x106568] (x f32, y f32, energy i32, pad); 'intro pic' = engine quad object [0x106560] (mode 3) wrapping the raw texture. Initial x=rand()%320, y=rand()%200, energy 0. Emitter centre A0=200.0 [0x106548], B0=150.0 [0x106550]; flag [0x106570]=0; live count [0x106574]=0x16 |
| 0x1f8c8 | script start handler: A=0x1f214 (via 0x1caf4), B=0x1f748 (0x1cb04) |
| 0x1f214 | callback A (ISR, once per 285.7 Hz tick, clock [0x1058c8]): Lissajous-like random walk of the emitter centre (A0,B0), rand() re-roll when outside 0..319 / 0..199 |
| 0x1f1a0 | script event @3:00 (after B(4220) = frame 422): flag=1, re-randomise all 130 drops with energy 0x1b58 |
| 0x1f748 | frame function B: 0x1f37c, 0x1f674, 0x31df0 (draw quad), 0x1f6e8, then present (0x1cbec) |
| 0x1f37c | drop update: per live drop 1/20 chance (rand()%20==0) to respawn near the emitter, bounds fixups, deposit energy into the lightbuf |
| 0x1f674 | in-place smoothing of the 16-bit lightbuf |
| 0x31df0 | engine draw of the 320x200 quad = straight copy of intro.raw, colour 0 is transparent (keeps old buffer value, which is always 76 because shd maps index 0 -> 76) |
| 0x1f6e8 | final shade: fb[i] = shd[(clamp(lightbuf[i],0,63)<<8) + fb[i]] |
| 0x1f8dc | stop handler (frees the lightbuf) |

## Algorithm
* **A (per tick t=[0x1058c8])**: `A0 += sin(.02t)*10*4.7 + cos(.0232t) + sin(.0369t)*4.4`; `B0 += cos(.03185t)*12*3.7 + cos(.0277t) + sin(.02433t)*2.6` (constants in the data at 0x10195c..0x1019b4); then if A0>319: A0=rand()%40+30; A0<0: rand()%50+250; B0>199: rand()%20+30; B0<0: rand()%20+160.
* **B drops**: count n=[0x106574] (22; after the 0x1f1a0 event +1 per frame up to 128). For each drop: if rand()%20==0: x=trunc(rand()%90+A0-40), y=trunc(rand()%80+B0-40) (0x27a78 = frndint with RC=truncate), energy=rand()%0x1964+n*100, negated only when rand()==0 (sete/idiv 3 quirk), +(n-22)*30. Then x<0 -> rand()%50+260, y<0 -> rand()%30+160, x>319 -> x=rand()%30+50, y>199 -> **x**=rand()%30+45 (original bug). If 1<=x<319 and 1<=y<199 and distance to (80,80) >= 60: lightbuf[y*320+x] = clamp(+energy, -30000, 30000). So there is a dark disc (r=60) around (80,80), which is never lit directly.
* **Smoothing**: rows 1..197, cols 1..318, in place (left and up already smoothed): `v = (4*c + l + r + u + d) / 8` (idiv, truncating); weights sum to 8 so the light diffuses and is neutral in gain.
* **Shade**: shd is 64 light levels x 256 colours.
* **Time**: one frame = 10 ISR ticks in the golden run; A runs 10x per frame (so the emitter moves at 285 Hz), B once. The original presents with 2 frames of latency; the port uses LAG=2 so it matches the golden captures.
* **rand state**: the intro's rand stream does NOT start at seed 1 for the main loop: the flight init (0x1e948) calls srand(0x45eafc) (0x1e95d) and other scene inits (0x1d9e3.., 0x1eb6a.., 0x1fdad.., 0x23b90..) call rand() 63 more times; the state at A(1) is 4164772783 (0xf83d63af). The initial drop positions (init) do use seed 1.

## Asm snippets
Smoothing (0x1f694): the neighbour at +2 and +0x280 is read as the *high half* of a dword load, avoiding a second movsx:
```
1f694: movsx eax, word [ebx]        ; centre
1f697: lea edx, [eax*4]
1f69e: movsx eax, word [ebx-2]      ; left (already smoothed)
1f6a4: mov edx, dword [ebx]         ; low=centre, high=right
1f6a6: sar edx, 0x10                ; -> right pixel
1f6b4: mov edx, dword [ebx+0x27e]   ; high word = [ebx+0x280] = pixel below
1f6bd: add edx, eax ; 1f6c4: idiv ebp (8)
```
Shade (0x1f715..0x1f72d): index = (clamp(light,0,63)<<8)+pixel, one table lookup per pixel replaces any arithmetic:
```
1f70b: cmp eax,0x3f / jle ; 1f719: shl esi,8 ; 1f71c: mov al,[edx] ; add esi,eax
1f727: mov al,[esi+eax]  ; 1f72d: mov [edx-1],al
```
Truncating float->int helper 0x27a78: `fnstcw; mov byte [esp+1],0x1f; fldcw; frndint; fldcw` (forces RC=truncate, used before every fistp).
