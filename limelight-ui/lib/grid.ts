import type { Grid, TempoChange } from "./types";

/**
 * Build a seconds-at-bar function from a grid, by the same rule
 * protocol/session.js uses. Bar 1 begins on the first downbeat
 * whatever grid.first_bar says.
 */
export function makeGridClock(grid: Grid) {
  const bpb = grid.beats_per_bar ?? 4;
  const first = grid.first_beat_s ?? 0;
  const tempo: TempoChange[] =
    grid.tempo && grid.tempo.length
      ? [...grid.tempo].sort((a, b) => a.from_beat - b.from_beat)
      : [{ from_beat: 0, at_s: first, bpm: grid.bpm }];

  function atBeat(n: number): number {
    let seg = tempo[0];
    for (const cand of tempo) {
      if (cand.from_beat <= n) seg = cand;
      else break;
    }
    return seg.at_s + (n - seg.from_beat) * (60.0 / seg.bpm);
  }

  function secondsAtBar(bar: number, beat = 1): number {
    return atBeat((bar - 1) * bpb + (beat - 1));
  }

  return { secondsAtBar, bpb };
}

/**
 * Get the beat index at a given time in seconds.
 */
export function beatIndexAt(t: number, grid: Grid): number | null {
  if (!grid) return null;
  const tempo: TempoChange[] =
    grid.tempo && grid.tempo.length
      ? grid.tempo
      : [{ from_beat: 0, at_s: grid.first_beat_s ?? 0, bpm: grid.bpm }];

  let seg = tempo[0];
  for (const c of tempo) {
    if (c.at_s <= t) seg = c;
    else break;
  }
  return seg.from_beat + (t - seg.at_s) / (60 / seg.bpm);
}

/**
 * Return { bar, beat } at a given time.
 */
export function positionAt(t: number, grid: Grid): { bar: number; beat: number } | null {
  const i = beatIndexAt(t, grid);
  if (i === null) return null;
  const bpb = grid.beats_per_bar ?? 4;
  return {
    bar: 1 + Math.floor(i / bpb),
    beat: 1 + Math.floor(((i % bpb) + bpb) % bpb),
  };
}

/**
 * Format seconds as m:ss, with negative support for pickup bars.
 */
export function mmss(s: number): string {
  if (!isFinite(s)) return "—";
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  return sign + Math.floor(a / 60) + ":" + String(Math.floor(a % 60)).padStart(2, "0");
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
