/**
 * Canvas 2D rendering for the Limelight stage preview.
 * All functions are pure — they take a context and data, never global state.
 *
 * Ported from portal/app.js drawing functions.
 */

import type { FixtureStates, ParState, HeadState, FixturePlacement } from "./types";
import { GAMMA, TAU, DEG, PAN_CENTRE, PAN_DEG_PER_DMX, TILT_WALL, TILT_WALL_EL, TILT_DEG_PER_DMX, wheelAt } from "./dmx";
import { clamp } from "./grid";

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function rgba(c: number[] | readonly number[], a: number): string {
  return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${Math.max(0, a).toFixed(3)})`;
}

function toWhite(c: number[], t: number): number[] {
  if (t <= 0) return c;
  return c.map((v) => v + (1 - v) * Math.min(1, t));
}

/* ── ground: dark stage background ───────────────────────────────────────── */

export function ground(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.globalCompositeOperation = "source-over";
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.98, 0, W * 0.5, H * 0.98, Math.max(W, H) * 1.05);
  bg.addColorStop(0, "#101527");
  bg.addColorStop(0.7, "#07090f");
  bg.addColorStop(1, "#07090f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const y = H * 0.79;
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

export function emitter(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: number[], k: number): void {
  if (k <= 0.004) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(toWhite(c, k * 0.75), k));
  g.addColorStop(0.46, rgba(c, k));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/* ── drawPar: par wash + floor pool ──────────────────────────────────────── */

export function drawPar(ctx: CanvasRenderingContext2D, p: ParState, W: number, H: number, u: number, n: number): void {
  const scale = n > 6 ? 0.55 : 1;
  const x = W * p.x;
  const y = H * p.y;
  const c = [...p.rgb];
  const k = p.k;

  if (k > 0.004) {
    const cy = y - u * 0.02;
    const R = u * 0.62 * scale * (0.5 + 0.65 * k);
    const a = 0.1 + 0.34 * k;
    let g = ctx.createRadialGradient(x, cy, 0, x, cy, R);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(0.18, rgba(c, a * 0.66));
    g.addColorStop(0.42, rgba(c, a * 0.3));
    g.addColorStop(0.7, rgba(c, a * 0.09));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, cy, R, 0, TAU);
    ctx.fill();

    const R2 = u * 0.24 * scale * (0.5 + 0.8 * k);
    const a2 = 0.14 + 0.52 * k;
    g = ctx.createRadialGradient(x, y, 0, x, y, R2);
    g.addColorStop(0, rgba(toWhite(c, Math.max(0, k - 0.72) / 0.28), a2));
    g.addColorStop(0.34, rgba(c, a2 * 0.62));
    g.addColorStop(0.62, rgba(c, a2 * 0.22));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R2, 0, TAU);
    ctx.fill();

    /* floor pool */
    const ry = u * 0.15 * scale;
    const rx = u * 0.42 * scale;
    const fy = y + u * 0.085;
    g = ctx.createRadialGradient(x, fy, 0, x, fy, rx);
    const a3 = 0.05 + 0.34 * k;
    g.addColorStop(0, rgba(c, a3));
    g.addColorStop(0.3, rgba(c, a3 * 0.44));
    g.addColorStop(0.62, rgba(c, a3 * 0.14));
    g.addColorStop(1, rgba(c, 0));
    ctx.save();
    ctx.translate(x, fy);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -fy);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, fy, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  emitter(ctx, x, y, n > 6 ? 8 : 11, c, k);
}

/* ── cone helper ─────────────────────────────────────────────────────────── */

function cone(ctx: CanvasRenderingContext2D, wBottom: number, wTop: number, L: number): void {
  ctx.beginPath();
  ctx.moveTo(-wBottom, 0);
  ctx.lineTo(wBottom, 0);
  ctx.lineTo(wTop, -L);
  ctx.lineTo(-wTop, -L);
  ctx.closePath();
  ctx.fill();
}

/* ── drawBeam: moving head beam ──────────────────────────────────────────── */

export function drawBeam(ctx: CanvasRenderingContext2D, h: HeadState, W: number, H: number, u: number, n: number): void {
  const scale = n > 1 ? 0.7 : 1;
  const x = W * h.x;
  const y = H * h.y;
  const c = [...h.rgb];
  const k = h.k;

  if (k > 0.004) {
    const L = Math.max(u * 0.12, u * 1.7 * scale * h.reach);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(h.rot);

    const layers: [number, number, number][] = [
      [0.34, 0.13, u * 0.034],
      [0.17, 0.3, u * 0.022],
      [0.07, 0.52, u * 0.012],
    ];
    for (const [spread, weight, root] of layers) {
      const a = (0.1 + 0.62 * k) * weight;
      const g = ctx.createLinearGradient(0, 0, 0, -L);
      g.addColorStop(0, rgba(toWhite(c, Math.max(0, k - 0.7) / 0.3), a));
      g.addColorStop(0.22, rgba(c, a * 0.62));
      g.addColorStop(0.55, rgba(c, a * 0.24));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      cone(ctx, root, L * spread, L);
    }
    ctx.restore();
  }

  emitter(ctx, x, y, 12, c, k);
}

/* ── paintStage: full frame render ───────────────────────────────────────── */

export function paintStage(ctx: CanvasRenderingContext2D, fx: FixtureStates, W: number, H: number, dpr: number): void {
  const u = H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ground(ctx, W, H);

  /* housings first (opaque, non-light) */
  const small = fx.pars.length > 6;
  for (const p of fx.pars) housing(ctx, W * p.x, H * p.y, small ? 6 : 9);
  for (const h of fx.heads) housing(ctx, W * h.x, H * h.y, small ? 7 : 10);

  ctx.globalCompositeOperation = "lighter";

  const total = fx.pars.reduce((a, p) => a + p.k, 0) / Math.max(1, fx.pars.length);
  const headK = fx.heads.reduce((a, h) => a + h.k, 0) / Math.max(1, fx.heads.length);

  if (total > 0.01 || headK > 0.01) {
    const haze = ctx.createRadialGradient(W * 0.5, H * 0.62, 0, W * 0.5, H * 0.62, Math.max(W, H) * 0.6);
    const a = clamp(total * 0.09 + headK * 0.05, 0, 0.16);
    haze.addColorStop(0, `rgba(150,170,230,${a.toFixed(3)})`);
    haze.addColorStop(1, "rgba(150,170,230,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);
  }

  for (const h of fx.heads) drawBeam(ctx, h, W, H, u, fx.heads.length);
  for (const p of fx.pars) drawPar(ctx, p, W, H, u, fx.pars.length);

  ctx.globalCompositeOperation = "source-over";
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.34);
  top.addColorStop(0, "rgba(8,10,18,0.4)");
  top.addColorStop(1, "rgba(8,10,18,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.34);
}

/* ── miniFrame: thumbnail render for marketplace live previews ───────────── */

export function miniFrame(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  idx: number,
  frames: Uint8Array,
  channels: number,
  place: FixturePlacement,
): void {
  const W = cv.width;
  const H = cv.height;
  const base = idx * channels;
  const f = frames;

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#07090f";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(9,11,19,0.55)";
  ctx.fillRect(0, H * 0.8, W, H * 0.2);
  ctx.globalCompositeOperation = "lighter";

  const u = H;
  for (const p of place.pars) {
    const i = base + p.addr - 1;
    const r = f[i + 1];
    const gg = f[i + 2];
    const b = f[i + 3];
    const peak = Math.max(r, gg, b);
    if (!peak) continue;
    const k = Math.pow(peak / 255, 1 / GAMMA);
    const c = [r / peak, gg / peak, b / peak];
    const x = W * p.x;
    const y = H * p.y;
    const R = u * 0.55 * (0.45 + 0.6 * k);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, R);
    grad.addColorStop(0, rgba(c, 0.1 + 0.42 * k));
    grad.addColorStop(0.3, rgba(c, (0.1 + 0.42 * k) * 0.45));
    grad.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.fill();
  }

  for (const h of place.heads) {
    const i = base + h.addr - 1;
    const k = Math.pow(f[i + 5] / 255, 1 / GAMMA);
    if (k < 0.01) continue;
    const c = wheelAt(f[i + 7]).rgb;
    const panC = (f[i] * 256 + f[i + 1]) / 256;
    const tiltC = (f[i + 2] * 256 + f[i + 3]) / 256;
    const az = (panC - PAN_CENTRE) * PAN_DEG_PER_DMX * DEG;
    const el = (TILT_WALL_EL + (tiltC - TILT_WALL) * TILT_DEG_PER_DMX) * DEG;
    const ax = Math.sin(az) * Math.cos(el);
    const ay = Math.sin(el);
    const L = u * 1.4 * Math.hypot(ax, ay);
    const x = W * h.x;
    const y = H * h.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(ax, ay));
    const grad = ctx.createLinearGradient(0, 0, 0, -L);
    grad.addColorStop(0, rgba(c as number[], 0.16 + 0.42 * k));
    grad.addColorStop(1, rgba(c as number[], 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-u * 0.03, 0);
    ctx.lineTo(u * 0.03, 0);
    ctx.lineTo(L * 0.22, -L);
    ctx.lineTo(-L * 0.22, -L);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.globalCompositeOperation = "source-over";
}
