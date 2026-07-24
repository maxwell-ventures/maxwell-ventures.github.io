// ============================================================================
// game.js — CORE LOGIC ONLY. No canvas, no DOM, no storage, no requestAnimationFrame.
// This is the portable heart: it advances state one fixed 60fps frame at a time.
// The renderer reads from it; input drives it through flap(). Keeping it pure
// is what makes the future iOS port trivial (spec §2).
// ============================================================================

import {
  FPS, PHYSICS, LAYOUT, RULES, TOKENS, COINS, EMDASH, EMDASH_SUB,
  CONTEXT, COMPACTOR, OVERFLOW_COPY, FLOOR_SNARK,
  LEVELS, DIFFICULTY, ALLHANDS,
} from './config.js';
import { nullStore } from './storage.js';

const COIN_WEIGHT_TOTAL = COINS.reduce((s, c) => s + c.weight, 0);

export const State = Object.freeze({
  READY: 'ready',     // pre-run: "tap to begin"
  PLAYING: 'playing',
  PAUSED: 'paused',   // sim frozen, pause card up
  DYING: 'dying',     // death animation playing; no input, then → DEAD
  DEAD: 'dead',       // death card up, waiting for a tap to get back to it
});

export const DeathType = Object.freeze({
  FLOOR: 'floor',       // Death Type 1 — the burnout joke
  OVERFLOW: 'overflow', // Death Type 2 — the overload joke
  EMDASH: 'emdash',     // Death Type 3 — the AI-slop house rule (instant death)
});

export class Game {
  constructor(store = nullStore) {
    // Logical world bounds, set by resize(). Until then, harmless defaults.
    this.world = { width: 360, height: 640, heroX: 80, ceilingY: 120, floorY: 640 };

    this._store = store;
    this.highScore = store.load();
    this._runStartBest = this.highScore; // best coming into the current run

    this.state = State.READY;
    this.lives = RULES.lives;
    this.score = 0;
    this.levelIndex = 0;   // INTERN I — index into LEVELS

    this.hero = { y: 0, vy: 0 };
    this.invuln = 0;
    this.respawnHold = 0;  // frames the hero hovers after a restart before falling
    this.death = null;     // { type, line, sub }
    this.dyingFrames = 0;  // frames into the death animation (DYING state)

    this.tokens = [];      // active coins in the stream: { x, y, r, value, tier }
    this.pops = [];        // transient "+N" score feedback: { x, y, value, color, ttl }
    this.events = [];      // semantic events for the host (audio/haptics) to drain
    this._spawnTimer = 0;  // frames until the next spawn

    this.context = 0;        // 0..CONTEXT.max — the context-window fill
    this.compactFlash = 0;   // frames of collapse animation after a compact
    this.rankFlash = 0;       // frames of promotion/demotion banner remaining
    this.rankFlashName = '';  // which rank the banner announces
    this.rankFlashDemote = false; // true = DEMOTED (red), false = PROMOTED (coral)

    this.allHands = false;       // frenzy event active?
    this.allHandsTimer = 0;      // frames remaining in the event
    this.allHandsMult = ALLHANDS.baseMult; // current score multiplier (ticks up)
    this._multTimer = 0;         // frames until the next multiplier bump
    this._allHandsCooldown = ALLHANDS.minGapFrames; // frames until one can randomly hit

    this._snarkBag = [];   // shuffled bag so snark doesn't repeat back-to-back
  }

  // --- Geometry --------------------------------------------------------------
  // Called on init and every resize. The core works in whatever pixel space the
  // host hands it, so it never assumes a screen size.
  resize({ width, height }) {
    const hudH = height * LAYOUT.hudBandRatio;
    const vibeH = height * LAYOUT.vibeBandRatio;
    this.world = {
      width,
      height,
      heroX: width * LAYOUT.heroXRatio,
      ceilingY: hudH + LAYOUT.ceilingPad + LAYOUT.heroRadius,
      floorY: height - vibeH - LAYOUT.floorPad, // lethal floor = top of the VIBE band
      vibeTop: height - vibeH,                   // VIBE tap pad spans [vibeTop, height]
    };
    // Keep the hero on-screen through a resize.
    this.hero.y = this._clampForSpawn(this.hero.y || this._spawnY());
  }

