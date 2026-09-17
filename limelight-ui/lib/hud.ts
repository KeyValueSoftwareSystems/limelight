/**
 * What the playback HUD reads out of a show.
 *
 * Both functions are called from inside a paint, so both binary-search a sorted
 * array and neither allocates or keeps a cursor. A cursor would be faster by a
 * hair and would strand itself the first time someone scrubbed backwards.
 */

import type { Section } from "./types";

/** How long a downbeat stays visible on the beat rule, in seconds. */
export const PULSE_DECAY = 0.35;

/**
 * The section under the playhead, or null outside all of them.
 *
 * A boundary belongs to the section it STARTS — otherwise the label shows the
 * outgoing section for a frame on every change, which reads as a flicker.
 */
export function sectionAt(t: number, sections: Section[]): Section | null {
  let lo = 0;
  let hi = sections.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = sections[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return s;
  }
  return null;
}

/**
 * How brightly the beat rule should be lit: 1 on a downbeat, falling to 0 over
 * PULSE_DECAY seconds, and 0 before the first one.
 */
export function beatPulse(t: number, downbeats: number[], decay = PULSE_DECAY): number {
  if (!downbeats.length || decay <= 0) return 0;

  /* the last downbeat at or before t */
  let lo = 0;
  let hi = downbeats.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (downbeats[mid] <= t) { at = downbeats[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (at < 0) return 0;

  const since = t - at;
  return since >= decay ? 0 : 1 - since / decay;
}
