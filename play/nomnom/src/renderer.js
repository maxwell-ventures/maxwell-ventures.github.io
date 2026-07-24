// ============================================================================
// renderer.js — draws Game state to a 2D canvas. Owns purely-cosmetic things
// (the chomp animation clock, the motion trail). Reads the game; never mutates it.
// ============================================================================

import { COLORS, LAYOUT, CHOMP, RULES, CONTEXT, DIFFICULTY, PHYSICS, ALLHANDS_TICKER, getTheme } from './config.js';
import { State } from './game.js';
import { isMuted } from './audio.js';

const ZONE = { green: '#5DCAA5', amber: '#EF9F27', red: '#E24B4A' };

const TAU = Math.PI * 2;
const mono = (px, weight = 'normal') =>
  `${weight} ${px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.trail = [];           // recent hero positions for the fall streak
    this.chompClock = 0;       // seconds, advanced by render dt
    this._cardToggles = []; // hit regions of the toggles on the current card
    this._resumeRect = null; // pause-card RESUME button bounds
    this.helpOpen = false;   // is the how-to-play overlay showing? (set by host)
    this._helpRect = null;   // the "?" badge bounds on the start card
  }

  // dtMs = real wall-clock delta, used only for cosmetic animation timing.
  draw(game, dtMs) {
    this.chompClock += dtMs / 1000;
    const { ctx } = this;
    const w = game.world;

    ctx.fillStyle = COLORS.canvas;
    ctx.fillRect(0, 0, w.width, w.height);

    this._drawVibeBar(game);
    this._drawPlayField(game);
    this._drawTrail(game);
    this._drawTokens(game);
    this._drawHero(game);
    this._drawPops(game);
    this._drawHud(game);
    if (game.allHands) this._drawAllHands(game);
    this._drawRankFlash(game);
    if (game.state === State.PLAYING) this._drawPauseButton(game);

    if (game.state === State.READY) this._drawReady(game);
    if (game.state === State.PAUSED) this._drawPause(game);
    if (game.state === State.DEAD) this._drawDeathCard(game);
    // How-to-play overlays whichever card is up.
    if (this.helpOpen && game.state !== State.PLAYING) this._drawHelp(game);
  }

  // --- Play field: lane guides + the lethal floor ----------------------------
  _drawPlayField(game) {
    const { ctx } = this;
    const w = game.world;
    const top = w.ceilingY - LAYOUT.heroRadius;

    // Subtle lane guides (spec §8.5 toggle — off by default via LAYOUT.laneGuides).
    if (LAYOUT.laneGuides) {
      ctx.strokeStyle = COLORS.laneGuide;
      ctx.lineWidth = 1;
      const lanes = 5;
      for (let i = 1; i < lanes; i++) {
        const y = top + ((w.floorY - top) * i) / lanes;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w.width, y);
        ctx.stroke();
      }
    }

    // Lethal floor: a thin warning line + faint danger gradient above it.
    const grad = ctx.createLinearGradient(0, w.floorY - 60, 0, w.floorY);
    grad.addColorStop(0, 'rgba(226,75,74,0)');
    grad.addColorStop(1, 'rgba(226,75,74,0.18)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, w.floorY - 60, w.width, 60);

    ctx.strokeStyle = COLORS.floorWarn;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, w.floorY);
    ctx.lineTo(w.width, w.floorY);
    ctx.stroke();
  }

  // --- VIBE pad: the floor is a spinning grinder (grind culture / "cog in the
  // machine"); the big tap button is translucent so the gears churn through it.
  _drawVibeBar(game) {
    const { ctx } = this;
    const w = game.world;
    const top = w.vibeTop;
    const h = w.height - top;
    if (h <= 1) return;

    // 1) Grinder bed + spinning gears, clipped to the band (teeth emerge at the
    //    kill line; the rest of the big gears recede off-screen below).
    ctx.fillStyle = '#16181D';
    ctx.fillRect(0, top, w.width, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w.width, h);
    ctx.clip();
    this._drawGrinder(w, top, h);
    ctx.restore();

    // 2) Caution stripe at the kill line.
    this._hazardStripe(top, w.width);

    // 3) The VIBE button — translucent so the grinder shows through.
    const padX = 12, padY = 11;
    const bx = padX, by = top + padY, bw = w.width - padX * 2, bh = h - padY * 2;
    const r = Math.min(24, bh / 2);
    const press = game.state === State.PLAYING
      ? Math.min(1, Math.max(0, -game.hero.vy) / Math.abs(PHYSICS.flapImpulse)) : 0;
    const RED = [226, 75, 74], BLACK = [18, 20, 26];
    const mix = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

    ctx.save();
    ctx.globalAlpha = 0.5 + 0.35 * press; // firmer on tap, see-through at rest
    this._roundRect(bx, by, bw, bh, r);
    ctx.fillStyle = mix(BLACK, RED, press);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgb(226,75,74)';
    ctx.lineWidth = 3;
    this._roundRect(bx + 1.5, by + 1.5, bw - 3, bh - 3, Math.max(2, r - 1.5));
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = mix(RED, BLACK, press);
    ctx.font = mono(Math.min(36, bh * 0.5), 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VIBE', w.width / 2, by + bh / 2 + 1);
    ctx.restore();
    this._resetText();
  }

  // A row of big interlocking gears; adjacent ones counter-rotate.
  _drawGrinder(w, top, h) {
    const R = h * 0.5;
    const cy = top + R * 0.42;          // teeth poke up to ~the kill line
    const spacing = R * 1.5;
    const spin = this.chompClock * 0.55;

    // Back row — smaller, dimmer, offset (depth).
    this.ctx.save();
    this.ctx.globalAlpha = 0.5;
    let k = 0;
    for (let x = -spacing * 0.25; x < w.width + R; x += spacing) {
      this._drawGear(x + spacing * 0.5, cy + R * 0.55, R * 0.66, 10,
        -spin * 0.8 * (k % 2 ? -1 : 1), '#2A2E36', '#1B1E24');
      k++;
    }
    this.ctx.restore();

    // Front row at the kill line.
    let i = 0;
    for (let x = -spacing * 0.1; x < w.width + R; x += spacing) {
      this._drawGear(x, cy, R, 11, spin * (i % 2 ? -1 : 1), '#3A3F47', '#23272E');
      i++;
    }
  }

  // One procedural gear (flat-topped teeth) centered at (cx,cy), rotated by rot.
  _drawGear(cx, cy, R, teeth, rot, fill, stroke) {
    const { ctx } = this;
    const ri = R * 0.74;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    const step = TAU / teeth;
    let first = true;
    for (let i = 0; i < teeth; i++) {
      const b = i * step;
      const pts = [[R, b + step * 0.06], [R, b + step * 0.44], [ri, b + step * 0.56], [ri, b + step * 0.94]];
      for (const [rad, a] of pts) {
        const px = rad * Math.cos(a), py = rad * Math.sin(a);
        if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    // hub
    ctx.beginPath(); ctx.arc(0, 0, R * 0.32, 0, TAU); ctx.fillStyle = stroke; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.14, 0, TAU); ctx.fillStyle = '#15181F'; ctx.fill();
    ctx.restore();
  }

  // Diagonal caution stripe drawn at the very top of the VIBE band (kill line).
  _hazardStripe(yTop, width) {
    const { ctx } = this;
    const sh = 9, s = 14;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, yTop, width, sh);
    ctx.clip();
    ctx.fillStyle = '#1A1410';
    ctx.fillRect(0, yTop, width, sh);
    ctx.fillStyle = '#E2A33A';
    for (let x = -sh; x < width + sh; x += s * 2) {
      ctx.beginPath();
      ctx.moveTo(x, yTop + sh);
      ctx.lineTo(x + s, yTop + sh);
      ctx.lineTo(x + s + sh, yTop);
      ctx.lineTo(x + sh, yTop);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Motion trail ----------------------------------------------------------
  _drawTrail(game) {
    const { ctx } = this;
    const x = game.world.heroX;

    if (game.state === State.PLAYING) {
      this.trail.push(game.hero.y);
      if (this.trail.length > 10) this.trail.shift();
    } else if (this.trail.length) {
      this.trail.shift();
    }

    ctx.fillStyle = COLORS.trail;
    this.trail.forEach((y, i) => {
      const t = i / this.trail.length;
      const r = LAYOUT.heroRadius * (0.4 + 0.5 * t);
      ctx.globalAlpha = 0.4 * t;
      ctx.beginPath();
      ctx.arc(x - (this.trail.length - i) * 5, y, r, 0, TAU);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // --- Coins: circle, colored by rarity, value stamped on the face -----------
  _drawTokens(game) {
    const { ctx } = this;
    for (const t of game.tokens) {
      if (t.kind === 'emdash') { this._drawEmdash(t); continue; }
      if (t.kind === 'compactor') { this._drawCompactor(t); continue; }

      // Body fill.
      ctx.fillStyle = t.fill;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, TAU);
      ctx.fill();

      // Solid outer ring.
      ctx.strokeStyle = t.ring;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r - 1.5, 0, TAU);
      ctx.stroke();

      // Dashed inner ring (the coin-system motif from the reference art).
      ctx.save();
      ctx.setLineDash([2, 3.2]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * 0.68, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Value text, sized down for more digits so it always fits the face.
      const digits = String(t.value).length;
      const fs = t.r * (digits >= 3 ? 0.78 : digits === 2 ? 0.92 : 1.05);
      ctx.fillStyle = t.text;
      ctx.font = mono(fs, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(t.value), t.x, t.y + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Compactor: a blue hexagon with collapse-lines. A shape-breaker, not a coin.
  // Green hexagon with a down arrow that gently pulses — reads as "safe to eat"
  // (it drains your context bar back down).
  _drawCompactor(t) {
    const { ctx } = this;
    const pulse = 1 + 0.07 * Math.sin(this.chompClock * 6.5); // breathe
    const r = t.r * pulse;

    // Soft beckoning glow (pulses opposite the body).
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(this.chompClock * 6.5));
    ctx.fillStyle = t.ring;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r * 1.35, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Hexagon body.
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * (TAU / 6);
      const px = t.x + r * Math.cos(a);
      const py = t.y + r * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = t.fill;
    ctx.fill();
    ctx.strokeStyle = t.ring;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Down arrow (drain).
    const a = r * 0.52;
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - a);               // stem top
    ctx.lineTo(t.x, t.y + a * 0.45);        // stem bottom
    ctx.moveTo(t.x - a * 0.62, t.y - a * 0.15); // left barb
    ctx.lineTo(t.x, t.y + a * 0.6);         // tip
    ctx.lineTo(t.x + a * 0.62, t.y - a * 0.15); // right barb
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  // Em-dash: a red warning slab with a centered "—". Deliberately not a coin.
  _drawEmdash(t) {
    const { ctx } = this;
    const x = t.x - t.hw, y = t.y - t.hh, w = t.hw * 2, h = t.hh * 2;
    const r = 6;

    ctx.fillStyle = t.fill;
    this._roundRect(x, y, w, h, r);
    ctx.fill();

    ctx.strokeStyle = t.ring;
    ctx.lineWidth = 2.5;
    this._roundRect(x + 1.25, y + 1.25, w - 2.5, h - 2.5, r - 1);
    ctx.stroke();

    // The em-dash bar itself.
    ctx.strokeStyle = t.bar;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t.x - t.hw * 0.5, t.y);
    ctx.lineTo(t.x + t.hw * 0.5, t.y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  _roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- Transient "+N" score pops ---------------------------------------------
  _drawPops(game) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (const p of game.pops) {
      ctx.globalAlpha = Math.min(1, p.ttl / 18);
      ctx.fillStyle = p.color;
      ctx.font = mono(15, 'bold');
      ctx.fillText((p.value >= 0 ? '+' : '') + p.value, p.x, p.y); // negative shows its own '-'
    }
    ctx.globalAlpha = 1;
  }

  // --- Hero: chat-bubble with a rocket pack; mouth is a chomping wedge --------
  _drawHero(game) {
    const { ctx } = this;
    const x = game.world.heroX;
    const y = game.hero.y;
    const R = LAYOUT.heroRadius;

    // Chomp: wedge half-angle oscillates between min/max open.
    const phase = (Math.sin(this.chompClock * CHOMP.cyclesPerSec * TAU) + 1) / 2;
    const half = (CHOMP.minOpenDeg + (CHOMP.maxOpenDeg - CHOMP.minOpenDeg) * phase) * (Math.PI / 180);

    // Death tumble: spin, fall, and fade out (the jetpack cuts out — engine's gone).
    if (game.state === State.DYING) {
      const p = game.dyingProgress;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p * p);
      ctx.translate(x, y);
      ctx.rotate(p * TAU * 1.5);
      this._heroFace(0, 0, R, half);
      ctx.restore();
      return;
    }

    ctx.save();
    // Flash during respawn invuln so it reads as "grace".
    if (game.invuln > 0 && Math.floor(game.invuln / 4) % 2 === 0) ctx.globalAlpha = 0.45;
    this._drawJetpack(game, x, y, R); // behind the body
    this._heroFace(x, y, R, half);
    ctx.restore();
  }

  // Rocket pack on the hero's back with a downward exhaust plume. The flame
  // flares with upward thrust (read from velocity) and idles to a pilot flicker.
  _drawJetpack(game, x, y, R) {
    const { ctx } = this;
    // Thrust ≈ how hard we're rising right now (vy is negative going up).
    const thrust = Math.max(0, -game.hero.vy) / Math.abs(PHYSICS.flapImpulse);
    const idle = 0.16 + 0.1 * Math.abs(Math.sin(this.chompClock * 26));
    const flame = Math.min(1.3, Math.max(idle, thrust));

    // Canister: a small dark pack on the back-left, peeking out past the bubble.
    const px = x - R * 1.12;            // pack center x (left of the body's edge)
    const pTop = y - R * 0.5;
    const pw = R * 0.52, ph = R * 1.0;
    ctx.fillStyle = '#3A4250';
    this._roundRect(px - pw / 2, pTop, pw, ph, R * 0.16);
    ctx.fill();
    ctx.fillStyle = '#2A2E36';
    this._roundRect(px - pw / 2, pTop, pw, R * 0.22, R * 0.12); // darker cap
    ctx.fill();

    // Nozzle at the bottom of the canister.
    const nozY = pTop + ph;
    ctx.fillStyle = '#5A6273';
    ctx.beginPath();
    ctx.moveTo(px - pw * 0.42, nozY - 1);
    ctx.lineTo(px + pw * 0.42, nozY - 1);
    ctx.lineTo(px + pw * 0.30, nozY + R * 0.16);
    ctx.lineTo(px - pw * 0.30, nozY + R * 0.16);
    ctx.closePath();
    ctx.fill();

    // Exhaust plume — outer orange + inner yellow teardrops, with a flicker.
    const baseY = nozY + R * 0.16;
    const len = R * (0.35 + 1.5 * flame) * (0.9 + 0.2 * Math.sin(this.chompClock * 40));
    const halfW = pw * (0.34 + 0.18 * flame);
    const flameTip = baseY + len;

    const drawFlame = (w, tipY, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px - w, baseY);
      ctx.quadraticCurveTo(px - w * 0.5, (baseY + tipY) / 2, px, tipY);
      ctx.quadraticCurveTo(px + w * 0.5, (baseY + tipY) / 2, px + w, baseY);
      ctx.closePath();
      ctx.fill();
    };
    drawFlame(halfW, flameTip, '#F2792A');                 // outer flame
    drawFlame(halfW * 0.55, baseY + len * 0.62, '#FFD36B'); // inner core
  }

  // The posed hero — tail + chomping body + eye. Reused as the card mascot.
  _heroFace(x, y, R, half) {
    const { ctx } = this;
    const cr = R * 0.34; // rounded square, not a circle/pellet

    // Speech-bubble tail (bottom-left) — reads as "chat", keeps us off Pac-Man.
    ctx.fillStyle = COLORS.hero;
    ctx.beginPath();
    ctx.moveTo(x - R * 0.55, y + R * 0.45);
    ctx.lineTo(x - R * 1.05, y + R * 1.1);
    ctx.lineTo(x - R * 0.1, y + R * 0.8);
    ctx.closePath();
    ctx.fill();

    // Body = rounded square with a chomping mouth wedge cut from the RIGHT edge.
    this._bubblePath(x, y, R, half, cr);
    ctx.fill();

    // One eye, simple, upper portion.
    ctx.fillStyle = COLORS.heroEye;
    ctx.beginPath();
    ctx.arc(x - R * 0.12, y - R * 0.42, R * 0.15, 0, TAU);
    ctx.fill();
  }

  // Shared hero silhouette: a rounded square with a chomp wedge on the right.
  // `half` is the mouth's half-angle (radians); `cr` the corner radius.
  _bubblePath(x, y, R, half, cr) {
    const { ctx } = this;
    const tan = Math.tan(half);
    ctx.beginPath();
    ctx.moveTo(x, y);                            // mouth hinge (center)
    ctx.lineTo(x + R, y - R * tan);              // out to upper lip
    ctx.arcTo(x + R, y - R, x - R, y - R, cr);   // round TR corner
    ctx.arcTo(x - R, y - R, x - R, y + R, cr);   // round TL corner
    ctx.arcTo(x - R, y + R, x + R, y + R, cr);   // round BL corner
    ctx.arcTo(x + R, y + R, x + R, y + R * tan, cr); // round BR corner
    ctx.lineTo(x + R, y + R * tan);              // down to lower lip
    ctx.closePath();                             // back to hinge
  }

  // --- HUD band (top): SCORE · RANK · LIVES + context-bar slot ---------------
  // Rows scaffolded now; scoring/context/all-hands fill them in later steps.
  _drawHud(game) {
    const { ctx } = this;
    const w = game.world;
    const hudH = w.height * 0.18;

    ctx.fillStyle = COLORS.hudBand;
    ctx.fillRect(0, 0, w.width, hudH);

    // Row 1
    const r1 = hudH * 0.30;
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(11);
    ctx.textAlign = 'left';
    ctx.fillText('SCORE', 16, r1 - 12);
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = mono(20, 'bold');
    ctx.fillText(String(game.score).padStart(6, '0'), 16, r1 + 6);

    ctx.fillStyle = COLORS.hero;
    ctx.font = mono(18, 'bold');
    ctx.textAlign = 'center';
    ctx.fillText(game.rank, w.width / 2, r1);

    // Lives = mini hero bubbles (same silhouette), spent ones dimmed.
    const liveR = 8;
    const liveHalf = 17 * (Math.PI / 180);
    const liveCr = liveR * 0.34;
    for (let i = 0; i < RULES.lives; i++) {
      const cx = w.width - 16 - liveR - i * (liveR * 2 + 9);
      ctx.globalAlpha = i < game.lives ? 1 : 0.22;
      ctx.fillStyle = COLORS.hero;
      this._bubblePath(cx, r1, liveR, liveHalf, liveCr);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Row 2: the context-window bar — fill, zones, overflow threshold.
    this._drawContextBar(game, hudH);

    // (All-hands takes over the top of the play field, not a HUD row — see _drawAllHands.)

    // Hard divider between HUD and play field.
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hudH);
    ctx.lineTo(w.width, hudH);
    ctx.stroke();
  }

  // --- Context window bar ----------------------------------------------------
  _drawContextBar(game, hudH) {
    const { ctx } = this;
    const w = game.world;
    const x = 16, bw = w.width - 32, by = hudH * 0.50, bh = 16, r = bh / 2;
    const frac = Math.max(0, Math.min(1, game.context / CONTEXT.max));
    const zone = frac < CONTEXT.lowAt || frac >= CONTEXT.redAt ? ZONE.red
               : frac >= CONTEXT.amberAt ? ZONE.amber : ZONE.green;
    const pct = Math.round(frac * 100);
    const hint = frac < CONTEXT.lowAt ? 'get back to work'
               : frac >= CONTEXT.redAt ? 'compact now'
               : frac >= CONTEXT.amberAt ? 'watch the overflow'
               : 'room to think';

    // Header row above the bar.
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(11, 'bold');
    ctx.textAlign = 'left';
    ctx.fillText('CONTEXT WINDOW', x, by - 8);
    ctx.fillStyle = zone;
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}% — ${hint}`, x + bw, by - 8);

    // Track (rounded pill).
    ctx.fillStyle = COLORS.canvas;
    this._roundRect(x, by, bw, bh, r);
    ctx.fill();
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Zone-segmented fill, clipped to the pill so ends stay rounded.
    if (frac > 0) {
      ctx.save();
      this._roundRect(x, by, bw, bh, r);
      ctx.clip();
      const segs = [
        [0, Math.min(frac, CONTEXT.lowAt), ZONE.red],
        [CONTEXT.lowAt, Math.min(frac, CONTEXT.amberAt), ZONE.green],
        [CONTEXT.amberAt, Math.min(frac, CONTEXT.redAt), ZONE.amber],
        [CONTEXT.redAt, frac, ZONE.red],
      ];
      for (const [a, b, color] of segs) {
        if (b <= a) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x + bw * a, by, bw * (b - a), bh);
      }
      // Collapse flash after a compact — a bright wash that fades out.
      if (game.compactFlash > 0) {
        ctx.globalAlpha = (game.compactFlash / CONTEXT.flashFrames) * 0.6;
        ctx.fillStyle = '#FAFAF7';
        ctx.fillRect(x, by, bw * frac, bh);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // Twin dashed pills: idle at the low end, overload at the high end.
    this._dashedZone(x, by, bw * CONTEXT.lowAt, bh, r, 'GET BACK TO WORK');
    const ox = x + bw * CONTEXT.redAt;
    this._dashedZone(ox, by, bw * (1 - CONTEXT.redAt), bh, r, 'OVERFLOW');

    ctx.textBaseline = 'middle';
  }

  // A dashed red pill over part of the context track, with a shrink-to-fit label.
  _dashedZone(x0, by, w0, bh, r, label) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = ZONE.red;
    ctx.lineWidth = 1.5;
    this._roundRect(x0, by - 1, w0, bh + 2, r);
    ctx.stroke();
    ctx.restore();

    // Shrink the label until it fits; hide it only if it can't fit legibly.
    let fs = 9;
    ctx.font = mono(fs, 'bold');
    while (fs > 6.5 && ctx.measureText(label).width > w0 - 8) {
      fs -= 0.5;
      ctx.font = mono(fs, 'bold');
    }
    if (ctx.measureText(label).width <= w0 - 6) {
      ctx.fillStyle = ZONE.red;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x0 + w0 / 2, by + bh / 2 + 0.5);
    }
  }

  // --- All-hands takeover: flashing headline + flashing scrolling ticker -----
  // Lives in the HUD band (the score-bar zone), clipped so it never touches the
  // play field — but still loud enough to hijack your eyes.
  _drawAllHands(game) {
    const { ctx } = this;
    const w = game.world;
    const hudH = w.height * 0.18;
    const cx = w.width / 2;
    const a = game.allHandsIntensity;          // fade out with the wind-down

    // Hard ~3Hz blink so the headline truly flashes.
    const blink = Math.floor(this.chompClock * 6) % 2 === 0;

    // Geometry anchored to the bottom of the band, above the HUD divider.
    const barH = 19;
    const barTop = hudH - barH - 3;
    const barMid = barTop + barH / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w.width, hudH);             // never spill into gameplay
    ctx.clip();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Flashing headline, centered above the ticker bar — as large as fits.
    const headText = '⚠ ALL-HANDS MEETING ⚠';
    let hs = 30;
    ctx.font = mono(hs, 'bold');
    while (hs > 14 && ctx.measureText(headText).width > w.width - 20) {
      hs -= 1;
      ctx.font = mono(hs, 'bold');
    }
    const headY = barTop - 6 - hs / 2;
    ctx.globalAlpha = a * (blink ? 1 : 0.4);
    ctx.fillStyle = blink ? ZONE.red : ZONE.amber;
    ctx.fillText(headText, cx, headY);

    // Ticker bar beneath it.
    ctx.globalAlpha = a;
    ctx.fillStyle = this._tint(ZONE.amber, 0.18);
    ctx.fillRect(0, barTop, w.width, barH);
    ctx.fillStyle = ZONE.amber;
    ctx.fillRect(0, barTop, w.width, 1.5);
    ctx.fillRect(0, barTop + barH - 1.5, w.width, 1.5);

    // AI ×N counter (right), amber, bold.
    ctx.font = mono(13, 'bold');
    const counter = `AI ×${game.allHandsMult}`;
    const counterW = ctx.measureText(counter).width;
    ctx.fillStyle = ZONE.amber;
    ctx.textAlign = 'right';
    ctx.fillText(counter, w.width - 12, barMid + 0.5);

    // Flashing, scrolling quoted C-suite speak.
    const mLeft = 12;
    const mRight = w.width - 12 - counterW - 12;
    if (mRight - mLeft > 40) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(mLeft, barTop, mRight - mLeft, barH);
      ctx.clip();
      const text = ALLHANDS_TICKER.map((s) => `“${s}”`).join('      ') + '      ';
      ctx.font = mono(13, 'bold');
      // Quotes flicker between white and amber to keep nagging at you.
      ctx.fillStyle = blink ? COLORS.textPrimary : ZONE.amber;
      ctx.textAlign = 'left';
      const tw = ctx.measureText(text).width;
      const off = (this.chompClock * 55) % tw;
      for (let sx = mLeft - off; sx < mRight; sx += tw) {
        ctx.fillText(text, sx, barMid + 0.5);
      }
      ctx.restore();
    }
    ctx.restore();
    this._resetText();
  }

  // --- Promotion / demotion alert: big, scale-pops in, flashes, fades out ----
  _drawRankFlash(game) {
    if (game.rankFlash <= 0) return;
    const { ctx } = this;
    const w = game.world;
    const hudH = w.height * 0.18;
    const demote = game.rankFlashDemote;
    const accent = demote ? ZONE.red : ZONE.green; // green = up, red = down

    const t = game.rankFlash / DIFFICULTY.flashFrames; // 1 → 0
    const age = 1 - t;                                   // 0 → 1
    const cx = w.width / 2;
    const cy = hudH + (w.height - hudH) * 0.40;
    const pop = age < 0.22 ? 1 + 0.22 * (1 - age / 0.22) : 1; // overshoot then settle
    const alpha = t > 0.35 ? 1 : Math.max(0, t / 0.35);       // hold, then fade

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Quick color flash band behind the text (gone within the first ~third).
    const bandA = age < 0.3 ? (1 - age / 0.3) * 0.16 : 0;
    if (bandA > 0) {
      ctx.globalAlpha = bandA;
      ctx.fillStyle = accent;
      ctx.fillRect(0, cy - 36, w.width, 72);
    }

    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 8;

    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(13, 'bold');
    ctx.fillText(demote ? 'DEMOTED' : 'PROMOTED', 0, -24);

    // Big rank name, auto-fit to width.
    let fs = 40;
    ctx.font = mono(fs, 'bold');
    while (fs > 22 && ctx.measureText(game.rankFlashName).width > w.width - 36) {
      fs -= 1;
      ctx.font = mono(fs, 'bold');
    }
    ctx.fillStyle = accent;
    ctx.fillText(game.rankFlashName, 0, 8);
    ctx.restore();
  }

  // --- Overlays (title / death cards) ----------------------------------------
  _drawReady(game) {
    const { ctx } = this;
    const w = game.world;
    this._scrim(game);

    const cx = w.width / 2;
    const cw = Math.min(w.width - 36, 380);
    const ch = 384;
    const top = Math.round(w.height / 2 - ch / 2);
    this._cardToggles = [];
    this._panel(cx - cw / 2, top, cw, ch);

    // Mascot — the live chomping hero, as the logo.
    this._heroFace(cx, top + 50, 24, this._mascotHalf());

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.hero;
    ctx.font = mono(25, 'bold');
    ctx.fillText('NOM NOM TOKENS', cx, top + 102);

    ctx.fillStyle = COLORS.textTertiary;
    ctx.font = mono(11);
    ctx.fillText('the work never stops. don’t hit the floor.', cx, top + 128);

    this._cardDivider(cx, top + 148, cw - 64);

    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(12, 'bold');
    const best = game.highScore > 0
      ? `BEST  ${String(game.highScore).padStart(6, '0')}`
      : 'no record yet — go set one';
    ctx.fillText(best, cx, top + 168);

    // Appearance + sound toggles — quiet nods to the IDE / mute affordances.
    this._drawCardToggles(w, cx, top + 200);

    this._button(cx, top + ch - 54, 'TAP TO FLY');
    this._drawHelpBadge(cx + cw / 2 - 30, top + 30);
    this._resetText();
  }

  // "?" help badge at (hx, hy); records its bounds for hitHelp().
  _drawHelpBadge(hx, hy) {
    const { ctx } = this;
    const hr = 17;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, TAU);
    ctx.fillStyle = COLORS.canvas;
    ctx.fill();
    ctx.strokeStyle = COLORS.textTertiary;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(18, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', hx, hy + 1);
    this._helpRect = { x: hx - hr, y: hy - hr, w: hr * 2, h: hr * 2 };
  }

  hitHelp(px, py) {
    const r = this._helpRect;
    if (!r) return false;
    const pad = 8;
    return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }

  // How-to-play overlay: controls + a legend of the tokens. Tap anywhere closes.
  _drawHelp(game) {
    const { ctx } = this;
    const w = game.world;
    this._scrim(game);

    const cx = w.width / 2;
    const cw = Math.min(w.width - 24, 430);

    // Measure the content first (no drawing) so the card hugs it and the button
    // sits right under the footer — no dead gap.
    const measuredEnd = this._helpContent(cx, 0, cw, false);
    const ch = Math.min(w.height - 24, measuredEnd + 18 + 46 + 16); // gap + button + pad
    const top = Math.round(w.height / 2 - ch / 2);

    this._panel(cx - cw / 2, top, cw, ch);
    const footerEnd = this._helpContent(cx, top, cw, true);
    this._button(cx, footerEnd + 18, 'LOOKS DOABLE');
    this._resetText();
  }

  // Lays out the how-to-play content from `top`. With draw=false it only
  // advances/measures (no fillText/icons). Returns the y after the footer.
  _helpContent(cx, top, cw, draw) {
    const { ctx } = this;
    if (draw) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.hero;
      ctx.font = mono(20, 'bold');
      ctx.fillText('HOW TO PLAY', cx, top + 30);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (draw) ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(11);
    let y = this._wrap('You’re Cache — an employee clawing up the corporate ladder. Tap / click / Space to fire your jetpack. Stop and you fall; the grind never stops. Eat tokens, climb Intern → C-Suite. (Spoiler: the higher you get, the harder it gets.)',
      cx, top + 54, cw - 40, 16, draw) + 22;

    const ix = cx - cw / 2 + 40, lx = cx - cw / 2 + 70, descW = cw - 88;
    const row = (drawIcon, title, desc) => {
      if (draw) {
        drawIcon(ix, y + 8);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = COLORS.textPrimary;
        ctx.font = mono(12, 'bold');
        ctx.fillText(title, lx, y + 4);
        ctx.fillStyle = COLORS.textSecondary;
      }
      ctx.font = mono(10); // set regardless so measureText is accurate
      const end = this._wrapLeft(desc, lx, y + 20, descW, 13, draw);
      y = Math.max(end, y + 24) + 16;
    };

    row((x, cy) => this._legendCoin(x, cy), 'COINS',
      'Points. Rarer = worth more — and the good stuff fills your context faster. Ambition has a cost.');
    row((x, cy) => this._legendCompactor(x, cy), 'COMPACTOR',
      'Eat it to flush your context window. Your only release valve. Use it before you’re the one being compacted.');
    row((x, cy) => this._legendEmdash(x, cy), 'EM-DASH',
      'Costs you points the instant you touch it. A human would never. Dodge it. (Yes, this very sentence is a hazard.)');
    row((x, cy) => this._legendAllHands(x, cy), 'ALL-HANDS',
      'Not a token — a meeting. Everything speeds up, points double, context fills faster, and nobody knows why. Survive it.');

    if (draw) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COLORS.textTertiary;
    }
    ctx.font = mono(10);
    return this._wrap('The context bar up top fills as you eat. Overflow or the floor are both fatal. Stay out of the red, stay employed.',
      cx, y + 6, cw - 40, 14, draw);
  }

  // Left-aligned word-wrap (the centered _wrap assumes textAlign center).
  _wrapLeft(text, x, y, maxW, lh, draw = true) {
    const { ctx } = this;
    const words = String(text).split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        if (draw) ctx.fillText(line, x, yy);
        line = word; yy += lh;
      } else line = test;
    }
    if (line && draw) ctx.fillText(line, x, yy);
    return yy; // ← needed so rows can flow below the previous one
  }

  _legendCoin(x, y) {
    const { ctx } = this;
    ctx.fillStyle = '#16304F';
    ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3679C4'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 13.5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#85B7EB'; ctx.font = mono(13, 'bold');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', x, y + 1);
  }

  _legendCompactor(x, y) {
    const { ctx } = this; const r = 15;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * (TAU / 6);
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#1E3A2E'; ctx.fill();
    ctx.strokeStyle = '#5DCAA5'; ctx.lineWidth = 2; ctx.stroke();
    // down arrow
    const a = 7.5;
    ctx.strokeStyle = '#CFF5E6'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y - a); ctx.lineTo(x, y + a * 0.45);
    ctx.moveTo(x - a * 0.62, y - a * 0.15); ctx.lineTo(x, y + a * 0.6); ctx.lineTo(x + a * 0.62, y - a * 0.15);
    ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  _legendEmdash(x, y) {
    const { ctx } = this;
    this._roundRect(x - 18, y - 10, 36, 20, 5);
    ctx.fillStyle = '#3A1410'; ctx.fill();
    ctx.strokeStyle = '#E24B4A'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#E24B4A'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // A warning triangle (an alert/event icon, not a collectible token shape).
  _legendAllHands(x, y) {
    const { ctx } = this; const s = 16;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.92, y + s * 0.7);
    ctx.lineTo(x - s * 0.92, y + s * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#41330A'; ctx.fill();
    ctx.strokeStyle = '#EF9F27'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineJoin = 'miter';
    ctx.fillStyle = '#EF9F27'; ctx.font = mono(13, 'bold');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 3);
  }

  // A pair of centered segment rects at a given y (a two-option toggle row).
  _segPair(world, segY) {
    const segW = 74, segH = 26;
    const sx = world.width / 2 - segW;
    return [
      { x: sx, y: segY, w: segW, h: segH },
      { x: sx + segW, y: segY, w: segW, h: segH },
    ];
  }

  // Generic segmented toggle: a label + two options, the active one filled coral.
  // Registers each segment's hit region under `name` for hitCardToggle().
  _drawSegToggle(name, segs, cx, label, opts, active) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textTertiary;
    ctx.font = mono(9, 'bold');
    ctx.fillText(label, cx, segs[0].y - 12);

    this._roundRect(segs[0].x, segs[0].y, segs[0].w + segs[1].w, segs[0].h, segs[0].h / 2);
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.stroke();

    opts.forEach((o, i) => {
      const r = segs[i];
      const on = active === o.value;
      if (on) {
        this._roundRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, (r.h - 4) / 2);
        ctx.fillStyle = COLORS.hero;
        ctx.fill();
      }
      ctx.fillStyle = on ? COLORS.onAccent : COLORS.textSecondary;
      ctx.font = mono(11, 'bold');
      ctx.fillText(o.label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      this._cardToggles.push({ name, value: o.value, rect: r });
    });
  }

  // Draw the appearance + sound toggles centered on a card, top of the first row
  // at `y`. Used by both the ready and pause cards.
  _drawCardToggles(world, cx, y) {
    this._drawSegToggle('theme', this._segPair(world, y), cx, 'APPEARANCE',
      [{ value: 'dark', label: 'DARK' }, { value: 'light', label: 'LIGHT' }], getTheme());
    this._drawSegToggle('sound', this._segPair(world, y + 48), cx, 'SOUND',
      [{ value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }], isMuted() ? 'off' : 'on');
  }

  // Returns { name, value } if a tap hit a card toggle segment, else null.
  // Vertical touch padding makes the slim segments easier to hit on a phone.
  hitCardToggle(px, py) {
    const padX = 4, padY = 12;
    for (const t of this._cardToggles) {
      const r = t.rect;
      if (px >= r.x - padX && px <= r.x + r.w + padX &&
          py >= r.y - padY && py <= r.y + r.h + padY) {
        return { name: t.name, value: t.value };
      }
    }
    return null;
  }

  // Touch pause affordance, top-right of the play field. Bounds are computed
  // the same way for drawing and for hit-testing so they always agree.
  pauseRect(world) {
    const size = 30;
    return { x: world.width - 14 - size, y: world.height * 0.18 + 12, w: size, h: size };
  }

  hitPause(world, px, py) {
    const r = this.pauseRect(world);
    const pad = 10; // generous touch target
    return px >= r.x - pad && px <= r.x + r.w + pad &&
           py >= r.y - pad && py <= r.y + r.h + pad;
  }

  _drawPauseButton(game) {
    const { ctx } = this;
    const r = this.pauseRect(game.world);
    ctx.save();
    ctx.globalAlpha = 0.5;
    this._roundRect(r.x, r.y, r.w, r.h, 7);
    ctx.fillStyle = COLORS.hudBand;
    ctx.fill();
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    this._roundRect(r.x, r.y, r.w, r.h, 7);
    ctx.stroke();

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = COLORS.textSecondary;
    const bw = 4, gap = 5, bh = r.h * 0.46;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.fillRect(cx - gap / 2 - bw, cy - bh / 2, bw, bh);
    ctx.fillRect(cx + gap / 2, cy - bh / 2, bw, bh);
    ctx.restore();
  }

  _drawPause(game) {
    const { ctx } = this;
    const w = game.world;
    this._scrim(game);

    const cx = w.width / 2;
    const cw = Math.min(w.width - 36, 360);
    const ch = 300;
    const top = Math.round(w.height / 2 - ch / 2);
    this._cardToggles = [];
    this._panel(cx - cw / 2, top, cw, ch);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.hero;
    ctx.font = mono(26, 'bold');
    ctx.fillText('PAUSED', cx, top + 42);

    ctx.fillStyle = COLORS.textTertiary;
    ctx.font = mono(11);
    ctx.fillText('the grind will wait. briefly.', cx, top + 68);

    this._drawCardToggles(w, cx, top + 104);

    this._resumeRect = this._button(cx, top + ch - 54, 'RESUME');
    this._drawHelpBadge(cx + cw / 2 - 28, top + 28);
    this._resetText();
  }

  // Returns true if a tap hit the pause card's RESUME button (with touch pad).
  hitResume(px, py) {
    const r = this._resumeRect;
    if (!r) return false;
    const pad = 8;
    return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
  }

  _drawDeathCard(game) {
    const { ctx } = this;
    const w = game.world;
    const cx = w.width / 2;
    const d = game.death || { eyebrow: '', line: '', sub: '' };
    this._scrim(game);

    const cw = Math.min(w.width - 36, 400);
    const ch = 350;
    const top = Math.round(w.height / 2 - ch / 2);
    this._panel(cx - cw / 2, top, cw, ch);

    // Eyebrow as an arcade tag, in the danger register.
    this._chip(cx, top + 32, d.eyebrow, ZONE.red);

    // The punchline + its subtext.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = mono(17, 'bold');
    const lineEnd = this._wrap(d.line, cx, top + 74, cw - 56, 23);

    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = mono(12);
    this._wrap(d.sub, cx, lineEnd + 24, cw - 60, 18);

    this._cardDivider(cx, top + 150, cw - 56);

    // Score, prominent and leading-zero.
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.textTertiary;
    ctx.font = mono(10, 'bold');
    ctx.fillText('FINAL SCORE', cx, top + 172);
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = mono(30, 'bold');
    ctx.fillText(String(game.score).padStart(6, '0'), cx, top + 200);

    // Rank reached (label + coral value, centered as one unit).
    ctx.font = mono(12, 'bold');
    const label = 'RANK  ';
    const wl = ctx.measureText(label).width;
    const wr = ctx.measureText(game.rank).width;
    const startX = cx - (wl + wr) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.textSecondary;
    ctx.fillText(label, startX, top + 228);
    ctx.fillStyle = COLORS.hero;
    ctx.fillText(game.rank, startX + wl, top + 228);
    ctx.textAlign = 'center';

    if (d.newBest) {
      ctx.fillStyle = COLORS.hero;
      ctx.font = mono(12, 'bold');
      ctx.fillText('★ NEW BEST ★', cx, top + 250);
    } else {
      ctx.fillStyle = COLORS.textTertiary;
      ctx.font = mono(11);
      ctx.fillText(`BEST  ${String(d.best).padStart(6, '0')}`, cx, top + 250);
    }

    this._button(cx, top + ch - 62, game.lives > 0 ? 'GET BACK TO IT' : 'START OVER');
    this._drawHelpBadge(cx + cw / 2 - 28, top + 28);
    this._resetText();
  }

  // --- Card primitives -------------------------------------------------------
  _panel(x, y, w, h) {
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = COLORS.hudBand;
    this._roundRect(x, y, w, h, 16);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    this._roundRect(x, y, w, h, 16);
    ctx.stroke();
  }

  _chip(cx, y, label, color) {
    const { ctx } = this;
    ctx.font = mono(12, 'bold');
    const h = 22;
    const cw = ctx.measureText(label).width + 22;
    const x = cx - cw / 2;
    ctx.fillStyle = this._tint(color, 0.14);
    this._roundRect(x, y - h / 2, cw, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    this._roundRect(x, y - h / 2, cw, h, h / 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, y + 0.5);
  }

  _button(cx, y, label) {
    const { ctx } = this;
    ctx.font = mono(15, 'bold');
    const bw = Math.max(208, ctx.measureText(label).width + 56);
    const bh = 46;
    this._roundRect(cx - bw / 2, y, bw, bh, bh / 2);
    ctx.fillStyle = COLORS.hero;
    ctx.fill();
    ctx.fillStyle = COLORS.onAccent;     // dark text on coral, both themes
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, y + bh / 2 + 0.5);
    return { x: cx - bw / 2, y, w: bw, h: bh };
  }

  _cardDivider(cx, y, lineW) {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - lineW / 2, y);
    ctx.lineTo(cx + lineW / 2, y);
    ctx.stroke();
  }

  _mascotHalf() {
    const phase = (Math.sin(this.chompClock * CHOMP.cyclesPerSec * TAU) + 1) / 2;
    return (CHOMP.minOpenDeg + (CHOMP.maxOpenDeg - CHOMP.minOpenDeg) * phase) * (Math.PI / 180);
  }

  _tint(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  _scrim(game) {
    const { ctx } = this;
    ctx.fillStyle = COLORS.scrim;
    ctx.fillRect(0, 0, game.world.width, game.world.height);
  }

  _resetText() {
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'alphabetic';
  }

  // Word-wrap centered text; returns the final baseline y used.
  _wrap(text, cx, y, maxW, lh, draw = true) {
    const { ctx } = this;
    const words = String(text).split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        if (draw) ctx.fillText(line, cx, yy);
        line = word;
        yy += lh;
      } else {
        line = test;
      }
    }
    if (line && draw) ctx.fillText(line, cx, yy);
    return yy;
  }
}
