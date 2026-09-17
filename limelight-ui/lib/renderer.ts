/**
 * Canvas 2D rendering for the Limelight stage preview.
 * All functions are pure — they take a context and data, never global state.
 *
 * WHAT CHANGED AND WHY
 * This used to know two shapes: a par (a glow and a floor pool) and a head (a
 * three-layer cone). Every rig therefore looked the same, and a rig carrying a
 * beam, a wash, a blinder and a pixel strip drew as rows of identical dots.
 *
 * A lamp is now drawn from what it IS. The cone width comes from the fixture's
 * real beam angle — read out of its GDTF and carried in lib/profiles.ts — so a
 * 8° beam is a pencil and a 60° par is a flood, because those are the numbers
 * the manufacturers publish. Depth comes from the layout's own coordinates, so a
 * rig with a back truss and a front truss reads as a room instead of a row.
 */

import type { FixtureStates, LampState } from "./types";
import { GAMMA, TAU, DEG, PAN_CENTRE, PAN_DEG_PER_DMX, TILT_WALL, TILT_WALL_EL, TILT_DEG_PER_DMX, wheelAt } from "./dmx.ts";
import { clamp } from "./grid.ts";
import { profileOf, moves } from "./profiles.ts";
import { frameLight } from "./exposure.ts";

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function rgba(c: number[] | readonly number[], a: number): string {
  return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${Math.max(0, a).toFixed(3)})`;
}

function toWhite(c: number[] | readonly number[], t: number): number[] {
  if (t <= 0) return [...c];
  return [...c].map((v) => v + (1 - v) * Math.min(1, t));
}

/** How much of the frame a beam of this angle covers at the far end of its throw. */
function spread(deg: number): number {
  return Math.tan(Math.min(80, deg) * 0.5 * DEG);
}

/**
 * A strobing lamp is DARK most of the time — that is what makes it read as a
 * strobe rather than as a bright lamp. Gating on the frame clock rather than on
 * the DMX value is the only way a still preview and a running one agree.
 */
function strobeGate(l: LampState, t: number): number {
  if (l.strobe <= 0.001) return 1;
  const hz = 1 + l.strobe * 22;
  const phase = (t * hz) % 1;
  return phase < 0.32 ? 1 : 0.06;
}

/* ── quality ─────────────────────────────────────────────────────────────── */

export interface PaintOpts {
  /** seconds, for strobe and laser motion. Defaults to 0 (a still frame). */
  t?: number;
  /**
   * "full" is the stage view. "card" drops the costly passes — reflection,
   * bloom, per-cone layering — so a page of venue cards stays smooth.
   */
  quality?: "full" | "card";
}


/* ── glow sprites ────────────────────────────────────────────────────────────
   THE HOT PATH. Every soft round thing in here — a par's halo, its core, a
   floor pool, a lens, a strobe flash, a blinder's bloom, a strip cell — used to
   be a fresh `createRadialGradient` plus `arc` plus `fill`. Measured on the
   46-fixture arena that is 515 gradients and 1841 addColorStop calls PER FRAME:
   about 31,000 gradient objects a second at 60fps, each one allocating and
   rebuilding a colour ramp that is identical to the last.

   A gradient's SHAPE never changes — only its colour and its overall strength.
   So each shape is rendered once into an offscreen canvas, tinted per colour on
   first use, and afterwards drawn with one `drawImage`. Strength rides on
   globalAlpha, which is free.

   Falls back to real gradients where there is no DOM (tests, SSR). */

type Ramp = "halo" | "core" | "pool" | "lens" | "flash";

/** stop positions and alphas that describe each shape, baked once */
const RAMPS: Record<Ramp, Array<[number, number]>> = {
  halo:  [[0, 1], [0.18, 0.66], [0.42, 0.30], [0.70, 0.09], [1, 0]],
  core:  [[0, 1], [0.34, 0.62], [0.62, 0.22], [1, 0]],
  pool:  [[0, 1], [0.30, 0.44], [0.62, 0.14], [1, 0]],
  lens:  [[0, 1], [0.46, 0.86], [1, 0]],
  flash: [[0, 1], [0.16, 0.50], [0.46, 0.16], [1, 0]],
};

const SPRITE = 128;
const sprites = new Map<string, HTMLCanvasElement>();

function canDraw(): boolean {
  return typeof document !== "undefined";
}

/** the shape, in one colour. Cached; the key quantises colour to 16 levels. */
function sprite(ramp: Ramp, c: readonly number[]): HTMLCanvasElement | null {
  if (!canDraw()) return null;
  const q = (v: number) => Math.max(0, Math.min(15, Math.round(v * 15)));
  const key = `${ramp}:${q(c[0])},${q(c[1])},${q(c[2])}`;
  const hit = sprites.get(key);
  if (hit) return hit;

  const cv = document.createElement("canvas");
  cv.width = cv.height = SPRITE;
  const g2 = cv.getContext("2d");
  if (!g2) return null;
  const r = SPRITE / 2;
  const g = g2.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, a] of RAMPS[ramp]) g.addColorStop(at, rgba(c, a));
  g2.fillStyle = g;
  g2.fillRect(0, 0, SPRITE, SPRITE);

  /* a runaway cache is a leak; colours repeat heavily, so a small cap is plenty */
  if (sprites.size > 384) sprites.clear();
  sprites.set(key, cv);
  return cv;
}

/**
 * One soft round light. `a` is the peak alpha; the shape comes from `ramp`.
 * `squash` flattens it into the ellipse a floor pool makes.
 */
function glow(
  ctx: CanvasRenderingContext2D, ramp: Ramp,
  x: number, y: number, r: number,
  c: readonly number[], a: number, squash = 1,
): void {
  if (a <= 0.002 || r <= 0.4) return;
  const sp = sprite(ramp, c);
  if (!sp) {                                   // no DOM: the old path, still correct
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [at, al] of RAMPS[ramp]) g.addColorStop(at, rgba(c, al * a));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * squash, 0, 0, TAU);
    ctx.fill();
    return;
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sp, x - r, y - r * squash, r * 2, r * 2 * squash);
  ctx.globalAlpha = prev;
}

/* ── ground: the room the rig is hanging in ──────────────────────────────── */

export function ground(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.globalCompositeOperation = "source-over";
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.98, 0, W * 0.5, H * 0.98, Math.max(W, H) * 1.05);
  bg.addColorStop(0, "#101527");
  bg.addColorStop(0.7, "#07090f");
  bg.addColorStop(1, "#07090f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const y = H * FLOOR;
  const fg = ctx.createLinearGradient(0, y, 0, H);
  fg.addColorStop(0, "rgba(9,11,19,0.5)");
  fg.addColorStop(0.7, "rgba(7,9,15,0.94)");
  ctx.fillStyle = fg;
  ctx.fillRect(0, y, W, H - y);

  const hair = ctx.createLinearGradient(0, 0, W, 0);
  hair.addColorStop(0, "rgba(200,210,240,0)");
  hair.addColorStop(0.12, "rgba(200,210,240,0.13)");
  hair.addColorStop(0.88, "rgba(200,210,240,0.13)");
  hair.addColorStop(1, "rgba(200,210,240,0)");
  ctx.fillStyle = hair;
  ctx.fillRect(0, y, W, 1);
}

const FLOOR = 0.86;

/* ── truss: the steel the lamps hang off ─────────────────────────────────────
   Lamps that share a height and a depth are on the same bar. Drawing the bar
   costs one hairline and is the difference between "a rig" and "some dots". */

function truss(ctx: CanvasRenderingContext2D, lamps: LampState[], W: number, H: number): void {
  const bars = new Map<string, LampState[]>();
  for (const l of lamps) {
    const key = `${l.height.toFixed(3)}:${l.depth.toFixed(3)}`;
    const b = bars.get(key);
    if (b) b.push(l); else bars.set(key, [l]);
  }
  ctx.globalCompositeOperation = "source-over";
  for (const bar of bars.values()) {
    if (bar.length < 2) continue;
    const xs = bar.map((l) => l.x);
    const y = H * bar[0].y;
    const x0 = W * Math.min(...xs);
    const x1 = W * Math.max(...xs);
    const a = 0.10 + 0.10 * bar[0].depth;
    ctx.strokeStyle = `rgba(150,164,196,${a.toFixed(3)})`;
    ctx.lineWidth = Math.max(1, 2.4 * bar[0].scale);
    ctx.beginPath();
    ctx.moveTo(x0 - 10, y);
    ctx.lineTo(x1 + 10, y);
    ctx.stroke();
    /* the chord underneath, so the bar reads as truss rather than as wire */
    ctx.strokeStyle = `rgba(150,164,196,${(a * 0.45).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 - 10, y + 4 * bar[0].scale);
    ctx.lineTo(x1 + 10, y + 4 * bar[0].scale);
    ctx.stroke();
  }
}

