import './style.css';
import { DEFAULTS, NO_INPUT, Simulation, STEP } from './game/physics';
import type { Input, Settings } from './game/physics';
import { GameRenderer } from './game/renderer';

const icon = (name: 'bolt' | 'reset' | 'pause' | 'play' | 'sound' | 'muted' | 'sliders' | 'arrow' | 'expand') => {
  const paths = {
    bolt: '<path d="m13 2-8 11h6l-1 9 9-13h-6l2-7Z"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8V4Z"/>',
    sound: '<path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/>',
    muted: '<path d="m11 4-6 5H2v6h3l6 5V4ZM16 9l6 6M22 9l-6 6"/>',
    sliders: '<path d="M4 7h16M4 17h16M9 4v6M15 14v6"/>',
    arrow: '<path d="M5 19 19 5M5 5h14v14"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

type Control = { key: keyof Settings; label: string; min: number; max: number; step: number; unit: string };
const controls: Control[] = [
  { key: 'thrust', label: 'Jet strength', min: 20, max: 44, step: 1, unit: 'm/s²' },
  { key: 'rotationTorque', label: 'Air rotation', min: 2, max: 14, step: 0.5, unit: 'N·m' },
  { key: 'fuelCapacity', label: 'Fuel capacity', min: 0.5, max: 3.5, step: 0.1, unit: 's' },
  { key: 'fuelRegen', label: 'Refill rate', min: 0.2, max: 2, step: 0.1, unit: 's/s' },
  { key: 'wingDrag', label: 'Wing resistance', min: 1, max: 10, step: 0.5, unit: 's⁻¹' },
  { key: 'balance', label: 'Balance assist', min: 0, max: 2, step: 0.1, unit: '×' },
  { key: 'jointStrength', label: 'Joint strength', min: 0.2, max: 2, step: 0.1, unit: '×' },
  { key: 'mass', label: 'Body mass', min: 0.5, max: 2, step: 0.1, unit: '×' },
  { key: 'angularDamping', label: 'Angular damping', min: 0, max: 2, step: 0.05, unit: '' },
  { key: 'friction', label: 'Surface friction', min: 0.1, max: 1.4, step: 0.05, unit: '' },
  { key: 'crashThreshold', label: 'Impact tolerance', min: 2, max: 10, step: 0.5, unit: 'm/s' },
];
const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Play remains available without storage. */ } },
};
function validateSettings(data: unknown): Partial<Settings> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Choose a valid tuning preset.');
  const result: Partial<Settings> = {};
  for (const c of controls) {
    const value = (data as Record<string, unknown>)[c.key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < c.min || value > c.max)
      throw new Error(`${c.label} must be between ${c.min} and ${c.max}.`);
    result[c.key] = value;
  }
  if (!Object.keys(result).length) throw new Error('No physics settings found in this file.');
  return result;
}
let saved: Partial<Settings> = {};
try { const raw = storage.get('jf-settings'); if (raw) saved = validateSettings(JSON.parse(raw)); } catch { /* Ignore invalid old presets. */ }
const sim = new Simulation(saved);
const renderer = new GameRenderer();
const input: Input = { ...NO_INPUT };
let paused = false, debug = false, attempts = 1, best = Number(storage.get('jf-best')) || 0;
let lastTime = 0, accumulator = 0, terminalShown = false, muted = true;
let audio: AudioContext | undefined;
let jetOscillator: OscillatorNode | undefined;
let jetGain: GainNode | undefined;
let lastStun = false, overlayMode = '', displayedBest = -1;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Jetshoes Fairy home"><span class="brand-icon">${icon('bolt')}</span><span>JETSHOES<span class="brand-light">FAIRY</span></span></a>
    <div class="header-right"><span class="build-badge"><i></i> PLAYABLE EXPERIMENT</span><span class="version">VOL. 001</span></div>
  </header>
  <main>
    <section class="intro" aria-labelledby="title">
      <div><p class="eyebrow"><span class="short-line"></span> WELCOME TO THE FLIGHT LAB</p><h1 id="title">Small wings.<br /><em>Big consequences.</em></h1></div>
      <div class="intro-aside"><p>Three controls. Two jet shoes.<br />An unreasonable amount of gravity.</p><button class="text-button" id="help">A quick flight briefing ${icon('arrow')}</button></div>
    </section>
    <div class="workspace">
      <section class="game-card" aria-label="Playable physics prototype">
        <div class="game-toolbar"><div class="course-name"><span class="live-dot"></span> THE FLOATING GARDEN <span class="course-number">/ 01</span></div><div class="tools"><button class="icon-button" id="sound" aria-label="Enable sound" aria-pressed="false" title="Enable sound">${icon('muted')}</button><button class="icon-button" id="debug" aria-label="Show physics overlay" aria-pressed="false" title="Physics overlay (G)">${icon('sliders')}</button><button class="icon-button" id="fullscreen" aria-label="Enter fullscreen" title="Fullscreen">${icon('expand')}</button></div></div>
        <div class="stage" id="stage" tabindex="0" aria-label="Game. A and D or arrows to run and rotate. Hold Space for jets and wings. R to retry.">
          <div class="stage-top"><div class="attempt-chip"><span class="tiny-label">ATTEMPT</span><strong id="attempt">001</strong></div><div class="time-chip"><span class="tiny-label">FLIGHT TIME</span><strong id="timer">00:00.00</strong></div></div>
          <div class="first-hint" id="first-hint"><span class="hint-star">✳</span><div><strong>Find your feet. Then leave the ground.</strong><span>Move with <kbd>←</kbd> <kbd>→</kbd> · Hold <kbd>SPACE</kbd> to fire your jets</span></div></div>
          <div class="stage-bottom"><div class="fuel-hud"><div class="fuel-heading">${icon('bolt')}<span id="fuel-label">JET FUEL</span><span id="fuel-value">100%</span></div><div class="fuel-track"><div id="fuel-fill"></div><span></span><span></span><span></span><span></span></div><p id="movement-state">FEET DOWN. FUEL UP.</p></div><div class="speed-hud"><strong id="speed">0.0</strong><span>m/s</span><span class="air-state" id="air-state">GROUNDED</span></div></div>
          <div class="game-overlay" id="overlay" hidden><div class="overlay-card"><span class="eyebrow" id="overlay-kicker">A LEARNING EXPERIENCE</span><h2 id="overlay-title">Gravity: 1. Fairy: 0.</h2><p id="overlay-copy">A little less thrust. A little more faith.</p><button class="primary-button" id="overlay-retry">${icon('reset')} One more try <kbd>R</kbd></button></div></div>
          <div class="touch-controls" aria-label="Touch game controls"><div><button data-input="left" aria-label="Run left or rotate counterclockwise">←</button><button data-input="right" aria-label="Run right or rotate clockwise">→</button></div><button data-input="action" aria-label="Hold for jet thrust or wings">${icon('bolt')}</button></div>
          <p class="loading" id="loading">Growing wings<span>Preparing the flight lab…</span></p>
        </div>
        <div class="game-bottom-bar"><span class="status-light"></span><span id="status-text">Ready when you are</span><div class="game-actions"><button id="pause" class="small-button">${icon('pause')} Pause</button><button id="restart" class="small-button">${icon('reset')} Retry <kbd>R</kbd></button></div></div>
      </section>
      <aside class="side-panel">
        <div class="panel-tabs" role="tablist" aria-label="Flight lab panels"><button role="tab" aria-selected="true" aria-controls="controls-panel" id="controls-tab" tabindex="0">Flight manual</button><button role="tab" aria-selected="false" aria-controls="tuning-panel" id="tuning-tab" tabindex="-1">${icon('sliders')} Tuning lab</button></div>
        <div id="controls-panel" role="tabpanel" aria-labelledby="controls-tab" class="panel-content">
          <span class="eyebrow">A FAIRY WITH A LEARNING CURVE</span><h2>Easy to learn.<br /><em>Hard to land.</em></h2>
          <div class="control-row"><div class="key-pair"><kbd data-key="left">←</kbd><kbd data-key="right">→</kbd></div><div><strong>Run & rotate</strong><p>On the ground, find your stride.<br />In the air, find your angle.</p></div></div>
          <div class="control-row"><kbd class="space-key" data-key="action">SPACE</kbd><div><strong>Thrust & float</strong><p>Hold to fire both jets. Out of fuel?<br />Keep holding to open your wings.</p></div></div>
          <div class="control-row"><div class="key-pair"><kbd>R</kbd></div><div><strong>Try. Tumble. Repeat.</strong><p>An instant fresh start.<br />The platforms reset, too.</p></div></div>
          <div class="field-note"><span>↳ FIELD NOTE 001</span><p>Your shoes push in the direction<br />your body points. <em>Mind the angle.</em></p></div>
          <div class="personal-best"><span>YOUR BEST FLIGHT</span><strong id="best">— <small>make it to the flag</small></strong></div>
        </div>
        <div id="tuning-panel" role="tabpanel" aria-labelledby="tuning-tab" class="panel-content tuning-content" hidden>
          <span class="eyebrow">MAKE A LITTLE ADJUSTMENT</span><h2>Find your <em>feel.</em></h2><p class="tuning-note">Changes apply live. Mass, fuel and joint settings carry into your next attempt.</p>
          <label class="select-label" for="preset">FLIGHT PRESET</label><select id="preset"><option value="original">Original fairy</option><option value="training">Training wings</option><option value="chaos">A little more chaos</option><option value="custom">Custom tuning</option></select>
          <div class="sliders">${controls.map(c => `<div class="slider-control"><label for="setting-${c.key}">${c.label}</label><output id="value-${c.key}" for="setting-${c.key}"></output><input type="range" id="setting-${c.key}" data-setting="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}" /></div>`).join('')}</div>
          <label class="debug-label"><input id="debug-check" type="checkbox" /> Show bodies, joints & contacts <kbd>G</kbd></label>
          <div class="preset-actions"><button id="export" class="small-button">Export preset ↗</button><button id="import" class="small-button">Import preset ↙</button></div><button id="defaults" class="text-button">Restore original physics ↺</button><input id="import-file" type="file" accept="application/json,.json" hidden />
        </div>
      </aside>
    </div>
    <section class="course-strip" aria-label="Course progress"><div class="strip-heading"><span class="tiny-label">THE OBJECTIVE</span><strong>Get there. In one piece.</strong></div><div class="route"><div class="route-line"><span id="route-progress"></span></div><span class="route-stop"><i></i>01 <span>Leave the ground</span></span><span class="route-stop"><i></i>02 <span>Stick the landing</span></span><span class="route-stop"><i></i>03 <span>Find your balance</span></span><span class="route-stop"><i>⚑</i> <span>Make it home</span></span></div><div class="distance"><strong id="distance">0.0</strong><span>METERS FLOWN</span></div></section>
    <footer><span>THREE CONTROLS. <span class="footer-star">✳</span> ENDLESS WAYS TO FALL.</span><span>A physics playground. A work in progress. <span class="footer-version">v0.1</span></span></footer>
  </main>
  <dialog id="briefing"><button class="dialog-close icon-button" aria-label="Close flight briefing">×</button><span class="eyebrow">PRE-FLIGHT BRIEFING</span><h2>Gravity is a<br /><em>tough teacher.</em></h2><p>You’re a tiny fairy with two jet shoes and very little room for error. Reach the flag at the end of the floating garden.</p><ol><li><strong>Find your stride.</strong> A / D or ← / → run on supporting feet and rotate your body in the air.</li><li><strong>Use short bursts.</strong> Hold Space to thrust along your body’s angle. Land on your feet and release thrust to refuel.</li><li><strong>Save the landing.</strong> When fuel runs out, hold Space to spread your wings and brake gradually. Release to freefall. Once wings open, release before firing refilled jets.</li><li><strong>Keep trying.</strong> R resets the entire course instantly. P pauses. G reveals the physics underneath.</li></ol><p class="dialog-note">Awkward doesn’t always mean over. A foot catch, a tumble, even an upside-down landing might be recoverable.</p><button class="primary-button" id="briefing-close">Let’s find out ${icon('arrow')}</button></dialog>
  <div class="toast" id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const fmt = (seconds: number) => {
  const centis = Math.floor(seconds * 100);
  return `${Math.floor(centis / 6000).toString().padStart(2, '0')}:${Math.floor(centis / 100 % 60).toString().padStart(2, '0')}.${(centis % 100).toString().padStart(2, '0')}`;
};
let toastTimeout = 0;
function toast(message: string) {
  $('toast').textContent = message; $('toast').hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function clearInput() { Object.assign(input, NO_INPUT); pressed.clear(); touchPointers.clear(); updateKeys(); }
function updateKeys() {
  document.querySelectorAll<HTMLElement>('[data-key]').forEach(el => el.classList.toggle('pressed', input[el.dataset.key as keyof Input]));
  document.querySelectorAll<HTMLElement>('[data-input]').forEach(el => el.classList.toggle('pressed', input[el.dataset.input as keyof Input]));
}
function updateSliders() {
  for (const c of controls) {
    $<HTMLInputElement>(`setting-${c.key}`).value = String(sim.settings[c.key]);
    $(`value-${c.key}`).textContent = `${Number(sim.settings[c.key].toFixed(2))} ${c.unit}`;
  }
}
function saveSettings() { storage.set('jf-settings', JSON.stringify(sim.settings)); }
updateSliders();
if (Object.keys(saved).length) $<HTMLSelectElement>('preset').value = 'custom';

function reset() {
  sim.reset(); renderer.resetCamera(); accumulator = 0; terminalShown = false;
  attempts++; $('attempt').textContent = String(attempts).padStart(3, '0');
  clearInput(); setPaused(false); stage.focus({ preventScroll: true });
}
function setPaused(value: boolean) {
  paused = value; accumulator = 0; clearInput();
  $('pause').innerHTML = `${icon(paused ? 'play' : 'pause')} ${paused ? 'Resume' : 'Pause'}`;
  $('pause').setAttribute('aria-pressed', String(paused));
}
function setDebug(value: boolean) {
  debug = value; renderer.debug = value;
  $('debug').setAttribute('aria-pressed', String(value));
  $<HTMLInputElement>('debug-check').checked = value;
}

const pressed = new Set<string>();
const keyMap: Record<string, keyof Input> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'action' };
function refreshKeyboardInput() {
  for (const action of ['left', 'right', 'action'] as const) input[action] = [...pressed].some(code => keyMap[code] === action) || [...touchPointers.values()].includes(action);
  updateKeys();
}
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).closest('input, select, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (keyMap[e.code]) {
    e.preventDefault();
    if (paused || sim.state === 'fallen' || sim.state === 'finished') return;
    pressed.add(e.code); refreshKeyboardInput();
    if (!muted) void audio?.resume();
  }
  if (e.repeat) return;
  if (e.code === 'KeyR') { e.preventDefault(); reset(); }
  if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); setPaused(!paused); }
  if (e.code === 'KeyG') setDebug(!debug);
});
window.addEventListener('keyup', e => {
  if (keyMap[e.code]) { pressed.delete(e.code); refreshKeyboardInput(); }
});
window.addEventListener('blur', () => { if (sim.state === 'running') setPaused(true); else clearInput(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

const touchPointers = new Map<number, keyof Input>();
document.querySelectorAll<HTMLButtonElement>('[data-input]').forEach(button => {
  button.addEventListener('pointerdown', e => {
    e.preventDefault(); if (paused) return;
    button.setPointerCapture(e.pointerId);
    touchPointers.set(e.pointerId, button.dataset.input as keyof Input); refreshKeyboardInput();
  });
  const release = (e: PointerEvent) => { touchPointers.delete(e.pointerId); refreshKeyboardInput(); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});

$('restart').onclick = reset; $('overlay-retry').onclick = reset;
$('pause').onclick = () => { setPaused(!paused); stage.focus({ preventScroll: true }); };
$('debug').onclick = () => setDebug(!debug);
$('debug-check').onchange = () => setDebug($<HTMLInputElement>('debug-check').checked);
$('fullscreen').onclick = async () => {
  try { if (!document.fullscreenElement) await stage.requestFullscreen(); else await document.exitFullscreen(); }
  catch { toast('Fullscreen isn’t available here. You can still play in this window.'); }
};
$('sound').onclick = async () => {
  muted = !muted;
  if (!muted) {
    try {
      audio ??= new AudioContext(); await audio.resume();
      if (!jetOscillator) {
        jetOscillator = audio.createOscillator(); jetGain = audio.createGain();
        jetOscillator.type = 'sawtooth'; jetOscillator.frequency.value = 70;
        jetGain.gain.value = 0; jetOscillator.connect(jetGain); jetGain.connect(audio.destination); jetOscillator.start();
      }
    } catch { muted = true; toast('Sound isn’t available in this browser.'); }
  }
  $('sound').innerHTML = icon(muted ? 'muted' : 'sound');
  $('sound').setAttribute('aria-pressed', String(!muted));
  $('sound').setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
};
function tab(tuning: boolean) {
  $('controls-panel').hidden = tuning; $('tuning-panel').hidden = !tuning;
  for (const [id, selected] of [['controls-tab', !tuning], ['tuning-tab', tuning]] as const) {
    $(id).setAttribute('aria-selected', String(selected)); $(id).tabIndex = selected ? 0 : -1;
  }
}
$('controls-tab').onclick = () => tab(false); $('tuning-tab').onclick = () => tab(true);
for (const id of ['controls-tab', 'tuning-tab']) $(id).addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const tuning = id !== 'tuning-tab'; tab(tuning); $(tuning ? 'tuning-tab' : 'controls-tab').focus(); }
});
const briefing = $<HTMLDialogElement>('briefing');
$('help').onclick = () => { setPaused(true); briefing.showModal(); };
briefing.querySelector<HTMLButtonElement>('.dialog-close')!.onclick = () => briefing.close();
$('briefing-close').onclick = () => briefing.close();
briefing.addEventListener('close', () => { setPaused(false); stage.focus({ preventScroll: true }); });
briefing.addEventListener('click', e => { if (e.target === briefing) { const r = briefing.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) briefing.close(); } });

