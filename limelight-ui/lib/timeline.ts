import type { Grid } from "./types";
import { makeGridClock, beatIndexAt, clamp } from "./grid.ts";

/** A window onto the song, in seconds. Never extends past the song. */
export interface View {
  from: number;
  to: number;
}

export function fit(duration: number): View {
  return { from: 0, to: duration };
}

export function timeToX(t: number, view: View, width: number): number {
  return ((t - view.from) / (view.to - view.from)) * width;
}

export function xToTime(x: number, view: View, width: number): number {
  return view.from + (x / width) * (view.to - view.from);
}

/** Keeps a view inside the song and no narrower than minSpan. */
export function clampView(view: View, duration: number, minSpan: number): View {
  const span = Math.min(Math.max(view.to - view.from, minSpan), duration);
  if (span >= duration) return { from: 0, to: duration };
  const from = clamp(view.from, 0, duration - span);
  return { from, to: from + span };
}

/** Zoom by `factor` (<1 zooms in) while holding `anchorT` under the same pixel. */
export function zoomAt(
  view: View, anchorT: number, factor: number, duration: number, minSpan: number,
): View {
  const span = view.to - view.from;
  const u = span === 0 ? 0 : (anchorT - view.from) / span;
  const next = Math.min(Math.max(span * factor, minSpan), duration);
  return clampView({ from: anchorT - u * next, to: anchorT - u * next + next }, duration, minSpan);
}

export function panBy(view: View, dt: number, duration: number, minSpan: number): View {
  return clampView({ from: view.from + dt, to: view.to + dt }, duration, minSpan);
}

/** Continuous beat index at a time — the inverse of the grid clock. */
export function beatAtTime(t: number, grid: Grid): number {
  return beatIndexAt(t, grid) ?? 0;
}

export interface BarTick {
  bar: number;
  t: number;
}

/* Labels thin out as the view widens. The step is chosen from a musical ladder
   (1, 2, 4, 8, 16 … bars) rather than an arbitrary number, so a tick is always
   a bar a musician would count to. */
const BAR_STEPS = [1, 2, 4, 8, 16, 32, 64, 128];
const MIN_TICK_PX = 40;

export function barTicks(view: View, grid: Grid, width: number): BarTick[] {
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const secPerBar = (60 / grid.bpm) * bpb;
  const pxPerBar = (secPerBar / (view.to - view.from)) * width;
  const step = BAR_STEPS.find((s) => s * pxPerBar >= MIN_TICK_PX) ?? BAR_STEPS[BAR_STEPS.length - 1];

  const firstBar = Math.max(1, Math.floor(beatAtTime(view.from, grid) / bpb) + 1);
  const out: BarTick[] = [];
  for (let bar = firstBar - ((firstBar - 1) % step); ; bar += step) {
    const t = secondsAtBar(bar);
    if (t > view.to) break;
    if (t >= view.from && bar >= 1) out.push({ bar, t });
    if (out.length > 4096) break;
  }
  return out;
}