/* ── housing: the dark lamp body ─────────────────────────────────────────── */

export function housing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "#0d0f18");
  g.addColorStop(0.72, "#141722");
  g.addColorStop(1, "rgba(30,34,48,0.85)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/* ── emitter: the lit face ───────────────────────────────────────────────── */

export function emitter(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: number[] | readonly number[], k: number): void {
  if (k <= 0.004) return;
  glow(ctx, "lens", x, y, r, toWhite(c, k * 0.55), k);
}

/** A bright lens throws a horizontal streak across the lens of the camera. */
function bloom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: readonly number[], k: number): void {
  if (k < 0.55) return;
  const a = (k - 0.55) / 0.45;
  const g = ctx.createLinearGradient(x - r * 6, y, x + r * 6, y);
  g.addColorStop(0, rgba(c, 0));
  g.addColorStop(0.5, rgba(toWhite(c, 0.5), 0.20 * a));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 6, y - r * 0.22, r * 12, r * 0.44);
}

/* ── the floor pool a downward lamp lays on the deck ─────────────────────── */

function pool(ctx: CanvasRenderingContext2D, x: number, yFloor: number, rx: number, c: readonly number[], k: number): void {
  if (k <= 0.01) return;
  glow(ctx, "pool", x, yFloor, rx, c, 0.05 + 0.34 * k, 0.32);
}

