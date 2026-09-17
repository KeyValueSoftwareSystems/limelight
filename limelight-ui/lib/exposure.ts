/**
 * How much light is in one frame, and what colour it is.
 *
 * Light ADDS, so a frame with forty lamps up is forty times the light of a frame
 * with one, and both renderers clip long before that. Each therefore scales every
 * lamp's contribution by how many are burning.
 *
 * They used to do it separately, and they drifted: the flat view recomputed the
 * number fresh each frame, the 3D view ran it through a filter that fell three
 * times faster than it rose. An envelope follower shaped like that parks near its
 * minimum as soon as its input swings, and the lit-lamp count swings on every
 * chase, every strobe and every hit — so the room sat pinned near its floor while
 * the plot showed the same frame lit. They also disagreed on the floor itself,
 * 0.30 against 0.32.
 *
 * So this is the rule, and this file is where it is kept: ANY NUMBER THAT
 * DESCRIBES THE FRAME RATHER THAN THE VIEWPOINT IS COMPUTED HERE, ONCE, AND BOTH
 * VIEWS READ IT. Geometry, perspective and materials are the viewpoint's business
 * and may differ freely.
 *
 * Deliberately stateless. Smoothing would have to be added HERE, where both views
 * get it in the same frame, and not in one of them.
 */

import type { LampState } from "./types";
import { clamp } from "./grid.ts";

/** Below this a lamp is off as far as the room is concerned. */
const LIT = 0.01;

/** A four-par desk rig at full must not read as louder than a real room. */
const MIN_FIXTURES = 6;

export interface FrameLight {
  /** how many lamps are burning */
  lit: number;
  /** mean intensity across the rig, 0–1 */
  output: number;
  /** what to scale each lamp's contribution by, so a big rig does not clip */
  density: number;
  /** the rig's output-weighted colour, peak-normalised; black when nothing burns */
  tint: [number, number, number];
}

export function frameLight(lamps: LampState[]): FrameLight {
  let lit = 0;
  let sum = 0;
  let r = 0, g = 0, b = 0;

  for (const l of lamps) {
    if (l.k <= LIT) continue;
    lit++;
    sum += l.k;
    r += l.rgb[0] * l.k;
    g += l.rgb[1] * l.k;
    b += l.rgb[2] * l.k;
  }

  /* Scaling by the square root of the lit count keeps total output roughly
     constant while leaving the relative brightnesses intact, so a big rig reads
     as MORE BEAMS rather than as more white. */
  const density = clamp(3.4 / Math.sqrt(Math.max(1, lit)), 0.3, 1);
  const output = sum / Math.max(MIN_FIXTURES, lamps.length);

  /* Peak-normalised, so tint carries hue and `output` carries strength. Mixing
     the two would make a dim red room and a bright red room different colours. */
  const peak = Math.max(r, g, b);
  const tint: [number, number, number] = peak > 0 ? [r / peak, g / peak, b / peak] : [0, 0, 0];

  return { lit, output, density, tint };
}

/**
 * The most a fully-lit rig may add to a room surface.
 *
 * The floor's own colour is about 0.03–0.07 per channel, so 0.14 roughly triples
 * it at full — enough that a blackout reads as a ROOM going dark rather than as
 * cones switching off, and not so much that the surfaces compete with the beams.
 * This and the falloff constants in Stage3D's room shader are the two knobs; if
 * the room looks milky, this is the one to turn down.
 */
export const AMBIENT_GAIN = 0.14;

/**
 * How much light the room's own surfaces catch, 0..AMBIENT_GAIN.
 *
 * Scaled by density for the same reason every beam is: without it, adding
 * fixtures to a rig would brighten the room even though no more light is being
 * asked for, and the biggest rigs would read as the most washed out.
 */
export function roomAmbient(fl: FrameLight): number {
  return Math.min(AMBIENT_GAIN, fl.output * fl.density * AMBIENT_GAIN);
}
