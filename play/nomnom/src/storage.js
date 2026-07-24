// ============================================================================
// storage.js — host-side persistence. The ONLY place that knows about
// localStorage. Core logic takes a store with { load, save } and never touches
// the browser directly, so an iOS host can drop in its own implementation.
// ============================================================================

const KEY = 'nomnom.highscore.v1';
const THEME_KEY = 'nomnom.theme.v1';
const MUTE_KEY = 'nomnom.muted.v1';

// Mute preference (host-side). Defaults to false (sound on).
export function loadMutePref() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
export function saveMutePref(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}

// Theme preference (host-side, like the high score). Returns null if unset.
export function loadThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
export function saveThemePref(name) {
  try { localStorage.setItem(THEME_KEY, name); } catch { /* ignore */ }
}

// In-memory fallback — also the safe default for the pure core (spec §2).
export const nullStore = {
  load: () => 0,
  save: () => {},
};

// localStorage-backed high-score store, resilient to private-mode / disabled storage.
export function makeHighScoreStore() {
  try {
    const probe = '__nomnom_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    return nullStore; // storage blocked — degrade silently
  }
  return {
    load() {
      const n = parseInt(localStorage.getItem(KEY), 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
    save(n) {
      try { localStorage.setItem(KEY, String(Math.floor(n))); } catch { /* ignore */ }
    },
  };
}