/* ── cone: the lit air between a lamp and whatever it lands on ───────────────
   THE CONVENTION, because getting it wrong is invisible until a pool lands on the
   ceiling: a cone is drawn up the -y axis and then rotated by `rot`, so rot = 0
   points at the top of the frame and rot = PI points at the floor. Everything
   that needs to know WHERE a beam lands must derive it the same way, which is
   what `landing()` is for. */

function landing(l: LampState, x: number, y: number, L: number): { x: number; y: number } {
  return { x: x + Math.sin(l.rot) * L, y: y - Math.cos(l.rot) * L };
}

/**
 * How far a beam travels before it lands.
 *
 * A shaft that runs off the bottom of the frame reads as a smear; a shaft that
 * stops on the deck reads as a beam hitting a floor. So the throw is the
 * distance to the floor plane along the beam, and only a beam pointing at or
 * above the horizon gets to run to the edge instead.
 */
function throwTo(l: LampState, y: number, H: number, max: number): number {
  const down = -Math.cos(l.rot);
  if (down <= 0.08) return max;
  return Math.min(max, Math.max(H * 0.06, (H * FLOOR - y) / down));
}

function cone(ctx: CanvasRenderingContext2D, wRoot: number, wEnd: number, L: number): void {
  ctx.beginPath();
  ctx.moveTo(-wRoot, 0);
  ctx.lineTo(wRoot, 0);
  ctx.lineTo(wEnd, -L);
  ctx.lineTo(-wEnd, -L);
  ctx.closePath();
  ctx.fill();
}


/* ── beam sprites ────────────────────────────────────────────────────────────
   Same trick as the glows, for the shafts. A cone is three nested trapezoids
   with a lengthwise ramp, and the SHAPE is identical every frame — only the
   colour, the length and the strength change. So the three layers are baked
   once into a unit sprite (apex at the bottom, far end at the top) and then
   stretched to whatever length and spread the beam needs.

   `hard` is the difference between a beam and a wash: a wash has no edge, a
   beam has a bright core and a sharp one. */
const beams = new Map<string, HTMLCanvasElement>();
const BEAM_W = 96;
const BEAM_H = 192;

