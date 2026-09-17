import type { Effect, Grid, Section } from "./types";
import { beatIndexAt, makeGridClock } from "./grid.ts";

/* How long a freshly placed effect is.
 *
 * The catalogue does not answer this on its own. A gesture declares its length
 * in `default_beats` — an Impact is a beat, a Ramp is sixteen — but a STATE
 * declares 0, because a state is not a length at all: it is the bed a section
 * rests on, and the composer gives it the section's span (planConvert:
 * `push(s.effect, sec.start, beatSpan(sec.start, sec.end))`, and back the other
 * way it is filed by which section its midpoint falls in). The same is true of
 * the bindings.
 *
 * Reading `default_beats` straight through therefore dropped every state and
 * binding onto the timeline with ZERO length — nine of the twenty-five tiles,
 * including Wash, Drone, Drive and Pulse. What appeared was a 16px stub, which
 * is the minimum a clip may be DRAWN at, not a clip: nothing to trim, nothing
 * to read, and a length of "0 beats" in the inspector.
 *
 * So the length is worked out at the drop point instead, from what the effect
 * is. Where it STARTS is untouched — that is the pointer's to decide, and it
 * already lands to the millisecond. */

/** A gesture that declares no length of its own gets a bar — the unit the
 *  ruler counts in, and the shortest thing that reads as a span rather than as
 *  a mark. */
const FALLBACK_BARS = 1;

/** Never shorter than this, however tight the room at the drop point. */
const MIN_BEATS = 1;

function sectionAt(t: number, sections: Section[]): Section | null {
  for (const s of sections) if (t >= s.start && t < s.end) return s;
  return null;
}

/**
 * How many beats the effect should claim when it is dropped at `atS`.
 *
 * - Anything that declares a length keeps it.
 * - A state or a binding fills the rest of the section it lands in, because
 *   that is the span the baker will give it anyway.
 * - Anything else gets a bar.
 */
export function placementBeats(
  effect: Effect,
  atS: number,
  grid: Grid,
  sections: Section[] = [],
): number {
  const declared = effect.beats ?? effect.default_beats ?? 0;
  if (declared > 0) return declared;

  const { bpb } = makeGridClock(grid);
  const bar = Math.max(1, bpb) * FALLBACK_BARS;

  const kind = effect.kind ?? "gesture";
  if (kind !== "state" && kind !== "binding") return bar;

  const section = sectionAt(atS, sections);
  if (!section) return bar;

  const from = beatIndexAt(atS, grid);
  const to = beatIndexAt(section.end, grid);
  if (from === null || to === null) return bar;

  return Math.max(MIN_BEATS, to - from);
}
