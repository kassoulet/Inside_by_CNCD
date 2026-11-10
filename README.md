# INSIDE (CNCD, The Gathering 1996) - JavaScript port + reverse engineering

## Run
```
cd web && python3 -m http.server 8000      # http://localhost:8000/  (click / Space to start: sound needs a user gesture)
```
Player: the real 320x200 mode-13h index buffer, stretched to a **4:3** display box (the original's pixels are not square), music `EYE.AMF` through libopenmpt (`web/vendor`),
play/pause, a **seek bar that works anywhere** (the whole demo is a function of the music position: the original's script table is keyed on AMF order/row, and the scenes are pure functions
of the tick, so seeking = set the module position and re-render), scene jump list, fullscreen. Keys: Space, Left/Right (5 s; Shift 1 s; Ctrl 30 s), `,` `.` tick-step when paused, 1-9 scene, Home/End, F, M, P, D.
Write-ups: `web/doc.html?f=WRITEUP-asm.md` and `?f=WRITEUP-effects.md` (the sources are `WRITEUP-asm.md`, `WRITEUP-effects.md` next to this file).

## What is here
* `INSIDE.EXE INSIDE.DAT EYE.AMF ...` originals (untouched).
* `re/` reverse engineering: `unpack_pmodew.py` (PMODE/W loader under Unicorn -> `mem0.bin`, pristine image at the entry point), `emu.py` (boots the real program), `golden.py` (virtual 285.7 Hz clock,
  ground-truth frames), `ds.py`/`xref.py` (disassembly helpers), `script.py` (script table), `notes_*.md` (per-scene notes with function maps and verified snippets), `SCENE_CONTRACT.md`, `dat_listing.txt`, `assets/` (the 96 unpacked files).
* `tools/` `dat.py` (INSIDE.DAT unpacker), `timemap.py`, `cmp.py` (golden vs port), `render_node.mjs`, `test_mappers.mjs` ...
* `web/` the player (ES modules, no build). `js/engine3d.js` = the 3D engine; `js/scenes/*.js` = one module per scene.
* `WRITEUP-asm.md`: 15 verified asm snippets. `WRITEUP-effects.md`: timeline, 3D engine, tricks, objects and scenes.

INSIDE.DAT: `u32 usize` + LZSS (flag byte LSB first; literal = 1; 2-byte match = 12-bit distance, 4-bit length+3); the 2.7 MB result ends with a 96-entry directory (name[0x20], size, offset, pad[2]).

## Faithful vs approximated (honest)
Bit-exact in palette-index space against the original run in the emulator (0 differing pixels): **logo, intro, water, credits (842/843; the 1 other frame is the previous scene's stale page still on screen)**; the six face functions (180/180 recorded triangles).
Bit-exact (palette-index space, 0 differing pixels): **nigga, all four variants** (3 and 4: the lit room box rebuilt with the engine, 140+ frames each; 1 and 2: the warped grid is an engine mesh drawn by the LIGHTMAP face function with float32 phase accumulators, every checked frame exact, was ~96 % of pixels).
Near-exact: **twirl** (except around palette flashes), **flower** (75 % of frames exact, the rest are flash frames), **temple** (bit exact on all frames from the scene start (including its first two palette-flash frames since the start flash is deferred by the script lag; formerly ~10 ticks early) to the end; the 181 s fade-out palette now matches the golden run too, the script poll of this scene runs one frame late; the 1.4 px/frame residue was a depth-sort tie order, fixed).
**Sound.** `EYE.AMF` is a 4-channel module with hard L/R panning; the player renders it with libopenmpt's stereo separation at 50 % (`stereoSeparation` in `web/js/main.js`, 100 = panning exactly as written, 0 = mono) so the voices are not stuck in one speaker.
Bit-exact in palette-index space: **flight** (519/519 golden frames from 98.38 s, 0 differing pixels; engine mappers and sprite code, ship scale 0x1999/65536, camera/ship path re-derived and simulated (rand()-driven, integer positions identical to the emulator over the whole scene); its start state - rand seed and start positions - is a constant captured from the emulator run at 98.38 s, and RGB is exact too: MAE 0.00, the palette matches the DAC on 518 of 519 golden frames; the remaining one is golden frame 0, a capture-start artefact: 580 DAC bytes, max 5, residue of the previous black fade that the golden run did not play from the start).
Data embedded instead of regenerated because they depend on `rand()` history: credits flight path (`creditsdata.js`), flower tunnel shade table, flight height field and flight start state (rand seed), temple flare directions, water seed.
Palette flashes/fades are run by `script.js`/`fade.js`. The "port flashes up to 10 ticks early" seen against `golden.py --k=10` is a harness artefact: with `--k=1` (twirl, `golden_tickclock.py`, DAC dumps) every steady and fading palette frame of the whole scene is bit-identical (all 768 entries) and only the first 1-2 ticks of each flash differ (the golden fires the script entry one main-loop iteration = 1-2 ticks later); in scenes whose frame function spins (flower) the golden music clock advances one frame per loop while ISR ticks advance two, so the flash is delayed in the golden run (use `re/golden_tickclock.py`); there the original's own latency is one frame loop (1-2 ticks), within the port's 1-2 ticks.

Figures and 3D: `figures/` (`tools/make_figures.py`), `web/viewer3d.html` (interactive viewer of the `.sro` meshes, `tools/export_meshes.py`).

**Animation speed.** The player has a *speed* selector (default 0.25, `?speed=0.5` in the URL, remembered in `localStorage`): it scales the animation *inside* the scenes (scene ticks, scene-local events, palette cycling) while the music, scene changes, flashes and fades stay on the music rows. 1.00 is the emulated original's tick rate (285.7 ticks per music second, derived for a 70 Hz monitor with four tick interrupts per retrace, bit-exact per tick); a real run (DOSBox) shows the animation at about 0.30-0.35 of that, so the default was 0.33; a DOSBox-X run (no-sound driver, cycles=max) fits 0.25 sharply, so the default is now 0.25. The demo measures the monitor with the PIT and tells the sound library how long a tick lasts from that measurement, so the number of ticks per second of music depends on the machine it runs on; the golden captures use the 285.7 figure. A per-scene fit on a DOSBox-X run with `dosbox-x.conf` (cycles=fixed 90000; animation phase of the reference video vs port frames, scene length mapped onto the music ticks) gives 0.25 sharply for logo, credits, flower and water (NCC 0.83-0.92 at 0.25 against 0.6-0.84 at 0.20/0.30/0.50); the other scenes (intro, both nigga, flight, twirl, tunnel2) are too static or too state-dependent to fit, so everything uses 0.25 (the earlier x2 for water and tunnel2 is gone).
