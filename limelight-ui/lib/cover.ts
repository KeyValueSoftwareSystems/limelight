/**
 * Draw a generative cover from a song's score data.
 * Ported from portal/app.js drawCover().
 */

import type { Song } from "./types";
import { TAU } from "./dmx";
import { clamp } from "./grid";

export function drawCover(cv: HTMLCanvasElement, song: Song): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const W = cv.width;
  const H = cv.height;
  const q = song.quality;
  const minor = /minor/.test(q?.key || "");
  const sure = typeof q?.sure === "number" ? q.sure : 0.5;
  const vals = (song.energy || []).filter((v): v is number => v !== null);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.4;
  const lift = clamp(mean, 0, 1);

  const hue = minor ? 224 : 34;
  const sat = minor ? 16 : 20;
  const ground = (l: number) => `hsl(${hue},${sat}%,${l}%)`;
  const lamp = (a: number) => `rgba(255, 217, 163, ${a})`;

  ctx.fillStyle = ground(4 + lift * 2);
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, ground(9 + lift * 7));
  g.addColorStop(1, ground(3 + lift * 2));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (!vals.length) return;

  const mx = Math.max(...vals) || 1;
  const cx = W * 0.5;
  const cy = H * 0.52;
  const R = Math.min(W, H) * 0.34;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.9);
  glow.addColorStop(0, lamp(0.05 + lift * 0.06));
  glow.addColorStop(1, "rgba(255, 217, 163, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.lineWidth = 1 + sure * 1.6;
  ctx.strokeStyle = lamp(0.4 + sure * 0.45);
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
  ctx.fillStyle = lamp(0.07);
  ctx.fill();

  ctx.strokeStyle = lamp(0.32);
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
  g.fillStyle = `hsl(${(h % 40) + 210},12%,${9 + (h % 5)}%)`;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255, 217, 163, 0.28)";
  g.lineWidth = 2;
  g.strokeRect(10.5, 10.5, W - 21, H - 21);
  g.fillStyle = "rgba(255, 233, 198, 0.82)";
  g.font = `500 ${Math.round(H * 0.34)}px Inter, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initials, W / 2, H / 2 + 1);
}