for (const c of controls) $<HTMLInputElement>(`setting-${c.key}`).oninput = e => {
  sim.updateSettings({ [c.key]: Number((e.target as HTMLInputElement).value) });
  updateSliders(); saveSettings(); $<HTMLSelectElement>('preset').value = 'custom';
};
$<HTMLSelectElement>('preset').onchange = e => {
  const preset = (e.target as HTMLSelectElement).value;
  if (preset === 'custom') return;
  const next = preset === 'training' ? { ...DEFAULTS, rotationTorque: 5, wingDrag: 7, balance: 1.5, jointStrength: 1.3, fuelCapacity: 2.3 }
    : preset === 'chaos' ? { ...DEFAULTS, rotationTorque: 10, balance: 0.5, jointStrength: 0.65, thrust: 35 } : { ...DEFAULTS };
  sim.updateSettings(next); updateSliders(); saveSettings(); toast('Preset applied. Retry for a fresh launch.');
};
$('defaults').onclick = () => {
  sim.updateSettings(DEFAULTS); updateSliders(); saveSettings(); $<HTMLSelectElement>('preset').value = 'original'; toast('Original fairy physics restored.');
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'jetshoes-fairy-tuning-v1', settings: sim.settings }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'fairy-tuning.json'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Tuning preset exported. Share it with a fellow fairy.');
};
$('import').onclick = () => $<HTMLInputElement>('import-file').click();
$<HTMLInputElement>('import-file').onchange = async e => {
  const picker = e.target as HTMLInputElement;
  try {
    const file = picker.files?.[0]; if (!file) return;
    if (file.size > 100_000) throw new Error('That file is too large for a tuning preset.');
    const data = JSON.parse(await file.text());
    const settings = validateSettings(data.settings ?? data);
    sim.updateSettings(settings); updateSliders(); saveSettings(); $<HTMLSelectElement>('preset').value = 'custom'; toast('Tuning preset imported.');
  } catch (err) { toast(err instanceof Error ? err.message : 'Could not import this preset.'); }
  finally { picker.value = ''; }
};