  _spawnY() {
    return (this.world.ceilingY + this.world.floorY) / 2;
  }

  _clampForSpawn(y) {
    const lo = this.world.ceilingY;
    const hi = this.world.floorY - LAYOUT.heroRadius;
    return Math.max(lo, Math.min(hi, y));
  }

  // Main rank index (0 = Intern) — drives difficulty; shared across sub-levels.
  get rankIndex() {
    return LEVELS[this.levelIndex].rankIndex;
  }

  // Full level label for the HUD / cards, e.g. "ANALYST II".
  get rank() {
    return LEVELS[this.levelIndex].name;
  }

  // 0→1 progress through the death animation, for the renderer to read.
  get dyingProgress() {
    return Math.min(1, this.dyingFrames / RULES.deathAnimFrames);
  }

  // Em-dash share rises with main rank (more hazards the higher you climb).
  get emdashChance() {
    return Math.min(DIFFICULTY.emdashMax,
      TOKENS.emdashChance + this.rankIndex * DIFFICULTY.emdashPerRank);
  }

  // --- Input: the entire control surface ------------------------------------
  flap() {
    switch (this.state) {
      case State.READY:
        this._beginRun();
        this.hero.vy = PHYSICS.flapImpulse; // first tap also pops you up
        this.events.push({ type: 'flap' });
        break;
      case State.PLAYING:
        this.respawnHold = 0; // a tap during the post-restart hover takes control
        this.hero.vy = PHYSICS.flapImpulse;
        this.events.push({ type: 'flap' });
        break;
      case State.PAUSED:
        this.state = State.PLAYING; // a tap resumes (no flap) — mobile's way out
        this.respawnHold = RULES.respawnHoldFrames; // hover a beat before gravity
        break;
      case State.DEAD:
        this._getBackToIt();
        break;
    }
  }

  // Esc / P / the RESUME button toggles pause — only meaningful mid-run.
  togglePause() {
    if (this.state === State.PLAYING) {
      this.state = State.PAUSED;
    } else if (this.state === State.PAUSED) {
      this.state = State.PLAYING;
      this.respawnHold = RULES.respawnHoldFrames; // same hover beat as a restart
    }
  }

  _beginRun() {
    this.lives = RULES.lives;
    this.score = 0;
    this._runStartBest = this.highScore; // snapshot best so we can flag a new record
    this.levelIndex = 0;
    this.death = null;
    this.hero.y = this._spawnY();
    this.hero.vy = 0;
    this.invuln = 0;
    this.tokens = [];
    this.pops = [];
    this._spawnTimer = TOKENS.spawnMinFrames;
    this.context = 0;
    this.compactFlash = 0;
    this.rankFlash = 0;
    this.rankFlashName = '';
    this.rankFlashDemote = false;
    this.respawnHold = 0; // initial start: the "TAP TO FLY" impulse pops you up
    this._endAllHands(); // also arms the cooldown so it can't fire instantly
    this.state = State.PLAYING;
  }

  // Tap on a death card: spend the life and get back into the lane, or — if the
  // run is out of lives — start a fresh run.
  _getBackToIt() {
    if (this.lives > 0) {
      this.hero.y = this._spawnY();
      this.hero.vy = 0;
      this.invuln = RULES.respawnInvulnFrames;
      this.death = null;
      this.tokens = []; // clear the lane so you don't respawn into a coin
      this.context = 0; // fresh window on respawn
      this.compactFlash = 0;
      this._endAllHands();
      this.state = State.PLAYING;
    } else {
      this._beginRun();
    }
    // Give the player a beat to orient: the hero hovers before gravity kicks in.
    this.respawnHold = RULES.respawnHoldFrames;
  }

