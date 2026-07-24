// ============================================================================
// main.js — host glue: canvas + DPR scaling + resize + the fixed-timestep loop.
// This is the ONLY file allowed to touch the DOM / rAF. It wires input → game
// → renderer. A different host (iOS) would replace just this file.
// ============================================================================

import { FRAME_MS, COLORS, setTheme } from './config.js';
import { Game, State } from './game.js';
import { Renderer } from './renderer.js';
import { bindInput } from './input.js';
import { makeHighScoreStore, loadThemePref, saveThemePref, loadMutePref, saveMutePref } from './storage.js';
import { unlock, setMuted, sfx } from './audio.js';

// Apply a theme and paint the page background to match, so the iOS safe-area
// strips (under the notch / home indicator) blend with the canvas.
function applyTheme(name) {
  setTheme(name);
  document.body.style.background = COLORS.canvas;
}

// Apply saved prefs before the first frame so there's no flash / wrong state.
applyTheme(loadThemePref() || 'dark');
setMuted(loadMutePref());

// Map a coin's face value to its tier step (0=common … 4=legendary).
const TIER_STEP = { 1: 0, 5: 1, 25: 2, 100: 3, 500: 4 };

function playEvent(e) {
  switch (e.type) {
    case 'flap': sfx.flap(); break;
    case 'eat': e.value >= 500 ? sfx.jackpot() : sfx.eat(TIER_STEP[e.value] || 0); break;
    case 'compact': sfx.compact(); break;
    case 'promote': sfx.promote(); break;
    case 'demote': sfx.demote(); break;
    case 'allhands': sfx.allhands(e.duration); break;
    case 'penalty': sfx.death('emdash'); break; // the game-show buzzer, as an "ow"
    case 'death': sfx.death(e.kind); break;
  }
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const game = new Game(makeHighScoreStore());
const renderer = new Renderer(ctx);

// --- Resize: size from the canvas's on-screen box (which the CSS safe-area
// padding has already inset), keeping the backing store crisp on hi-DPI. ------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.round(rect.width) || window.innerWidth;
  const cssH = Math.round(rect.height) || window.innerHeight;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel coordinates

  game.resize({ width: cssW, height: cssH });
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
window.addEventListener('load', resize); // re-measure once safe-area insets resolve
// Track the canvas's true rendered size — fires when iOS safe-area insets
// resolve after launch, so game.world always matches what's on screen.
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
resize();

function applyToggle(hit) {
  if (hit.name === 'theme') { applyTheme(hit.value); saveThemePref(hit.value); }
  else if (hit.name === 'sound') { const m = hit.value === 'off'; setMuted(m); saveMutePref(m); }
}

function handleTap(px, py, rectW, rectH) {
  unlock(); // resume the AudioContext on the user's first gesture
  const pointer = px !== null;

  // Map the tap from the canvas's rendered box into world units. This stays
  // correct even if a resize hasn't yet caught the latest safe-area insets,
  // which otherwise made lower-screen controls (pause toggles) miss on device.
  let x = px, y = py;
  if (pointer && rectW && rectH) {
    x = px * (game.world.width / rectW);
    y = py * (game.world.height / rectH);
  }

  // How-to-play overlay is available on every card (start / pause / game over):
  // any tap dismisses it; the "?" badge opens it.
  const onCard = game.state === State.READY || game.state === State.PAUSED || game.state === State.DEAD;
  if (onCard && renderer.helpOpen) { renderer.helpOpen = false; return; }
  if (onCard && pointer && renderer.hitHelp(x, y)) { renderer.helpOpen = true; return; }

  // Pause screen: only the toggles or the RESUME button act. Stray/missed taps
  // do nothing — so a near-miss on a toggle never accidentally resumes.
  if (game.state === State.PAUSED) {
    if (pointer) {
      const hit = renderer.hitCardToggle(x, y);
      if (hit) { applyToggle(hit); return; }
      if (renderer.hitResume(x, y)) { game.togglePause(); return; }
      return; // ignore taps elsewhere while paused
    }
    game.flap(); // keyboard (Space) resumes
    return;
  }

  // Start screen: a tap on a toggle switches it; anywhere else starts the run.
  if (game.state === State.READY && pointer) {
    const hit = renderer.hitCardToggle(x, y);
    if (hit) { applyToggle(hit); return; }
  }

  // Mid-run: the pause glyph pauses; everything else is a flap.
  if (game.state === State.PLAYING && pointer && renderer.hitPause(game.world, x, y)) {
    game.togglePause();
    return;
  }
  game.flap();
}
bindInput(canvas, handleTap, () => { unlock(); game.togglePause(); });
canvas.focus(); // so Esc/P/Space work without a click first

// --- Fixed-timestep loop ----------------------------------------------------
// Physics steps in exact 1/60s increments (so feel is refresh-rate independent),
// while rendering happens once per animation frame with the real delta for
// smooth cosmetic animation. Accumulator is clamped to avoid spiral-of-death.
let last = performance.now();
let acc = 0;

function frame(now) {
  let dt = now - last;
  last = now;
  if (dt > 250) dt = 250; // tab-switch / GC pause guard

  acc += dt;
  while (acc >= FRAME_MS) {
    game.update();
    acc -= FRAME_MS;
  }

  // Drain semantic events into sound (host concern; core stays audio-agnostic).
  for (const e of game.events) playEvent(e);
  game.events.length = 0;

  renderer.draw(game, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