function beamSprite(c: readonly number[], hard: boolean): HTMLCanvasElement | null {
  if (!canDraw()) return null;
  const q = (v: number) => Math.max(0, Math.min(15, Math.round(v * 15)));
  const key = `${hard ? "b" : "w"}:${q(c[0])},${q(c[1])},${q(c[2])}`;
  const hit = beams.get(key);
  if (hit) return hit;

  const cv = document.createElement("canvas");
  cv.width = BEAM_W;
  cv.height = BEAM_H;
  const g2 = cv.getContext("2d");
  if (!g2) return null;
  g2.globalCompositeOperation = "lighter";

  const layers: Array<[number, number]> = hard
    ? [[1.0, 0.13], [0.48, 0.34], [0.19, 0.62]]    // halo, body, core
    : [[1.0, 0.11], [0.67, 0.26], [0.37, 0.40]];
  const mid = BEAM_W / 2;
  for (const [wMul, weight] of layers) {
    const g = g2.createLinearGradient(0, BEAM_H, 0, 0);   // apex -> far end
    g.addColorStop(0, rgba(c, weight));
    g.addColorStop(0.22, rgba(c, weight * 0.62));
    g.addColorStop(0.55, rgba(c, weight * 0.24));
    g.addColorStop(1, rgba(c, 0));
    g2.fillStyle = g;
    const half = mid * wMul;
    g2.beginPath();
    g2.moveTo(mid - 1.5, BEAM_H);
    g2.lineTo(mid + 1.5, BEAM_H);
    g2.lineTo(mid + half, 0);
    g2.lineTo(mid - half, 0);
    g2.closePath();
    g2.fill();
  }

  if (beams.size > 192) beams.clear();
  beams.set(key, cv);
  return cv;
}

/** A shaft from (x, y) along `rot`, `L` long, `wEnd` wide at the far end. */
function shaft(
  ctx: CanvasRenderingContext2D, x: number, y: number, rot: number,
  L: number, wEnd: number, c: readonly number[], a: number, hard: boolean,
): void {
  if (a <= 0.002 || L <= 1) return;
  const sp = beamSprite(c, hard);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (sp) {
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(sp, -wEnd, -L, wEnd * 2, L);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.5, rgba(c, a * 0.4));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    cone(ctx, Math.max(1, wEnd * 0.05), wEnd, L);
  }
  ctx.restore();
}

/* ── the shapes ──────────────────────────────────────────────────────────────
   One function per kind. They all take the lamp already gated and trimmed. */

/** A par: no aim, a wide soft wash straight down, and a pool on the deck. */
function drawPar(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, k: number, full: boolean, d: number): void {
  const x = W * l.x, y = H * l.y, c = l.rgb;
  const s = spread(l.spreadDeg) * l.scale;

  const R = u * (0.34 + 0.9 * s) * (0.5 + 0.65 * k);
  const a = (0.09 + 0.30 * k) * d;
  let g = ctx.createRadialGradient(x, y - u * 0.02, 0, x, y - u * 0.02, R);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(0.18, rgba(c, a * 0.66));
  g.addColorStop(0.42, rgba(c, a * 0.3));
  g.addColorStop(0.7, rgba(c, a * 0.09));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - u * 0.02, R, 0, TAU);
  ctx.fill();

  const R2 = u * 0.2 * l.scale * (0.5 + 0.8 * k);
  const a2 = (0.14 + 0.5 * k) * d;
  g = ctx.createRadialGradient(x, y, 0, x, y, R2);
  g.addColorStop(0, rgba(toWhite(c, Math.max(0, k - 0.72) / 0.28), a2));
  g.addColorStop(0.34, rgba(c, a2 * 0.62));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, R2, 0, TAU);
  ctx.fill();

  if (full) pool(ctx, x, H * FLOOR, u * (0.14 + 0.55 * s) * (0.6 + 0.6 * k), c, k);
}

/** A wash: a soft cone whose width is the zoom channel, landing in a big pool. */
function drawWash(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, k: number, full: boolean, d: number): void {
  const x = W * l.x, y = H * l.y, c = l.rgb;
  const L = throwTo(l, y, H, u * 1.45 * l.scale * Math.max(0.28, l.reach));
  const s = spread(l.spreadDeg);

  shaft(ctx, x, y, l.rot, L, Math.max(1, L * s), toWhite(c, Math.max(0, k - 0.7) / 0.3),
        (0.09 + 0.5 * k) * d, false);

  if (full) {
    const at = landing(l, x, y, L * 0.9);
    if (at.y > y) pool(ctx, at.x, Math.min(at.y, H * FLOOR), L * s * 1.3, c, k * 0.8);
  }
}

