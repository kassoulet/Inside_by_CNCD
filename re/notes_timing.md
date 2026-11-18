# Timing: what the code fixes and what it does not (session 2026-11)

**Derived from the code (exact):** the tick ISR (0x1c70c) period is the PIT one-shot `p = elapsed*960/1000/4/2` (0x27e80..0x27e98) with `elapsed` = 2 x PIT clocks per VGA frame; DSMI gets
`floor(p * 2500 * 3.4809245e-6)` units of 1/10000 s per call (0x1d010, called from 0x1c9e7 with `[0x199f00]` = p). At 70.09 Hz: elapsed 34050, p 4086, **35 units = 3.5 ms of music per tick = 285.714 ticks per music second**.
At 60 Hz it would be 41 units (243.9 ticks/s): the ticks-per-music-second figure is a function of the monitor refresh only, not of the CPU.

**Checked under DOSBox-X** (`re/pit_probe.asm`, the demo's measurement loop as a .COM, `dosbox-x.conf`, dummy SDL): elapsed = 34046..34108 (8 runs), i.e. DOSBox-X's emulated 70 Hz retrace + PIT mode 3 give exactly the nominal 35 units.
So the DOSBox-X calibration does NOT explain the 0.25 animation ratio of the reference video.

**ISR cost** (`re/isr_cost.py`, Unicorn, instructions inside 0x1c70c per tick): ~28,000 (intro 29.2k, nigga/twirl start 27.9k, flight 28.4k), about 8 M instr/s at 285.7 Hz = ~9 % of `cycles=fixed 90000`. So plain CPU saturation by the ISR does not explain 0.25 either (the main loop cannot starve the ISR).

**Reference video observations** (`inside-dosbox-x-fixed90000-ref.mp4`, 25 fps, 640 s): the whole demo (182.75 music s) lasts ~3.4x longer than the music; a 15-tick white-flash decay spans ~16 video frames (about one tick per video frame, mean brightness steps of ~14 per frame), which at 25 fps is 0.6 s, whereas 15 ticks at 285.7 Hz is 52 ms. The port currently runs fades/flashes on the music clock (nominal speed) while only the in-scene animation is scaled by `speed`; against the reference video flashes are therefore ~10x too short.

**Status:** the 0.25 default is still an empirical fit (not derived). What is derived: nominal = 1.0 (285.714). Open: why the DOSBox-X run delivers fewer effective ticks (candidates: DOSBox-X video capture time base, PIT mode 0 re-arm latency in the ISR, irq0 coalescing); would need a DOSBox-X debugger log of `[0x1058c4]` against emulated time. Per-frame-state scenes (nigga FRAME_TICKS, flight FT, water x4, intro x2) additionally depend on frames per tick, which is CPU bound and not derivable.
