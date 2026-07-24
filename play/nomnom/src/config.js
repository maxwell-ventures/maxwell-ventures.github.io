// ============================================================================
// config.js — all tunable values + palette in ONE place.
// Everything marked TUNE in the spec lives here. Physics is expressed in
// "px per frame" at a 60fps baseline; the loop steps at a fixed 1/60s so the
// feel is identical regardless of the display's refresh rate.
// ============================================================================

export const FPS = 60;
export const FRAME_MS = 1000 / FPS;

// --- Physics (TUNE) — this is the whole game. Get it feeling good. ----------
export const PHYSICS = {
  gravity: 0.42,       // px/frame^2, pulls the mouth down every frame (eased from 0.5 — felt slightly strong)
  flapImpulse: -8,     // px/frame, upward pop on tap (negative = up)
  terminalFall: 12,    // px/frame, max downward speed
  ceilingBounce: 2.5,  // px/frame downward nudge when you kiss the ceiling
};

// --- Layout ----------------------------------------------------------------
export const LAYOUT = {
  heroXRatio: 0.16,    // hero's fixed horizontal position (fraction of width)
  hudBandRatio: 0.18,  // top band reserved for HUD (fraction of height)
  vibeBandRatio: 0.18, // bottom band reserved for the "VIBE" tap pad (thumb rest)
  heroRadius: 23,      // bubble visual radius (px); collision uses this (~10% smaller)
  ceilingPad: 4,       // gap between HUD divider and the soft ceiling
  floorPad: 0,         // floor pad (the lethal floor sits at the VIBE band's top)
  laneGuides: false,   // faint horizontal guides (spec §8.5 toggle) — off for now
};

// --- Run rules -------------------------------------------------------------
export const RULES = {
  lives: 3,
  respawnInvulnFrames: 45, // brief grace after respawn so you don't re-die instantly
  respawnHoldFrames: 42,   // hero hovers this long after a restart before gravity kicks in
  deathAnimFrames: 50,     // death tumble/fall beat before the death card appears
};

// --- Mouth animation (cosmetic) --------------------------------------------
export const CHOMP = {
  cyclesPerSec: 6,     // ~6 chomps/sec per spec
  minOpenDeg: 6,       // mouth wedge half-angle when closed
  maxOpenDeg: 34,      // mouth wedge half-angle when open
};

// --- Token stream (TUNE) ---------------------------------------------------
export const TOKENS = {
  scrollBase: 3,        // px/frame, base stream speed (scales w/ rank later)
  spawnMinFrames: 28,   // random gap between spawns, lower bound (denser than v0)
  spawnMaxFrames: 52,   // upper bound
  spawnPadY: 16,        // keep coins off the exact ceiling/floor
  popTtl: 48,           // frames a "+N" score pop lives
  popRise: 0.7,         // px/frame the pop drifts upward
  emdashChance: 0.12,   // BASE em-dash share (at Intern); rises with rank (TUNE)
};

// --- Value coins (spec §5.1). value on face, color = rarity. ----------------
// `context` is the bar fill per coin — unused until step 5, parked here now.
export const COINS = [
  { name: 'Common',    value: 1,   weight: 48, r: 16, fill: '#3B4250', ring: '#525B6B', text: '#C7CDD6', context: 2 },
  { name: 'Uncommon',  value: 5,   weight: 27, r: 18, fill: '#103A40', ring: '#34C0CE', text: '#8FE6EE', context: 4 },
  { name: 'Rare',      value: 25,  weight: 16, r: 20, fill: '#16304F', ring: '#3679C4', text: '#85B7EB', context: 7 },
  { name: 'Epic',      value: 100, weight: 7,  r: 22, fill: '#3A2356', ring: '#7A5FB8', text: '#AFA9EC', context: 12 },
  { name: 'Legendary', value: 500, weight: 2,  r: 24, fill: '#5A3320', ring: '#D85A30', text: '#F0997B', context: 18 },
];