function updateHUD() {
  const s = sim.snapshot();
  $('timer').textContent = fmt(s.elapsed);
  $('fuel-value').textContent = `${Math.round(s.fuel * 100)}%`;
  $('fuel-fill').style.width = `${s.fuel * 100}%`;
  $('fuel-fill').classList.toggle('low', s.fuel < 0.25);
  $('fuel-label').textContent = s.wings ? 'WINGS DEPLOYED' : 'JET FUEL';
  $('speed').textContent = Math.hypot(s.vx, s.vy).toFixed(1);
  const mode = s.tumbling ? 'TUMBLING' : s.jets ? 'THRUSTING' : s.wings ? 'WING BRAKING' : s.grounded ? 'GROUNDED' : 'FREEFALL';
  $('air-state').textContent = mode;
  $('movement-state').textContent = s.jets ? 'LITTLE BURSTS. BIG DIFFERENCE.' : s.wings ? 'TAKE THE SLOW WAY DOWN.' : s.grounded ? 'FEET DOWN. FUEL UP.' : s.tumbling ? 'THERE’S STILL A CHANCE.' : 'GRAVITY HAS THE WHEEL.';
  $('route-progress').style.width = `${s.progress * 100}%`;
  $('distance').textContent = s.maxDistance.toFixed(1);
  document.querySelectorAll('.route-stop').forEach((el, i) => el.classList.toggle('reached', s.progress >= [0, 0.28, 0.52, 1][i]));
  $('first-hint').hidden = s.state !== 'ready' || paused;
  $('status-text').textContent = paused ? 'Taking a breather' : s.state === 'ready' ? 'Ready when you are' : s.state === 'finished' ? 'A little fairy. A very good flight.' : s.state === 'fallen' ? 'A good excuse for one more try' : 'Flight in progress';
  if ((s.state === 'fallen' || s.state === 'finished') && !terminalShown) {
    terminalShown = true;
    if (s.state === 'finished' && (!best || s.elapsed < best)) { best = s.elapsed; storage.set('jf-best', String(best)); }
    $('overlay-kicker').textContent = s.state === 'finished' ? 'YOU MADE IT HOME' : 'A LEARNING EXPERIENCE';
    $('overlay-title').textContent = s.state === 'finished' ? 'Small wings. Big win.' : 'Gravity: 1. Fairy: 0.';
    $('overlay-copy').textContent = s.state === 'finished' ? `${fmt(s.elapsed)} · Same fairy. A little more skill.` : `${s.maxDistance.toFixed(1)} meters of valuable flight research.`;
  }
  if (best !== displayedBest) {
    $('best').innerHTML = best ? `${fmt(best)} <small>personal best</small>` : '— <small>make it to the flag</small>';
    displayedBest = best;
  }
  const nextOverlayMode = paused ? 'paused' : terminalShown ? s.state : 'none';
  $('overlay').hidden = nextOverlayMode === 'none';
  if (nextOverlayMode !== overlayMode && paused) {
    $('overlay-kicker').textContent = 'TAKE YOUR TIME'; $('overlay-title').textContent = 'A little breathing room.';
    $('overlay-copy').textContent = 'Your fairy will be right here. Press P to resume.';
    $('overlay-retry').innerHTML = `${icon('play')} Back to the flight <kbd>P</kbd>`;
    $('overlay-retry').onclick = () => { setPaused(false); terminalShown = false; stage.focus({ preventScroll: true }); };
  } else if (nextOverlayMode !== overlayMode) {
    if (terminalShown) {
      $('overlay-kicker').textContent = s.state === 'finished' ? 'YOU MADE IT HOME' : 'A LEARNING EXPERIENCE';
      $('overlay-title').textContent = s.state === 'finished' ? 'Small wings. Big win.' : 'Gravity: 1. Fairy: 0.';
      $('overlay-copy').textContent = s.state === 'finished' ? `${fmt(s.elapsed)} · Same fairy. A little more skill.` : `${s.maxDistance.toFixed(1)} meters of valuable flight research.`;
    }
    $('overlay-retry').innerHTML = `${icon('reset')} One more try <kbd>R</kbd>`; $('overlay-retry').onclick = reset;
  }
  overlayMode = nextOverlayMode;
  if (jetGain && audio) {
    jetGain.gain.setTargetAtTime(!muted && !paused && s.jets ? 0.025 : 0, audio.currentTime, 0.05);
    jetOscillator?.frequency.setTargetAtTime(65 + s.fuel * 40, audio.currentTime, 0.1);
    if (s.tumbling && !lastStun && !muted) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.setValueAtTime(170, audio.currentTime); osc.frequency.exponentialRampToValueAtTime(45, audio.currentTime + 0.15);
      gain.gain.setValueAtTime(0.055, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
      osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + 0.17);
    }
  }
  lastStun = s.tumbling;
}

function frame(time: number) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
  lastTime = time;
  if (!paused) {
    accumulator += dt;
    while (accumulator >= STEP) { sim.step(input); accumulator -= STEP; }
  }
  renderer.render(sim, paused ? 0 : dt); updateHUD();
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    await renderer.init(stage); $('loading').remove(); requestAnimationFrame(frame);
    stage.addEventListener('pointerdown', e => { if (e.target === renderer.app.canvas) stage.focus({ preventScroll: true }); });
    if (import.meta.env.DEV) {
      // Deliberate development-only instrumentation for reproducible physics experiments.
      Object.assign(window, { __FAIRY__: { sim, input, renderer, reset, setPaused, snapshot: () => sim.snapshot() } });
    }
  } catch (err) {
    $('loading').textContent = 'The flight lab couldn’t start. Enable WebGL, then refresh to try again.';
    console.error(err);
  }
}
void boot();
