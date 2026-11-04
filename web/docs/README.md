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
Bit-exact in palette-index space against the original run in the emulator (0 differing pixels): **logo, intro, water, credits (839/841)**; the six face functions (180/180 recorded triangles).
Bit-exact (palette-index space, 0 differing pixels over 140+ frames each): **nigga variants 3 and 4** (the lit room box rebuilt with the engine: per-triangle material uv, camera drift, light and shadow quad closed forms).
Near-exact: **twirl** (except around palette flashes), **flower** (75 % of frames exact, the rest are flash frames), **temple** (sub-pixel rounding on one billboard), nigga variants 1-2 (~96 % of pixels).
Approximated: **flight** (mean RGB error ~12/255: ships' env normals recomputed, span rounding, camera/ship path from an emulator-recorded table).
Data embedded instead of regenerated because they depend on `rand()` history: credits flight path (`creditsdata.js`), flower tunnel shade table, flight height field/paths, temple flare directions, water seed.
Palette flashes/fades are run by `script.js`/`fade.js` and can be 1-2 frames off the golden run (the golden harness quantises events to 10-tick frames).

Figures and 3D: `figures/` (`tools/make_figures.py`), `web/viewer3d.html` (interactive viewer of the `.sro` meshes, `tools/export_meshes.py`).
