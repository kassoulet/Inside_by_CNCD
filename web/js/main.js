import { ChiptuneJsPlayer } from '../vendor/chiptune3.js';
import { loadDat } from './dat.js';
import { Timeline, TICK_HZ } from './script.js';
import { FACTORIES } from './scenes/index.js';

const $ = id => document.getElementById(id);
const canvas = $('screen'), g = canvas.getContext('2d'), img = g.createImageData(320, 200), px = new Uint32Array(img.data.buffer);
const fb = new Uint8Array(64000), lut = new Uint32Array(256);
let dat, tl, scenes = {}, T_END = 182.75, ac = null, cp = null, ready = null, amf = null;
let playing = false, tBase = 0, cBase = 0, tPaused = 0, lastTick = -1, lastKey = '', dbg = false, errShown = {};

const SPEEDS = [1, 0.7, 0.5, 0.35, 0.33, 0.3, 0.25];
let speed = +(new URLSearchParams(location.search).get('speed') || localStorage.getItem('inside-speed3') || 0.25);
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60); return m + ':' + (t % 60).toFixed(1).padStart(4, '0'); };
const nowT = () => playing ? Math.min(T_END, tBase + (ac.currentTime - cBase)) : tPaused;

function pal2lut(p) { for (let i = 0; i < 256; i++) { const r = p[i * 3], gg = p[i * 3 + 1], b = p[i * 3 + 2]; lut[i] = 0xff000000 | ((b << 2 | b >> 4) << 16) | ((gg << 2 | gg >> 4) << 8) | (r << 2 | r >> 4); } }

function draw(tick, force) {
  const st = tl.at(tick);
  if (st.seg && scenes[st.seg.id]) {
    try { scenes[st.seg.id].render(fb, st.sceneTick, { events: st.seg.events, seg: st.seg, tick: Math.floor(tick * tl.spd(st.seg)), spd: tl.spd(st.seg), dat }); }
    catch (e) { if (!errShown[st.seg.id]) { errShown[st.seg.id] = 1; console.error(e); $('status').textContent = 'scene ' + st.seg.id + ' error: ' + e.message; } }
  } else fb.fill(0);
  if (st.ended) fb.fill(0);
  pal2lut(st.pal);
  for (let i = 0; i < 64000; i++) px[i] = lut[fb[i]];
  g.putImageData(img, 0, 0);
  $('scene').textContent = st.ended ? 'end' : st.seg ? st.seg.id : '';
  if (dbg) $('msg').textContent = 'tick ' + tick + '  scene ' + (st.seg ? st.seg.id : '-') + ' +' + st.sceneTick + '\nt=' + (tick / TICK_HZ).toFixed(2) + 's';
  else if ($('msg').textContent) $('msg').textContent = '';
}

async function init() {
  $('status').textContent = 'loading INSIDE.DAT ...';
  dat = await loadDat('assets/INSIDE.DAT');
  for (const [id, f] of Object.entries(FACTORIES)) scenes[id] = f(dat);
  const [times, table] = await Promise.all([fetch('assets/music_times.json').then(r => r.json()), fetch('assets/script_table.json').then(r => r.json())]);
  tl = new Timeline(times.times, table, scenes);
  tl.setSpeed(speed);
  { const sp = $('speed'); for (const v of SPEEDS) { const o = document.createElement('option'); o.value = v; o.textContent = (v === 1 ? 'speed 1.00 (emulated 285.7 ticks/s)' : 'speed ' + v.toFixed(2)); sp.appendChild(o); } sp.value = SPEEDS.includes(speed) ? speed : 0.25;
    sp.onchange = () => { speed = +sp.value; try { localStorage.setItem('inside-speed3', speed); } catch (e) {} tl.setSpeed(speed); lastTick = -1; draw(Math.floor(nowT() * TICK_HZ), true); sp.blur(); }; }
  T_END = tl.endTick / TICK_HZ;
  $('tend').textContent = fmt(T_END);
  const jump = $('jump'); jump.innerHTML = '<option value="">scene...</option>';
  tl.segs.forEach((s, i) => { const o = document.createElement('option'); o.value = s.start / TICK_HZ; o.textContent = (i + 1) + '. ' + s.id + ' (' + fmt(s.start / TICK_HZ) + ')'; jump.appendChild(o); });
  $('status').textContent = 'ready: ' + dat.entries.length + ' files unpacked from INSIDE.DAT, ' + tl.segs.length + ' scene segments, ' + tl.entries.length + ' script entries.';
  draw(0, true); frame();
}

