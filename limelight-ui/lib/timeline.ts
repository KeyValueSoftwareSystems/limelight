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

export interface BeatTick {
  t: number;
  bar: number;
  beat: number;
  down: boolean;
}

/* Every beat in view, once there is room to draw them.
   A bar ruler alone tells you where a bar starts and nothing about the four
   beats inside it, so placing a cue on beat 3 is guesswork. This is the grid a
   music editor draws: bar lines strong, beat lines faint, and nothing at all
   when the view is too wide for the lines to mean anything. Beats come from the
   measured table when the score has one, so the lines sit on the music rather
   than on an average tempo. */
const MIN_BEAT_PX = 9;

export function beatTicks(view: View, grid: Grid, width: number): BeatTick[] {
  const bpb = grid.beats_per_bar ?? 4;
  const beats = grid.beats;
  const span = view.to - view.from;
  if (span <= 0) return [];

  const out: BeatTick[] = [];
  const down = grid.downbeats ?? [];
  const isDown = new Set(down.map((t) => Math.round(t * 1000)));

  if (beats && beats.length > 1) {
    const pxPerBeat = (((beats[beats.length - 1] - beats[0]) / (beats.length - 1)) / span) * width;
    if (pxPerBeat < MIN_BEAT_PX) return [];
    let bar = 0, beat = 0;
    for (const t of beats) {
      const d = isDown.has(Math.round(t * 1000));
      if (d) { bar += 1; beat = 1; } else { beat += 1; }
      if (t >= view.from && t <= view.to && bar >= 1) out.push({ t, bar, beat, down: d });
      if (out.length > 4096) break;
    }
    return out;
  }

  const { secondsAtBar } = makeGridClock(grid);
  const pxPerBeat = ((60 / grid.bpm) / span) * width;
  if (pxPerBeat < MIN_BEAT_PX) return [];
  const firstBar = Math.max(1, Math.floor(beatAtTime(view.from, grid) / bpb) + 1);
  for (let bar = firstBar; ; bar += 1) {
    let past = false;
    for (let beat = 1; beat <= bpb; beat++) {
      const t = secondsAtBar(bar, beat);
      if (t > view.to) { past = true; break; }
      if (t >= view.from) out.push({ t, bar, beat, down: beat === 1 });
    }
    if (past || out.length > 4096) break;
  }
  return out;
}

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

/** How many beats `px` screen pixels cover, measured at `x` in the same view.
 *
 *  A magnet whose radius is a fixed number of beats reaches further across the
 *  screen the further you zoom in, which is backwards: the closer you look, the
 *  finer you mean to place. Measuring at `x` rather than dividing by bpm also
 *  keeps it honest across a tempo change. */
export function beatsAcross(
  x: number, px: number, view: View, width: number, grid: Grid,
): number {
  const a = beatAtTime(xToTime(x, view, width), grid);
  const b = beatAtTime(xToTime(x + px, view, width), grid);
  return Math.abs(b - a);
}