// --- Context window (spec §4) — the second axis of pressure ----------------
export const CONTEXT = {
  max: 100,
  drainPerFrame: 0.02,   // slow idle decay (~1.2/sec) — a gentle bleed, not a reset
  lowAt: 0.15,           // fraction the "get back to work" pill spans at the low end
  amberAt: 0.60,         // fraction where the bar turns caution-amber
  redAt: 0.85,           // fraction where it turns danger-red (overflow looms)
  compactDrop: 0.40,     // compactor removes this fraction of max (~40%)
  flashFrames: 22,       // collapse-animation length after a compact
};

// --- Compactor token (spec §4.1) — the release valve. A blue hexagon. -------
export const COMPACTOR = {
  // Green + a down arrow + a pulse so it reads as "safe to eat" (drains context).
  r: 21, chance: 0.07, fill: '#1E3A2E', ring: '#5DCAA5', line: '#CFF5E6',
};

// --- All-hands mode (spec §6.2) — the timed frenzy set-piece -----------------
// Strikes at RANDOM, like a surprise all-hands you didn't ask for. A cooldown
// keeps them from stacking, then it's a dice roll each frame.
export const ALLHANDS = {
  minGapFrames: 1200,     // ~20s cooldown after one ends (& at run start) before another can hit
  chancePerFrame: 0.0009, // dice roll once eligible — averages ~one every ~18s of play (TUNE)
  durationFrames: 600,    // ~10s of frenzy
  windDownFrames: 60,     // ~1s ease-out back to normal scroll
  scrollBoost: 0.55,      // +55% scroll at full intensity
  spawnTighten: 0.50,     // spawn gap × this at full intensity (denser stream)
  contextBoost: 0.55,     // +55% context fill at full intensity (the catch)
  baseMult: 2,            // score multiplier starts here
  multStepFrames: 150,    // bumps +1 every ~2.5s survived
  maxMult: 6,             // multiplier cap
  tab: 'ALL-HANDS',
};

// Ticker copy — pure flavor, rotates across the all-hands row (spec §6.2).
export const ALLHANDS_TICKER = [
  'we’re going AI-first',
  'agentic transformation',
  'synergize our AI velocity',
  'every workflow, AI-native',
  'we’re a token-first culture now',
  'lean into the AI tailwind',
  'AI is in our DNA going forward',
];

// --- Em-dash hazard (spec §5.2 / Death Type 3). NOT a coin — a red slab. ----
export const EMDASH = {
  w: 43, h: 23, fill: '#3A1410', ring: '#E24B4A', bar: '#E24B4A',
  penalty: 100, // points lost when eaten (a tax, not a demotion) — TUNE
};

// Em-dash death subtext rotates between these (spec §7, Death 3).
export const EMDASH_SUB = [
  'That punctuation wrote itself. Suspicious.',
  'Flagged by the slop filter. No survivors.',
];

// Context-overflow death copy (spec §7, Death 2).
export const OVERFLOW_COPY = {
  eyebrow: 'CONTEXT OVERFLOW',
  line: 'You took on too much. Classic you.',
  sub: 'Should’ve compacted. Everyone said so.',
};

// --- Palettes (dark = native habitat; light = a nod to the IDE toggle) ------
// Hero coral, zone colors, and coin colors are shared across both modes (spec
// §8.1: "every color must work in both"). `onAccent` is text drawn ON coral —
// kept dark in both so buttons stay legible.
export const THEMES = {
  dark: {
    canvas: '#0F1116',
    hudBand: '#15181F',
    divider: '#2A2E36',
    hero: '#E8654A',          // single hero accent (coral)
    onAccent: '#14171D',      // text on the coral accent
    heroEye: '#14171D',
    textPrimary: '#FAFAF7',
    textSecondary: '#9AA4B2',
    textTertiary: '#5F6B7A',
    laneGuide: 'rgba(255,255,255,0.035)',
    floorWarn: '#E24B4A',     // lethal floor line
    trail: 'rgba(232,101,74,0.18)',
    scrim: 'rgba(15,17,22,0.78)',
  },
  light: {
    canvas: '#F4F3EE',
    hudBand: '#E8E7E0',
    divider: '#CFD1C9',
    hero: '#E8654A',
    onAccent: '#14171D',
    heroEye: '#14171D',
    textPrimary: '#1A1C20',
    textSecondary: '#55606E',
    textTertiary: '#8B94A1',
    laneGuide: 'rgba(0,0,0,0.028)', // subtle to match dark mode's barely-there guides
    floorWarn: '#E24B4A',
    trail: 'rgba(232,101,74,0.22)',
    scrim: 'rgba(244,243,238,0.82)',
  },
};

