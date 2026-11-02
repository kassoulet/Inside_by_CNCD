# INSIDE (CNCD 1996) port: working contract for scene/engine work

Everything lives in `/home/gautier/SynologyDrive/code/current/demoports/inside/` (call it `$I`). Do NOT touch `../b-hyper` or the original files (INSIDE.EXE/DAT, EYE.*). No git.
Python with unicorn/capstone/numpy/pillow: `PY=/tmp/claude-1000/-home-gautier-SynologyDrive-code-current-demoports/4cd0d7d9-ccbd-4f7d-89a2-6e87b171975d/scratchpad/venv/bin/python`
Scratch dir for temp files: `/tmp/claude-1000/-home-gautier-SynologyDrive-code-current-demoports/4cd0d7d9-ccbd-4f7d-89a2-6e87b171975d/scratchpad` (make your own sub-directory). Node 22 + google-chrome headless exist. No dosbox.

## What the program is
INSIDE.EXE = PMODE/W + Watcom C/C++32 flat model, a custom software 3D engine ("Surrender", Hybrid's SurRender P5 string is only a leftover),
VGA mode 13h (320x200x8, displayed 4:3), one 2.7 MB LZSS-packed archive INSIDE.DAT (96 files; unpacked by `tools/dat.py`; files in `re/assets/<dir>/<file>`,
listing in `re/dat_listing.txt`; JS reader `web/js/dat.js`).  Music EYE.AMF is played by DSMI; the demo is a *script table keyed on AMF order/row*.
Original Watcom register calling convention: args EAX, EDX, EBX, ECX then stack; returns EAX; float args on stack.

### Reversing material (all in `$I/re/`)
* `mem0.bin` : 64 MB guest memory dump taken at the program entry (pristine). Code object ~0x1b000..0x3f000 (linear = file addresses used everywhere), data object at 0x100000..0x1ac000, bss above.  *Linear addresses are used in every tool/doc.*
* `ds.py ADDR [N]` disassemble N instructions at linear ADDR (capstone); `xref.py VALUE` find 32-bit occurrences (pointer xrefs); `script.py` dumps the script table.
* `emu.py` (Unicorn) boots the REAL program (flat model, DOS/VGA stubs); `golden.py` runs it headless and dumps frames: **ground truth**.
  `$PY golden.py START_SEC NFRAMES OUTDIR [every] [--png]` -> OUTDIR/frames.npy (N,200,320) mode-13h indices, pals.npy (N,768) 6-bit DAC, meta.json (t, order,row, tick counters).
  ~15 ms per demo frame.  **Time base (corrected): the tick ISR 0x1c70c runs at ~280 Hz (PIT calibrated on the VGA retrace, 4 interrupts per frame); DSMI is told 35 units of 1/10000 s per call, so TICK_HZ = 285.714 ticks per music second.  golden.py injects K ticks per main-loop iteration (`--k=10` default = 28.6 fps); the original is not frame-locked.  Per-rendered-frame accumulated state in JS steps once per FRAME_TICKS (=10) ticks.**
  START_SEC = the scene trigger time (see table below / `re/script_table.json`); the script table fires all earlier entries at the first frame, so state that depended on *earlier scenes* (e.g. rand() state, leftover buffers) can differ from a full run. For exact state run from 0 (cost ~ real tick count; the whole demo = 9500 frames ~ 2.5 min).
* `emu.py` API: `import emu as E; from emu import *` gives `mu` (Unicorn), `rd(addr,n)`, `wr`, `rd32`, `wr32`, `ireg('EAX')`, `E.at(addr, fn)` = code hook, `E.tick_at(addr,pre)`. Look at golden.py for how a run is driven. You can hook any function to log args, dump memory (e.g. buffers, tables, object structs) or even call functions with your own arguments.
* Key globals: `[0x1058d0]` / `[0x1058cc]` = the two 320x200 8-bit screen buffers (draw buffer / displayed), `[0x1058a4]` current DAC palette, `[0x105890]` base palette, `[0x1058c8]` ticks since the scene started (the clock most scenes use), `[0x1058c4]` global ticks.
  Main loop 0x1ccb4: per iteration `call [0x105888]` (scene frame function B), script 0x1cb3c; the tick ISR 0x1c70c (palette fade 0x1c540, present 0x1c694) runs ~285 times/s; `[0x1058b4]` = scene "A" callback (called from the ISR path 0x1c7b2).
  Scene starters call `0x1caf4(A)` / `0x1cb04(B)`; stop = both 0. `0x1c614(name)` = get file from the unpacked DAT; `0x274d8(size,name)` = tracked malloc; `0x2f4cd` = rand() (Watcom LCG seed*0x41c64e6d+0x3039, >>16 &0x7fff).
  Palette helpers (already ported in `web/js/fade.js`, verified against the original to <1 DAC step): 0x1c364 set base palette, 0x1c4ac fade, 0x1c498 white flash (decays over 15 ticks), 0x1c454 inverted flash (20), 0x1c438 fade to black (40).
* The 3D engine ("Surrender") objects are alloc'd 0xc8 bytes, formats of `.sro` (header u32 0x001df020, 0x20, nverts, faceofs, nfaces ...: reverse the loader), `.lws` (LightWave scene text, only flower/tunnel1.lws), `.raw` 8-bit textures (256x256, 320x200, 512x512), `.shd` shade tables, `.pal` 768-byte 6-bit VGA palettes, `.int/.qnt/.sdw` auxiliary tables.

## Timeline / scenes (script table 0x1032e4, 97 entries; position = AMF order:row; 1 row = 0.0769 s = 22 ticks; entries fire in table order)
| id | start handler @ time | until | notes |
|----|----|----|----|
| intro | 0x1f8c8 @0:00 (0 s); 0x1f1a0 @3:00 (14.77 s) | 3:63 (19.6 s) | 320x200 picture revealed by "light drops"; A=0x1f214 B=0x1f748 init 0x1f770 |
| logo | 0x1f164 @3:63 (19.6 s) A=0x1ee30 B=0x1ef1c | 5:63 (29.5 s) | CNCD logo (logo/obuke.sro, twlogo.raw twirl background, inside.raw/inmask.raw) init 0x1ef9c? |
| credits | 0x233c8 @5:63 (29.5 s) A=0x21f30 B=0x22794 | 11:63 (59 s) | tunnel (credits/*), spikeball (piikkis.sro), names destop/wili/jouni/juliet/yolk&legend sprites (0x21f1c each at 7:00..9:32 + 0x21f10 @9:48) |
| nigga | 0x217bc @11:63 (59 s) A=0x20738 B=0x207a0; events 0x20680 @12:32, 0x21ba0 @13:00, 0x21f00 @13:32 | 14:00 (68.9 s) | sprite + warp-grid + shadow effect, textures nigga/* |
| flower | 0x258c4 @14:00 (68.9 s); toggles 0x25358/0x253f0 (flash) | 19:63 (98.4 s) | flower objects flower/kukka*.sro, tunneli1.sro, tunnel1.lws, jeesus textures |
| flight | 0x1ec28 @19:63 (98.4 s) A=0x1e1f8 B=0x1e8e4 | 23:63 (118 s) | heightfield landscape (flight/map.raw, map.pal, river.raw, fog), ships (ship.sro), sun/lens flares |
| water | 0x23f90 @23:63 (118 s) A=0x23c78 B=0x23d78 | 27:48 (136.6 s) | water/obuke.sro spiral, fish.sro, waterenv/water.raw/.int, 2 frame buffers (init 0x23dec) |
| nigga (2nd) | 0x2185c @27:48 (136.6 s), 0x2171c @29:24, 0x21f00 @29:00, 0x20680 @29:48 | 29:63 (147.6 s) | same engine as nigga, other variants |
| twirl | 0x26678 @29:63 (147.6 s) A=0x2620c B=0x26264; 0x26098 x5 | 31:63 (157.5 s) | flower/jeesus*.raw twirl table warp ('twirl table'/'twirl pre-table' strings) |
| tunnel2 | 0x2061c @31:63 (157.5 s) A=0x2007c B=0x20424 | 36:24 (182.75 s, demo exits) | dark tunnel with flares (credits/smoke.shd, tunnel.int ...) fade out from 35:48 |
Contact sheets of the original: see `re/golden_sheets/*.png` if present, or generate your own.

## JS side (all under `$I/web/`, static, no build, ES modules, runs in node 22 too)
`js/dat.js` (DAT reader: `dat.get('flight/map.raw')` -> Uint8Array, `dat.pal(name)` -> 768 6-bit clamped), `js/fade.js` (palette fades), `js/script.js` (Timeline: script -> segments/ticks/palette), `js/engine.js` (Rand = Watcom rand, Stepper = checkpoint+replay helper for accumulated state), `js/main.js` (player; do not edit), `js/scenes/<id>.js` (**yours**).
**Scene contract** (`web/js/scenes/<id>.js`, default export = factory `make(dat)`):
```js
export default function make(dat) {
  return {
    id: 'intro',
    palette: Uint8Array(768),            // base palette (6-bit VGA values 0..63) applied by the script at the scene start (original: 0x1c364); pre-fade
    basePalette(sceneTick) {},           // optional: return a *new* Uint8Array when the scene itself changes the base palette later (identity change = 0x1c364 call)
    render(fb, sceneTick, rt) {},        // fb: Uint8Array(64000) 320x200 palette indices (NOT cleared between calls); sceneTick: integer ticks (285.714 Hz) since the scene's trigger, first render = 1;
  };                                     // rt = {events:[{tick,fn,t}] scene-local script events, seg, tick: global tick, dat}
}
```
`render` must be a **pure function of sceneTick (and rt.events)**: it can be called for any tick in any order (the player seeks anywhere). State accumulated per tick (particles, rand()) -> use `Stepper` (checkpoint + replay) or closed forms. Time budget ~8 ms/frame in JS, no per-frame allocation, typed arrays only. Palette fades/flashes are NOT done by the scene (script.js/fade.js do them; if you discover a scene handler that also fires a flash add its address to `FLASHES`/`OPS` in script.js with a minimal edit and tell the lead).
`node tools/render_node.mjs START_SEC N STEP_TICKS OUTDIR` renders the JS port headlessly (frames.u8 + pals.u8 + meta.json); `$PY tools/cmp.py GOLDEN_DIR JSDIR [sheet.png]` compares to the original frame by frame (MAE 0..255 on RGB, % pixels off by >8) and writes a golden|js|diff sheet. Browser check: `node tools/browser-test.mjs http://localhost:8765/index.html 5,25 /tmp/shot` (a server on 8765 serves web/).
Frame alignment: a golden frame (meta t = time of what is on screen) corresponds to JS display tick round(t*285.714); render_node STEP should be 10; compare with +-1 frame offsets when judging. The original is NOT frame-rate independent in places; the clock-based scenes read `[0x1058c8]`. Wherever the original accumulates state per *rendered frame* (counters incremented in the frame function), the golden run (1 frame per tick) defines the behaviour; port it as a function of sceneTick.

## What to deliver (your assigned scene(s)/module)
1. `web/js/scenes/<id>.js` (+ helper modules you need, in `web/js/` with a distinct name) passing the contract, as faithful as you can get; report the golden-comparison numbers honestly (MAE, bad%) and list every approximation.
2. `re/notes_<id>.md`: what you reversed - function map with real linear addresses, data formats, algorithm, parameters, timeline of the scene, camera paths, the objects used (names, vertex/face counts, formats), approximations, + **2-4 genuinely interesting asm snippets** (real addresses, disassembled by `ds.py`, verified, with a short explanation of the trick: fixed point, self-modifying code, x87 scheduling, table tricks, ...). These notes feed the final write-ups; be specific and insightful, not generic.
3. If you find a bug/oddity in shared files (script.js etc.), do a minimal fix and mention it in your report.  Keep your final report SHORT (what exists, fidelity numbers, gaps).
Tip: work empirically against the golden frames; extract tables/paths directly from the emulated memory (`mem0.bin` for static data; run the real code for computed data) and embed them as compact JS/JSON data in `web/assets/` or inside your module (cite the source address).
