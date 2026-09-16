import type { Grid } from "./types";
import { makeGridClock, beatIndexAt, clamp, mmss, mmssms } from "./grid.ts";

/** A window onto the song, in seconds. Never extends past the song. */
export interface View {
  from: number;
  to: number;
}

/** The narrowest window the editor will show.
 *
 *  It used to be a whole second, which is about four beats — so the closest you
 *  could ever look was still too wide to see a millisecond, let alone place
 *  one. At 0.2s across a ~1000px editor a pixel is a fifth of a millisecond,
 *  which is finer than anything the ear or the wire can tell apart. */
export const MIN_SPAN_S = 0.2;

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

/* ── vertical guides ──────────────────────────────────────────────────────────
   Everything the editor can rule a line at. Each ladder answers the same
   question — "how far apart are these on screen?" — and returns nothing rather
   than a hatch when the answer is "closer than you could read". A grid you
   cannot count is not a grid, it is a texture. */

export interface Tick {
  t: number;
  /** Shown under the line. Omitted where the band above already names it. */
  label?: string;
  /** A stronger line: a downbeat among beats, every fifth among times. */
  strong?: boolean;
}

/** Below this, beats are a hatch rather than a count. */
const MIN_BEAT_PX = 7;

/** Every beat in view, downbeats marked, or nothing if they are too close. */
export function beatTicks(view: View, grid: Grid, width: number): Tick[] {
  const span = view.to - view.from;
  if (span <= 0 || width <= 0 || !grid.bpm) return [];
  const { secondsAtBar, bpb } = makeGridClock(grid);
  if (((60 / grid.bpm) / span) * width < MIN_BEAT_PX) return [];

  const out: Tick[] = [];
  for (let n = Math.max(0, Math.floor(beatAtTime(view.from, grid))); out.length <= 2048; n++) {
    const t = secondsAtBar(Math.floor(n / bpb) + 1, (n % bpb) + 1);
    if (t > view.to) break;
    if (t >= view.from) out.push({ t, strong: n % bpb === 0 });
  }
  return out;
}

/* A ladder a person counts in. 0.4s steps exist arithmetically and nobody has
   ever thought in them; these run milliseconds to minutes and every rung is a
   number you would say out loud. */
const TIME_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5,
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
];
/** Wide enough for "0:42.375" plus air. */
const MIN_TIME_PX = 62;

/** Clock time across the view, at whatever resolution the zoom can show —
 *  minutes when the whole song is on screen, milliseconds when it is not. */
export function timeTicks(view: View, width: number): Tick[] {
  const span = view.to - view.from;
  if (span <= 0 || width <= 0) return [];
  const step =
    TIME_STEPS.find((s) => (s / span) * width >= MIN_TIME_PX) ?? TIME_STEPS[TIME_STEPS.length - 1];

  const first = Math.ceil(view.from / step);
  const out: Tick[] = [];
  for (let i = 0; out.length <= 512; i++) {
    /* Counted in whole steps and rounded to the millisecond, because adding
       0.1 to itself thirty times does not give 3. */
    const t = Math.round((first + i) * step * 1000) / 1000;
    if (t > view.to) break;
    out.push({ t, label: step < 1 ? mmssms(t) : mmss(t), strong: (first + i) % 5 === 0 });
  }
  return out;
}

/** The bars where the score's own intensity turns over — where the song lifts.
 *  Energy is one value per bar, so a peak is a bar, not an instant. */
export function energyPeaks(energy: (number | null)[], grid: Grid): Tick[] {
  const { secondsAtBar } = makeGridClock(grid);
  const out: Tick[] = [];
  for (let i = 1; i < energy.length - 1; i++) {
    const v = energy[i], before = energy[i - 1], after = energy[i + 1];
    if (v == null || before == null || after == null) continue;
    /* Strictly above what came before, at least level with what follows: the
       first bar of a plateau is the peak, not every bar of it. */
    if (v > before && v >= after) {
      out.push({ t: secondsAtBar(i + 1), label: `${Math.round(v * 100)}%`, strong: v >= 0.8 });
    }
  }
  return out;
}