/** A beam: hard edge, bright core, gobo banding, and a prism that splits it. */
function drawSpot(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, k: number, full: boolean, d: number): void {
  const x = W * l.x, y = H * l.y, c = l.rgb;
  const L = throwTo(l, y, H, u * 1.9 * l.scale * Math.max(0.3, l.reach));
  const s = spread(l.spreadDeg);
  const arms = l.prism ? [-0.12, 0, 0.12] : [0];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(l.rot);
  for (const off of arms) {
    ctx.save();
    ctx.rotate(off);
    const weight = l.prism ? 0.62 : 1;
    shaft(ctx, 0, 0, 0, L, Math.max(1, L * s * 1.6),
          toWhite(c, Math.max(0, k - 0.55) / 0.45), (0.1 + 0.66 * k) * weight * d, true);
    /* a gobo breaks the shaft into bands of light and shadow */
    if (full && l.gobo > 20 && k > 0.1) {
      const bands = 5 + (l.gobo % 5);
      ctx.fillStyle = rgba(toWhite(c, 0.3), 0.06 + 0.1 * k);
      for (let i = 1; i < bands; i += 2) {
        const d = (i / bands) * L;
        const w = Math.max(1, L * s * 1.25 * (d / L));
        ctx.fillRect(-w, -d, w * 2, L / (bands * 2.6));
      }
    }
    ctx.restore();
  }
  ctx.restore();

  if (full) {
    const at = landing(l, x, y, L);
    if (at.y > y) pool(ctx, at.x, Math.min(at.y, H * FLOOR), Math.max(u * 0.02, L * s * 2.2), c, k);
  }
}

/** A xenon strobe: a flat sheet of white that fills its arc and snaps. */
function drawStrobe(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, k: number, d: number): void {
  const x = W * l.x, y = H * l.y, c = l.rgb;
  const R = u * 1.25 * (0.4 + 0.7 * k);
  glow(ctx, "flash", x, y, R, toWhite(c, 0.6), (0.1 + 0.46 * k) * d);
}

/** A blinder: pointed at the audience, so it glares at the camera rather than lighting the stage. */
function drawBlinder(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, k: number, full: boolean, d: number): void {
  const x = W * l.x, y = H * l.y, c = l.rgb;
  const w = u * 0.14 * l.scale;
  const h = u * 0.055 * l.scale;

  /* the four cells of the array, as a lit panel */
  ctx.fillStyle = rgba(toWhite(c, 0.55 * k), 0.2 + 0.72 * k);
  for (let i = 0; i < 4; i++) {
    const cx = x - w * 0.5 + (w / 4) * (i + 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, y, w * 0.11, h * 0.5, 0, 0, TAU);
    ctx.fill();
  }

  const R = u * 1.5 * (0.3 + 0.8 * k);
  glow(ctx, "flash", x, y, R, toWhite(c, 0.4), (0.06 + 0.4 * k) * d);

  /* a blinder at full does not light a room, it takes it over */
  if (full && k > 0.5) {
    ctx.fillStyle = rgba(c, (k - 0.5) * 0.12);
    ctx.fillRect(0, 0, W, H);
  }
}

/** A pixel strip: one bar, six cells, each its own colour. */
function drawStrip(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, gate: number): void {
  const cells = l.cells ?? [{ k: l.k, rgb: l.rgb }];
  const x = W * l.x;
  const span = u * 0.42 * l.scale;
  const y0 = H * l.y - span * 0.5;
  const step = span / cells.length;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const k = cell.k * gate;
    if (k <= 0.01) continue;
    const cy = y0 + step * (i + 0.5);
    const R = u * 0.16 * l.scale * (0.4 + 0.8 * k);
    glow(ctx, "core", x, cy, R, toWhite(cell.rgb, k * 0.6), 0.1 + 0.44 * k);
    emitter(ctx, x, cy, Math.max(2, step * 0.3), cell.rgb, k);
  }
}