// Live palette the renderer reads every frame. setTheme() mutates it IN PLACE
// so the swap is instant everywhere without re-wiring imports.
export const COLORS = { ...THEMES.dark };
let _theme = 'dark';
export function setTheme(name) {
  if (!THEMES[name]) return;
  _theme = name;
  Object.assign(COLORS, THEMES[name]);
}
export function getTheme() {
  return _theme;
}

// --- Floor-death rotating snark pool (spec §7, Death 1) --------------------
export const FLOOR_SNARK = [
  { line: 'The work doesn’t stop just because you did.', sub: 'PTO request denied. Back to the lane.' },
  { line: 'Rest is a luxury we’ll circle back on.',       sub: 'Synergy doesn’t sleep.' },
  { line: 'We noticed you stopped delivering.',               sub: 'This will be reflected in your review.' },
  { line: 'Hustle paused. Hustle terminated.',                sub: 'The grind remembers.' },
  { line: 'You touched grass. Fatal.',                        sub: 'Reonboarding required.' },
  { line: 'Work-life balance not found (404).',               sub: 'Returning you to work.' },
  { line: 'Your calendar abhors a vacuum.',                   sub: 'A 5pm Friday sync has been scheduled.' },
  { line: 'You logged off. We logged it.',                    sub: 'Performance plan initiated.' },
];

// Rank ladder — the progression spine + the central joke (spec §6.1).
export const RANKS = ['INTERN', 'ANALYST', 'SENIOR ENG', 'MANAGER', 'DIRECTOR', 'VP', 'C-SUITE'];

// Each rank splits into three sub-levels (Analyst I, Analyst II, Analyst III).
export const SUBLEVELS = ['I', 'II', 'III'];

// Score needed to REACH each MAIN rank (index-aligned with RANKS). TUNE.
export const RANK_THRESHOLDS = [0, 500, 1500, 4000, 10000, 25000, 60000];

// Flatten ranks × sub-levels into 21 ordered levels, each with its own score
// threshold (sub-levels evenly split a rank's score band). C-Suite extends the
// ~2.4x curve past the last named threshold, then stays endless at the top.
function buildLevels() {
  const levels = [];
  for (let i = 0; i < RANKS.length; i++) {
    const start = RANK_THRESHOLDS[i];
    const next = i + 1 < RANKS.length ? RANK_THRESHOLDS[i + 1] : Math.round(start * 2.4);
    const step = (next - start) / SUBLEVELS.length;
    for (let s = 0; s < SUBLEVELS.length; s++) {
      levels.push({
        name: `${RANKS[i]} ${SUBLEVELS[s]}`,
        threshold: Math.round(start + step * s),
        rankIndex: i,
        sub: s,
      });
    }
  }
  return levels;
}
export const LEVELS = buildLevels();

// Difficulty steps up at each MAIN rank increase (Intern III → Analyst I), via
// faster scroll, denser spawns, faster context fill, and more em-dashes.
// Keyed to main rank index (0 = Intern), so sub-levels share a difficulty tier.
export const DIFFICULTY = {
  scrollPerRank: 0.24,        // +24% stream speed per main rank (bigger step-ups)
  spawnTightenPerRank: 0.07,  // spawn gap shrinks 7% per main rank
  minSpawnFrames: 12,         // never spawn faster than this (sanity floor)
  contextPerRank: 0.10,       // coins fill the window +10% per main rank
  emdashPerRank: 0.025,       // +2.5% of spawns become em-dashes per main rank
  emdashMax: 0.30,            // em-dash share never exceeds this
  flashFrames: 54,            // rank-up banner duration (~0.9s, < 1s per spec)
};
