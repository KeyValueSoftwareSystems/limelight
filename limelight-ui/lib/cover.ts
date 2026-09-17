/**
 * Draw a generative cover from a song's score data.
 * Ported from portal/app.js drawCover().
 */

import type { Song } from "./types";
import { TAU, keyHueOf } from "./dmx";
import { clamp } from "./grid";

export function drawCover(cv: HTMLCanvasElement, song: Song): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const W = cv.width;
  const H = cv.height;
  const q = song.quality;
  const hue = keyHueOf(q?.key);
  const minor = /minor/.test(q?.key || "");
  const h = hue === null ? 0.58 : hue;
  const sure = typeof q?.sure === "number" ? q.sure : 0.5;
  const vals = (song.energy || []).filter((v): v is number => v !== null);
  const hsl = (l: number, a: number) =>
    `hsla(${Math.round(h * 360)},${minor ? 42 : 62}%,${l}%,${a})`;

  ctx.fillStyle = hsl(minor ? 11 : 15, 1);
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, hsl(minor ? 26 : 38, 1));
  g.addColorStop(1, hsl(minor ? 8 : 12, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (!vals.length) return;

  const mx = Math.max(...vals) || 1;
  const cx = W * 0.5;
  const cy = H * 0.52;
  const R = Math.min(W, H) * 0.34;
  ctx.lineWidth = 1 + sure * 1.6;
  ctx.strokeStyle = hsl(74, 0.55 + sure * 0.35);
  ctx.beginPath();
  vals.forEach((v, i) => {
    const a = (i / vals.length) * TAU - Math.PI / 2;
    const r = R * (0.42 + 0.58 * clamp(v / mx, 0, 1));
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = hsl(60, 0.14);
  ctx.fill();

  /* section ticks */
  ctx.strokeStyle = hsl(88, 0.5);
  ctx.lineWidth = 1;
  const dur = song.duration_s || 1;
  for (const sec of song.sections || []) {
    const a = clamp(sec.start / dur, 0, 1) * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12);
    ctx.lineTo(cx + Math.cos(a) * R * 1.3, cy + Math.sin(a) * R * 1.3);
    ctx.stroke();
  }
}

/**
 * Draw a venue monogram from its name.
 */
export function drawMonogram(cv: HTMLCanvasElement, name: string): void {
  const g = cv.getContext("2d");
  if (!g) return;
  const W = cv.width;
  const H = cv.height;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const initials = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  g.fillStyle = `hsl(${h},22%,14%)`;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = `hsl(${h},45%,52%)`;
  g.lineWidth = 2;
  g.strokeRect(10.5, 10.5, W - 21, H - 21);
  g.fillStyle = `hsl(${h},40%,78%)`;
  g.font = `500 ${Math.round(H * 0.34)}px Geist, Inter, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initials, W / 2, H / 2 + 1);
}