  // --- Simulation: advance exactly one 60fps frame ---------------------------
  update() {
    if (this.state === State.DYING) { this._updateDying(); return; }
    if (this.state !== State.PLAYING) return;
    // Post-restart hover: hold the hero still for a beat so the player can react.
    if (this.respawnHold > 0) { this.respawnHold--; this.hero.vy = 0; return; }
    if (this.invuln > 0) this.invuln--;

    const h = this.hero;
    const w = this.world;

    // Gravity, capped at terminal velocity. Resting is impossible by design.
    h.vy = Math.min(h.vy + PHYSICS.gravity, PHYSICS.terminalFall);
    h.y += h.vy;

    // Ceiling = soft. Kiss it and get nudged back down. Non-lethal.
    if (h.y < w.ceilingY) {
      h.y = w.ceilingY;
      if (h.vy < PHYSICS.ceilingBounce) h.vy = PHYSICS.ceilingBounce;
    }

    // Context window drains slowly on its own — you're never truly safe at rest.
    if (this.context > 0) this.context = Math.max(0, this.context - CONTEXT.drainPerFrame);
    if (this.compactFlash > 0) this.compactFlash--;
    if (this.rankFlash > 0) this.rankFlash--;

    this._updateAllHands();
    this._updateTokens();
    if (this.state !== State.PLAYING) return; // a token may have just killed us
    this._checkPromotion();
    this._updatePops();

    // Overflow (Death Type 2). Filling past the max demotes you a grade — or
    // kills if you're already at the bottom.
    if (this.context > CONTEXT.max) {
      if (this.levelIndex <= 0) {
        this.context = CONTEXT.max;
        this._die(DeathType.OVERFLOW);
        return;
      }
      this._hazard(DeathType.OVERFLOW);
    }

    // Floor = death. Lethal from frame one (spec §3.2). Grace only on respawn.
    if (h.y + LAYOUT.heroRadius >= w.floorY) {
      h.y = w.floorY - LAYOUT.heroRadius;
      if (this.invuln <= 0) this._die(DeathType.FLOOR);
    }
  }

  // Death animation: the hero tumbles and falls for a beat, then the card shows.
  // Everything else is frozen — a deliberate pause between lives.
  _updateDying() {
    this.dyingFrames++;
    const h = this.hero;
    h.vy = Math.min(h.vy + PHYSICS.gravity, PHYSICS.terminalFall);
    h.y += h.vy;
    if (this.dyingFrames >= RULES.deathAnimFrames) this.state = State.DEAD;
  }

  // Current stream speed — ramps with rank, surges during all-hands.
  get scrollSpeed() {
    const ranked = TOKENS.scrollBase * (1 + this.rankIndex * DIFFICULTY.scrollPerRank);
    return ranked * (1 + ALLHANDS.scrollBoost * this.allHandsIntensity);
  }

  // Spawn-gap multiplier — denser stream at higher ranks and during all-hands.
  get _spawnTighten() {
    let t = Math.max(0.25, 1 - this.rankIndex * DIFFICULTY.spawnTightenPerRank);
    t *= 1 - (1 - ALLHANDS.spawnTighten) * this.allHandsIntensity;
    return t;
  }

  // --- All-hands frenzy (spec §6.2) ------------------------------------------
  // 0 when off, 1 at full frenzy, easing to 0 over the wind-down tail.
  get allHandsIntensity() {
    if (!this.allHands) return 0;
    if (this.allHandsTimer >= ALLHANDS.windDownFrames) return 1;
    return this.allHandsTimer / ALLHANDS.windDownFrames;
  }

  _startAllHands() {
    this.allHands = true;
    this.allHandsTimer = ALLHANDS.durationFrames;
    this.allHandsMult = ALLHANDS.baseMult;
    this._multTimer = ALLHANDS.multStepFrames;
    // Hand the siren the event's length so it wails for the whole all-hands.
    this.events.push({ type: 'allhands', duration: ALLHANDS.durationFrames / FPS });
  }

  _endAllHands() {
    this.allHands = false;
    this.allHandsTimer = 0;
    this.allHandsMult = ALLHANDS.baseMult;
    this._allHandsCooldown = ALLHANDS.minGapFrames; // arm the gap before the next one
  }

  _updateAllHands() {
    if (!this.allHands) {
      // Random ambush: cool down first, then roll the dice each frame.
      if (this._allHandsCooldown > 0) { this._allHandsCooldown--; return; }
      if (Math.random() < ALLHANDS.chancePerFrame) this._startAllHands();
      return;
    }

    if (--this.allHandsTimer <= 0) {
      this._endAllHands();
      return;
    }
    // Multiplier climbs the longer you ride the frenzy (and the overflow risk).
    if (--this._multTimer <= 0 && this.allHandsMult < ALLHANDS.maxMult) {
      this.allHandsMult++;
      this._multTimer = ALLHANDS.multStepFrames;
    }
  }

