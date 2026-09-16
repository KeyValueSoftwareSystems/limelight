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

/**
 * Format seconds as m:ss.mmm.
 *
 * m:ss is enough to find a section; it is not enough to place an effect against
 * a hit, which is a few tens of milliseconds wide — at m:ss a cue and the snare
 * it is meant to land on read as the same instant. Rounding happens once, on
 * the total, so 59.9996s reads "1:00.000" rather than "0:60.000".
 */
export function mmssms(s: number): string {
  if (!isFinite(s)) return "—";
  const sign = s < 0 ? "-" : "";
  const ms = Math.round(Math.abs(s) * 1000);
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${sign}${m}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

/**
 * Read a time back out of a typed field: "1:02.375" and "62.375" are the same
 * instant, and both are things a person types. Returns null for anything that
 * is not a time, so the field can put back what it had instead of jumping to
 * zero on a stray keystroke.
 */
export function parseTime(text: string): number | null {
  const m = /^(-)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const v = (m[2] ? Number(m[2]) * 60 : 0) + Number(m[3]);
  return isFinite(v) ? (m[1] ? -v : v) : null;
}

/**
 * A beat count as a person would say it: "2", not "2.0000000004"; "1.5", not
 * "1.4999999". Beats stop being whole the moment anything is nudged by a
 * millisecond, and a readout that shows twelve digits of float noise makes a
 * correct number look like a broken one.
 */
export function beatsLabel(b: number): string {
  return String(Math.round(b * 100) / 100);
}