/** A laser: no falloff to speak of, so it draws as a line rather than a cone. */
function drawLaser(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, k: number, t: number, d: number): void {
  const x = W * l.x, y = H * l.y, c = l.rgb;
  const L = throwTo(l, y, H, u * 2.2);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(l.rot);
  /* a scanner is one beam moving fast enough to read as a fan */
  for (let i = -3; i <= 3; i++) {
    const a = (0.06 + 0.5 * k) * (1 - Math.abs(i) / 4.5) * d;
    const off = i * 0.055 + Math.sin(t * 2.1 + i) * 0.02;
    ctx.save();
    ctx.rotate(off);
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, rgba(toWhite(c, 0.5), a));
    g.addColorStop(0.55, rgba(c, a * 0.5));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    cone(ctx, Math.max(0.6, u * 0.003), Math.max(0.8, u * 0.006), L);
    ctx.restore();
  }
  ctx.restore();
}

/* ── one lamp ────────────────────────────────────────────────────────────── */

function drawLamp(ctx: CanvasRenderingContext2D, l: LampState, W: number, H: number, u: number, opts: { t: number; full: boolean; d: number }): void {
  const gate = strobeGate(l, opts.t);
  const k = l.k * gate;
  if (k <= 0.004 && l.kind !== "strip") return;
  const d = opts.d;

  switch (l.kind) {
    case "wash":    drawWash(ctx, l, W, H, u, k, opts.full, d); break;
    case "spot":    drawSpot(ctx, l, W, H, u, k, opts.full, d); break;
    case "strobe":  drawStrobe(ctx, l, W, H, u, k, d); break;
    case "blinder": drawBlinder(ctx, l, W, H, u, k, opts.full, d); break;
    case "strip":   drawStrip(ctx, l, W, H, u, gate); break;
    case "laser":   drawLaser(ctx, l, W, H, u, k, opts.t, d); break;
    default:        drawPar(ctx, l, W, H, u, k, opts.full, d); break;
  }

  if (l.kind !== "strip" && l.kind !== "blinder") {
    const r = Math.max(3, u * (moves(l.type) ? 0.022 : 0.017) * l.scale);
    emitter(ctx, W * l.x, H * l.y, r, l.rgb, k);
    if (opts.full) bloom(ctx, W * l.x, H * l.y, r, l.rgb, k);
  }
}

/* ── paintStage: full frame render ───────────────────────────────────────── */

export function paintStage(
  ctx: CanvasRenderingContext2D,
  fx: FixtureStates,
  W: number,
  H: number,
  dpr: number,
  opts: PaintOpts = {},
): void {
  const u = H;
  const t = opts.t ?? 0;
  const full = opts.quality !== "card";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ground(ctx, W, H);

  const lamps = fx.lamps ?? [];

  /* structure first, opaque, so light lands on top of steel rather than under it */
  truss(ctx, lamps, W, H);
  for (const l of lamps) {
    if (l.kind === "strip") continue;                    // a strip has no round body
    housing(ctx, W * l.x, H * l.y, Math.max(3, u * 0.019 * l.scale));
  }

  ctx.globalCompositeOperation = "lighter";

  /* The air, and how hard to drive it. Both numbers come from lib/exposure.ts
     because the 3D view needs exactly the same ones — see the note in that file
     for what happened when each view worked them out for itself. */
  const { output, density } = frameLight(lamps);

  if (output > 0.004) {
    const haze = ctx.createRadialGradient(W * 0.5, H * 0.58, 0, W * 0.5, H * 0.58, Math.max(W, H) * 0.62);
    const a = clamp(output * 0.3 * (0.5 + 0.5 * density), 0, 0.13);
    haze.addColorStop(0, `rgba(150,170,230,${a.toFixed(3)})`);
    haze.addColorStop(1, "rgba(150,170,230,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);
  }

  /* back to front, so a near truss reads in front of a far one */
  for (const l of lamps) drawLamp(ctx, l, W, H, u, { t, full, d: density });

  /* the deck is not matte: the pools come back up, squashed and dim */
  if (full) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, H * FLOOR, W, H * (1 - FLOOR));
    ctx.clip();
    ctx.translate(0, 2 * H * FLOOR);
    ctx.scale(1, -0.42);
    ctx.globalAlpha = 0.3;
    for (const l of lamps) {
      if (l.kind === "laser" || l.kind === "blinder") continue;
      drawLamp(ctx, l, W, H, u, { t, full: false, d: density });
    }
    ctx.restore();
  }

  ctx.globalCompositeOperation = "source-over";
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  top.addColorStop(0, "rgba(8,10,18,0.42)");
  top.addColorStop(1, "rgba(8,10,18,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.3);
}

