// node tools/render_node.mjs START_SEC NFRAMES STEP_TICKS OUTDIR [sceneId]
// Renders the JS port headlessly (no browser): same Timeline + scenes as web/.  Output: frames.u8 (N*64000 indices), pals.u8 (N*768, 6-bit), meta.json
// Frame i is display tick round(START*285.714)+i*STEP (ticks = 3.5 ms; the original golden captures use STEP=10).  Compare with the original via  python3 tools/cmp.py GOLDEN_DIR OUTDIR
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.join(here, '..', 'web');
const { Dat } = await import(web + '/js/dat.js'); const { Timeline, TICK_HZ } = await import(web + '/js/script.js'); const { FACTORIES } = await import(web + '/js/scenes/index.js');
const [t0, n, step, out] = [+process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const buf = fs.readFileSync(web + '/assets/INSIDE.DAT'); const dat = new Dat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const scenes = {}; for (const [id, f] of Object.entries(FACTORIES)) scenes[id] = f(dat);
const times = JSON.parse(fs.readFileSync(web + '/assets/music_times.json')).times, table = JSON.parse(fs.readFileSync(web + '/assets/script_table.json'));
const tl = new Timeline(times, table, scenes);
fs.mkdirSync(out, { recursive: true });
const fb = new Uint8Array(64000), frames = Buffer.alloc(n * 64000), pals = Buffer.alloc(n * 768), meta = [];
const k0 = Math.round(t0 * TICK_HZ);
for (let i = 0; i < n; i++) {
  const k = k0 + i * step, st = tl.at(k);
  if (st.seg && scenes[st.seg.id] && !st.ended) scenes[st.seg.id].render(fb, st.sceneTick, { events: st.seg.events, seg: st.seg, tick: k, spd: tl.spd(st.seg), dat }); else fb.fill(0);
  frames.set(fb, i * 64000); pals.set(st.pal, i * 768); meta.push({ tick: k, t: k / TICK_HZ, scene: st.seg ? st.seg.id : null, sceneTick: st.sceneTick });
}
fs.writeFileSync(out + '/frames.u8', frames); fs.writeFileSync(out + '/pals.u8', pals); fs.writeFileSync(out + '/meta.json', JSON.stringify(meta));
console.log('rendered', n, 'frames from tick', k0);