  // Promote whenever the score crosses the next level threshold (may skip on a
  // jackpot). Steps through sub-levels too, so banners fire at I → II → III.
  _checkPromotion() {
    while (this.levelIndex < LEVELS.length - 1 &&
           this.score >= LEVELS[this.levelIndex + 1].threshold) {
      this.levelIndex++;
      this.rankFlash = DIFFICULTY.flashFrames;
      this.rankFlashName = LEVELS[this.levelIndex].name;
      this.rankFlashDemote = false;
      this.events.push({ type: 'promote' });
    }
  }

  // A non-floor hazard (em-dash / overflow): demote a grade, or die at Intern I.
  _hazard(type) {
    if (this.levelIndex <= 0) {
      if (type === DeathType.OVERFLOW) this.context = CONTEXT.max;
      this._die(type);
      return;
    }
    this._demote(type);
  }

  // Knock the player down one grade — and back to that grade's score floor, so
  // the lost rank actually costs the points that came with it.
  _demote(type) {
    this.levelIndex--;
    this.score = LEVELS[this.levelIndex].threshold;
    this.rankFlash = DIFFICULTY.flashFrames;
    this.rankFlashName = LEVELS[this.levelIndex].name;
    this.rankFlashDemote = true;
    this.events.push({ type: 'demote' });
    // An overflow demotion clears the window (you got "reorganized").
    if (type === DeathType.OVERFLOW) {
      this.context = 0;
      this.compactFlash = CONTEXT.flashFrames;
    }
  }