async function initAudio() {
  if (ac) return;
  ac = new AudioContext();
  // EYE.AMF is a 4-channel Amiga-style module with hard L/R panning; full stereo separation (100)
  // puts each voice in one speaker only. libopenmpt's stereo separation render param (percent,
  // 0 = mono .. 100 = panning as written, up to 200 = extra wide) pulls the channels together.
  cp = new ChiptuneJsPlayer({ context: ac, repeatCount: 0, interpolationFilter: 8, stereoSeparation: 50 });
  cp.gain.connect(ac.destination);
  ready = new Promise(r => cp.onInitialized(r));
  cp.onProgress(m => { if (playing && Math.abs(m.pos - nowT()) > 0.15 && m.pos < T_END + 5) { tBase = m.pos; cBase = ac.currentTime; } });   // resync clock to the worklet
  cp.onEnded(() => { });
  amf = await (await fetch('assets/EYE.AMF')).arrayBuffer();
  await ready;
  setVol();
}
let started = false;   // AMF loaded into the worklet
async function play(from) {
  await initAudio();
  await ac.resume();
  const t = from ?? tPaused;
  if (!started) { cp.play(amf.slice(0)); started = true; await new Promise(r => { cp.onMetadata(r); setTimeout(r, 800); }); }
  else cp.unpause();
  if (t > 0.01) cp.setPos(t);
  tBase = t; cBase = ac.currentTime; playing = true; ui();
}
function pause() { if (!playing) return; tPaused = nowT(); playing = false; if (cp) cp.pause(); ui(); }
function toggle() { playing ? pause() : (tPaused >= T_END - 0.05 ? play(0) : play()); }
function seek(t) {
  t = Math.max(0, Math.min(T_END - 0.02, t));
  if (playing) { tBase = t; cBase = ac.currentTime; } else tPaused = t;
  if (cp && started) cp.setPos(t);
  lastTick = -1; draw(Math.floor(t * TICK_HZ), true);
}
function ui() { $('play').innerHTML = playing ? '&#10073;&#10073;' : '&#9654;'; $('big').hidden = playing || tPaused > 0.05; $('big').setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
function setVol() { const v = $('vol').value / 100; if (cp) cp.setVol(muted ? 0 : v * v); }
let muted = false;

function frame() {
  const t = nowT(), tick = Math.floor(t * TICK_HZ);
  if (tick !== lastTick) { lastTick = tick; draw(tick); }
  if (!seeking) $('seek').value = Math.round(t / T_END * 1000);
  $('tcur').textContent = fmt(t);
  if (playing && t >= T_END - 1e-3) { tPaused = T_END; playing = false; if (cp) cp.pause(); ui(); }
  requestAnimationFrame(frame);
}
let seeking = false;
$('seek').addEventListener('input', e => { seeking = true; seek(e.target.value / 1000 * T_END); });
$('seek').addEventListener('change', () => { seeking = false; });
$('play').onclick = toggle; $('big').onclick = () => play(0);
$('mute').onclick = () => { muted = !muted; $('mute').innerHTML = muted ? '&#128263;' : '&#128266;'; setVol(); };
$('vol').oninput = setVol;
$('jump').onchange = e => { if (e.target.value !== '') seek(+e.target.value); e.target.value = ''; e.target.blur(); };
$('fs').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else $('stage').requestFullscreen(); };
canvas.addEventListener('dblclick', () => $('fs').click());
$('stage').addEventListener('click', e => { if (e.target === canvas) toggle(); });
addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.altKey || e.metaKey) return;
  const t = nowT(), k = e.key;
  const step = e.shiftKey ? 1 : e.ctrlKey ? 30 : 5;
  if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); seek(t - step); }
  else if (k === 'ArrowRight') { e.preventDefault(); seek(t + step); }
  else if (k === 'Home') seek(0); else if (k === 'End') seek(T_END - 0.5);
  else if (k === ',' ) { if (!playing) seek(t - 1 / TICK_HZ); } else if (k === '.') { if (!playing) seek(t + 1 / TICK_HZ); }
  else if (k === 'f' || k === 'F') $('fs').click();
  else if (k === 'm' || k === 'M') $('mute').click();
  else if (k === 'd' || k === 'D') { dbg = !dbg; lastTick = -1; }
  else if (k === 'c' || k === 'C') $('crt').click();
  else if (k === 'p' || k === 'P') canvas.classList.toggle('smooth');
  else if (k >= '1' && k <= '9') { const s = tl.segs[+k - 1]; if (s) seek(s.start / TICK_HZ); }
});
// CRT scanlines: display only. The overlay period must be a whole number k of device pixels per source row
// (k = floor(available device px / 200)), so the canvas is sized to k*200 device px high (4:3) while on.
const SRC_ROWS = 200;
let crtOn = false; try { crtOn = localStorage.getItem('inside-crt') === '1'; } catch (e) {}
function layoutCrt() {
  const st = $('stage'), sc = $('scan'), dpr = devicePixelRatio || 1;
  const k = Math.floor(Math.min(st.clientHeight, st.clientWidth * 3 / 4) * dpr / SRC_ROWS);
  const ok = k >= 2;
  $('crt').checked = crtOn; $('crt').disabled = !ok; $('crtl').classList.toggle('off', !ok);
  $('crtl').title = ok ? 'CRT scanlines (C)' : 'CRT scanlines unavailable: window too small (needs at least 2 device pixels per source row)';
  const on = crtOn && ok, hDev = k * SRC_ROWS, wDev = Math.round(hDev * 4 / 3);
  // box snapped to whole device pixels (else bands land on half pixels); the overlay is laid out in device px
  // and scaled by 1/dpr, so its k-px tiles stay exact (fractional CSS tile sizes drift: Chrome rounds to 1/64 px).
  const r = st.getBoundingClientRect(), L = on ? Math.round((r.left + (r.width - wDev / dpr) / 2) * dpr) / dpr - r.left : 0, T = on ? Math.round((r.top + (r.height - hDev / dpr) / 2) * dpr) / dpr - r.top : 0;
  canvas.style.cssText = on ? `position:absolute;left:${L}px;top:${T}px;width:${wDev / dpr}px;height:${hDev / dpr}px` : '';
  sc.hidden = !on; sc.style.cssText = on ? `inset:auto;margin:0;left:${L}px;top:${T}px;width:${wDev}px;height:${hDev}px;transform:scale(${1 / dpr});transform-origin:0 0;background-size:100% 100%,100% ${k}px` : '';
}
$('crt').onchange = e => { crtOn = e.target.checked; try { localStorage.setItem('inside-crt', crtOn ? '1' : '0'); } catch (er) {} layoutCrt(); e.target.blur(); };
addEventListener('resize', layoutCrt); document.addEventListener('fullscreenchange', layoutCrt);
(function watchDpr() { const m = matchMedia('(resolution:' + devicePixelRatio + 'dppx)'); m.addEventListener('change', () => { layoutCrt(); watchDpr(); }, { once: true }); })();
layoutCrt();
init().catch(e => { $('status').textContent = 'init failed: ' + e.message; console.error(e); });
window.__inside = { seek, play, pause, nowT, get tl() { return tl; }, get scenes() { return scenes; }, draw, fb };
