// ============================================================================
// audio.js — host-side, code-generated arcade SFX via Web Audio. No files, no
// deps (matches the no-asset-pipeline ethos). An iOS host swaps this module out
// like input/storage. Sounds are simple oscillator + envelope blips and noise.
// ============================================================================

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

// Browsers require a user gesture before audio plays — call on first tap/key.
// Safari/iOS additionally need an actual buffer played INSIDE the gesture to
// fully open the audio path, so we ping a 1-sample silent buffer here.
export function unlock() {
  ensure();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  } catch { /* ignore */ }
}

export function setMuted(m) { muted = !!m; }
export function isMuted() { return muted; }

// Diagnostic: current AudioContext state ('uncreated' | 'suspended' | 'running').
export function audioState() { return ctx ? ctx.state : 'uncreated'; }

// Resume and resolve only once actually running, so callers can play sounds
// AFTER the context is live (avoids notes scheduled during the suspend window).
export function resume() {
  ensure();
  if (!ctx) return Promise.resolve();
  if (ctx.state === 'running') return Promise.resolve();
  return ctx.resume().catch(() => {});
}

// Master volume (0..1). Used by the sound-lab; the game leaves it at default.
export function setVolume(v) {
  ensure();
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

// A pitched tone with optional pitch-slide and a quick ADSR-ish envelope.
function tone({ freq = 440, freq2 = freq, type = 'square', dur = 0.12, vol = 0.4, attack = 0.005, release = 0.06, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + 0.01 + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freq2 !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + release + 0.02);
}

// A filtered noise burst — for impacts / death.
function noise({ dur = 0.2, vol = 0.4, filter = 1200, type = 'lowpass', delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + 0.01 + delay;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = filter;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur);
}

// A brass-ish "womp" voice: a sawtooth that bends DOWN in pitch, mellowed by a
// closing lowpass, with a little vibrato — the building block of a sad trombone.
function womp(freqStart, freqEnd, t0, dur, vol = 0.3) {
  if (!ctx || muted) return;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freqStart, t0);
  osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);

  // Lowpass closes as it descends → that mellow, deflating brass tone.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2000, t0);
  lp.frequency.exponentialRampToValueAtTime(700, t0 + dur);

  // Subtle vibrato for a "wah" brass wobble.
  const vib = ctx.createOscillator();
  vib.frequency.value = 6;
  const vibGain = ctx.createGain();
  vibGain.gain.value = 7;
  vib.connect(vibGain);
  vibGain.connect(osc.frequency);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.04);
  g.gain.setValueAtTime(vol, t0 + dur - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(lp);
  lp.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
  vib.start(t0);
  vib.stop(t0 + dur + 0.03);
}

// A harsh game-show "WRONG" buzzer: two detuned low square waves that beat
// against each other for a grating honk.
function buzzer(t0, dur = 0.22, vol = 0.28) {
  if (!ctx || muted) return;
  [130, 137].forEach((f) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.setValueAtTime(vol, t0 + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  });
}

// --- Named SFX (the palette you'll audition / tune) -------------------------
export const sfx = {
  // Soft upward chirp on each flap (kept quiet — it fires often).
  flap: () => tone({ freq: 280, freq2: 480, type: 'sine', dur: 0.05, vol: 0.1, release: 0.03 }),

  // "Nom" — pitch rises with coin tier (0=common … 4=legendary handled below).
  eat: (step = 0) => {
    const base = 430 + step * 80;
    tone({ freq: base, freq2: base * 1.7, type: 'square', dur: 0.05, vol: 0.2, release: 0.05 });
  },

  // Legendary jackpot — quick three-note sparkle.
  jackpot: () => [0, 0.06, 0.12].forEach((d, i) =>
    tone({ freq: 520 + i * 240, type: 'square', dur: 0.08, vol: 0.24, delay: d, release: 0.07 })),

  // Compactor — a satisfying downward "collapse" sweep.
  compact: () => tone({ freq: 760, freq2: 130, type: 'sawtooth', dur: 0.22, vol: 0.28, release: 0.08 }),

  // Promotion — bright ascending arpeggio.
  promote: () => [523, 659, 784, 1047].forEach((f, i) =>
    tone({ freq: f, type: 'triangle', dur: 0.1, vol: 0.26, delay: i * 0.07, release: 0.09 })),

  // Demotion — sad descending arpeggio.
  demote: () => [600, 450, 340, 254].forEach((f, i) =>
    tone({ freq: f, type: 'sawtooth', dur: 0.12, vol: 0.24, delay: i * 0.07, release: 0.06 })),

  // All-hands ambush — a battleship "general quarters" wailing siren: two
  // slightly detuned sawtooths whose pitch is swept up and down by a slow LFO,
  // for that continuous mechanical air-raid wail.
  allhands: (dur = 10) => {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + 0.01;

    // Shared amplitude envelope (winds in, holds for the whole event, winds down).
    const holdEnd = t0 + Math.max(0.4, dur - 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.24, t0 + 0.25); // −20% from 0.3
    g.gain.setValueAtTime(0.24, holdEnd);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(master);

    // Slow wail: an LFO that sweeps the pitch up and down (~0.7 Hz).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.7, t0);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(210, t0); // ±210 Hz swing around the center pitch
    lfo.connect(lfoGain);

    // Two detuned sawtooths beat against each other for a thick siren body.
    [520, 527].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t0);
      lfoGain.connect(o.frequency);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    });
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  },

  // Death sounds, per type:
  //  • em-dash / overflow  → harsh "WRONG" buzzer
  //  • floor (the signature death) → Price-Is-Right losing horn: four descending
  //    brass notes, the last one held and bending down for the big deflate.
  death: (kind = 'floor') => {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + 0.01;
    if (kind === 'emdash' || kind === 'overflow') {
      buzzer(t0);
      return;
    }
    const notes = [
      [440, 415, 0.22], // bwah  (A)
      [392, 370, 0.22], // bwah  (G)
      [349, 330, 0.22], // bah   (F)
      [294, 185, 0.85], // duuum (D → low, the long deflate)
    ];
    let d = 0;
    for (const [f1, f2, dur] of notes) {
      womp(f1, f2, t0 + d, dur, 0.3);
      d += dur * 0.9; // slight legato overlap so it flows like a horn
    }
  },
};