  _updateTokens() {
    const w = this.world;
    const hx = w.heroX;
    const hy = this.hero.y;
    const eatR = LAYOUT.heroRadius; // mouth hitbox

    // Spawn on a randomized timer, tightened by rank.
    if (--this._spawnTimer <= 0) {
      this._spawnToken();
      const tighten = this._spawnTighten;
      const lo = Math.max(DIFFICULTY.minSpawnFrames, TOKENS.spawnMinFrames * tighten);
      const hi = Math.max(lo + 4, TOKENS.spawnMaxFrames * tighten);
      this._spawnTimer = lo + Math.floor(Math.random() * (hi - lo + 1));
    }

    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      t.x -= this.scrollSpeed;

      if (this._hitsMouth(t, hx, hy, eatR)) {
        if (t.kind === 'emdash') {
          // A tax, not a demotion — eating an em-dash just costs points.
          this.tokens.splice(i, 1);
          this.score = Math.max(0, this.score - EMDASH.penalty);
          this.pops.push({
            x: t.x, y: t.y, value: -EMDASH.penalty, color: EMDASH.ring, ttl: TOKENS.popTtl,
          });
          this.events.push({ type: 'penalty' });
          continue;
        }
        if (t.kind === 'compactor') {
          this._compact();
          this.tokens.splice(i, 1);
          continue;
        }
        this._eat(t);
        this.tokens.splice(i, 1);
        continue;
      }

      // Cull once fully off the left edge.
      if (t.x + t.r < 0) this.tokens.splice(i, 1);
    }
  }

  // Overlap test against the mouth. Coins are circles; the em-dash is a slab
  // (closest-point / circle test) so its rectangular reach feels fair.
  _hitsMouth(t, hx, hy, eatR) {
    if (t.kind === 'emdash') { // slab
      const nx = Math.max(t.x - t.hw, Math.min(hx, t.x + t.hw));
      const ny = Math.max(t.y - t.hh, Math.min(hy, t.y + t.hh));
      const dx = hx - nx, dy = hy - ny;
      return dx * dx + dy * dy <= eatR * eatR;
    }
    const dx = t.x - hx, dy = t.y - hy; // coin or compactor (circle)
    return dx * dx + dy * dy <= (t.r + eatR) * (t.r + eatR);
  }

  _eat(t) {
    const mult = this.allHands ? this.allHandsMult : 1;
    const gained = t.value * mult;
    this.score += gained;
    if (this.score > this.highScore) this.highScore = this.score; // live best

    // Bigger "thoughts" fill the window more — faster the higher you're promoted
    // (spec §5.1 + §6.1), and faster still during all-hands (the frenzy's catch).
    const ctxMult = (1 + this.rankIndex * DIFFICULTY.contextPerRank) *
                    (1 + ALLHANDS.contextBoost * this.allHandsIntensity);
    this.context += t.context * ctxMult;
    this.pops.push({
      x: t.x, y: t.y, value: gained, color: t.text, ttl: TOKENS.popTtl,
    });
    this.events.push({ type: 'eat', value: t.value });
  }

  // Compactor: the release valve. Drops the window by a chunk (spec §4.1).
  _compact() {
    this.context = Math.max(0, this.context - CONTEXT.max * CONTEXT.compactDrop);
    this.compactFlash = CONTEXT.flashFrames;
    this.events.push({ type: 'compact' });
  }

  _updatePops() {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.y -= TOKENS.popRise;
      if (--p.ttl <= 0) this.pops.splice(i, 1);
    }
  }

  _spawnToken() {
    const w = this.world;

    // A share of spawns are the em-dash hazard — an avoidable red slab (spec §5.2).
    // That share grows with rank, so higher tiers are denser with hazards.
    if (Math.random() < this.emdashChance) {
      const hw = EMDASH.w / 2, hh = EMDASH.h / 2;
      const lo = w.ceilingY + TOKENS.spawnPadY + hh;
      const hi = w.floorY - TOKENS.spawnPadY - hh;
      this.tokens.push({
        kind: 'emdash',
        x: w.width + hw,
        y: lo + Math.random() * (hi - lo),
        r: hw,          // for off-screen culling
        hw, hh,
        fill: EMDASH.fill, ring: EMDASH.ring, bar: EMDASH.bar,
      });
      return;
    }

    // The compactor hexagon — the bar's release valve (spec §4.1).
    if (Math.random() < COMPACTOR.chance) {
      const r = COMPACTOR.r;
      const lo = w.ceilingY + TOKENS.spawnPadY + r;
      const hi = w.floorY - TOKENS.spawnPadY - r;
      this.tokens.push({
        kind: 'compactor',
        x: w.width + r,
        y: lo + Math.random() * (hi - lo),
        r,
        fill: COMPACTOR.fill, ring: COMPACTOR.ring, line: COMPACTOR.line,
      });
      return;
    }

    const c = this._pickCoin();
    const lo = w.ceilingY + TOKENS.spawnPadY + c.r;
    const hi = w.floorY - TOKENS.spawnPadY - c.r;
    this.tokens.push({
      kind: 'coin',
      x: w.width + c.r,
      y: lo + Math.random() * (hi - lo),
      r: c.r,
      value: c.value,
      context: c.context,
      text: c.text,
      fill: c.fill,
      ring: c.ring,
      tier: c.name,
    });
  }

  // Weighted pick across the coin tiers.
  _pickCoin() {
    let roll = Math.random() * COIN_WEIGHT_TOTAL;
    for (const c of COINS) {
      if ((roll -= c.weight) <= 0) return c;
    }
    return COINS[0];
  }

  _die(type) {
    this.lives = Math.max(0, this.lives - 1);
    const newBest = this.score > this._runStartBest;
    if (newBest) this._store.save(this.highScore); // persist only when it's a record
    this.death = { type, newBest, best: this.highScore, ...this._deathCopy(type) };
    this.events.push({ type: 'death', kind: type });
    // Play the death tumble first; the card appears when it finishes.
    this.dyingFrames = 0;
    this.hero.vy = -6; // a little death "hop" before the fall
    this.state = State.DYING;
  }

  // Each death type gets its own eyebrow + register (spec §7).
  _deathCopy(type) {
    if (type === DeathType.EMDASH) {
      const sub = EMDASH_SUB[Math.floor(Math.random() * EMDASH_SUB.length)];
      return { eyebrow: 'EM-DASH INGESTED', line: 'A human would never.', sub };
    }
    if (type === DeathType.OVERFLOW) {
      return { ...OVERFLOW_COPY };
    }
    // FLOOR — rotating snark pool via shuffle-bag (no back-to-back repeats).
    if (this._snarkBag.length === 0) {
      this._snarkBag = [...FLOOR_SNARK].sort(() => Math.random() - 0.5);
    }
    return { eyebrow: 'YOU HIT THE FLOOR', ...this._snarkBag.pop() };
  }
}