/* ── miniFrame: thumbnail render for marketplace live previews ───────────────
   Reads raw DMX rather than a FixtureStates, because the marketplace has frames
   and a placement but never bakes a full state. Kept on the same profile table,
   so a listing of a show made on the arena rig draws its real fixtures. */

export function miniFrame(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  idx: number,
  frames: Uint8Array,
  channels: number,
  place: { lamps: Array<{ addr: number; type: string; x: number; y: number; scale: number; kind: string }> },
): void {
  const W = cv.width;
  const H = cv.height;
  const base = idx * channels;
  const f = frames;

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#07090f";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(9,11,19,0.55)";
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
  ctx.globalCompositeOperation = "lighter";

  const u = H;
  for (const p of place.lamps ?? []) {
    const prof = profileOf(p.type);
    const i = base + p.addr - 1;
    if (i < 0 || i >= f.length) continue;

    let rgbv: [number, number, number] = [1, 1, 1];
    let k = 0;
    const a = prof.at;
    if (a.r !== undefined && a.g !== undefined && a.b !== undefined) {
      const r = f[i + a.r], g = f[i + a.g], b = f[i + a.b];
      const peak = Math.max(r, g, b);
      if (peak) rgbv = [r / peak, g / peak, b / peak];
      k = prof.brightness === "colour"
        ? Math.pow(peak / 255, 1 / GAMMA)
        : Math.pow(f[i + (a.master ?? 0)] / 255, 1 / GAMMA);
    } else if (a.wheel !== undefined) {
      rgbv = wheelAt(f[i + a.wheel]).rgb;
      k = Math.pow(f[i + (a.master ?? 0)] / 255, 1 / GAMMA);
    } else if (a.c !== undefined && a.m !== undefined && a.y !== undefined) {
      rgbv = [1 - f[i + a.c] / 255, 1 - f[i + a.m] / 255, 1 - f[i + a.y] / 255];
      k = Math.pow(f[i + (a.master ?? 0)] / 255, 1 / GAMMA);
    } else {
      rgbv = [1, 0.93, 0.82];
      k = Math.pow(f[i + (a.master ?? 0)] / 255, 1 / GAMMA);
    }
    if (k < 0.01) continue;

    const x = W * p.x, y = H * p.y;

    if (a.pan !== undefined && a.tilt !== undefined) {
      const panC = a.panFine !== undefined ? (f[i + a.pan] * 256 + f[i + a.panFine]) / 256 : f[i + a.pan];
      const tiltC = a.tiltFine !== undefined ? (f[i + a.tilt] * 256 + f[i + a.tiltFine]) / 256 : f[i + a.tilt];
      const az = (panC - PAN_CENTRE) * PAN_DEG_PER_DMX * DEG;
      const el = (TILT_WALL_EL + (tiltC - TILT_WALL) * TILT_DEG_PER_DMX) * DEG;
      const ax = Math.sin(az) * Math.cos(el);
      const ay = Math.sin(el);
      const L = u * 1.4 * Math.hypot(ax, ay);
      const s = spread(prof.beamDeg[0]);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(ax, ay));
      const grad = ctx.createLinearGradient(0, 0, 0, -L);
      grad.addColorStop(0, rgba(rgbv, 0.16 + 0.42 * k));
      grad.addColorStop(1, rgba(rgbv, 0));
      ctx.fillStyle = grad;
      cone(ctx, u * 0.02, Math.max(1, L * s * 1.6), L);
      ctx.restore();
    } else {
      const R = u * (0.3 + 0.9 * spread(prof.beamDeg[0])) * (0.45 + 0.6 * k);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
      grad.addColorStop(0, rgba(rgbv, 0.1 + 0.42 * k));
      grad.addColorStop(0.3, rgba(rgbv, (0.1 + 0.42 * k) * 0.45));
      grad.addColorStop(1, rgba(rgbv, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = "source-over";
}
