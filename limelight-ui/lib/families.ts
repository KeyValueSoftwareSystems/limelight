import type { Effect, Family } from "./types";

/* The renderer resolves one effect per TYPE per beat (readers/lights/frame.js),
   so the renderer's type is what a lane is. Two clips of the same family can
   never overlap, because the engine could not honour it; different families
   always compose. The UI's rule is the engine's rule. */

export const FAMILY_ORDER: Family[] = [
  "hits", "darkness", "strobe", "lift", "breath", "wash", "dynamics",
];

const FX_TO_FAMILY: Record<string, Family> = {
  white_blast: "hits",
  blackout: "darkness",
  accent_strobe: "strobe",
  hook: "lift",
  pause: "breath",
  whiten: "wash",
  modulate: "dynamics",
};

export const FAMILY_LABEL: Record<Family, string> = {
  hits: "Hits",
  darkness: "Darkness",
  strobe: "Strobe",
  lift: "Lift",
  breath: "Breath",
  wash: "Wash",
  dynamics: "Dynamics",
};

/* What the arranger's own assignment is called when we draw it. It was never a
   palette tile, so it gets the family's own word rather than a tile name. */
export const FAMILY_AUTO_LABEL: Record<Family, string> = {
  hits: "Hit",
  darkness: "Blackout",
  strobe: "Strobe",
  lift: "Lift",
  breath: "Breath",
  wash: "Wash",
  dynamics: "Dynamics",
};

/* The arranger's plan names its assignments in its own words; the palette names
   effects by catalogue id. Schema 1 let a tile declare the plan's word as `fx`,
   so the two met on their own. Schema 2 dropped `fx`, and nothing matched any
   more — a takeover could not find a tile, so the arranger's clips could not be
   moved or resized at all. Each pairing keeps what the light does. */
const PLAN_FX_TO_EFFECT: Record<string, string> = {
  white_blast: "impact",   // amount to full, all fixtures — the biggest hit
  blackout: "blackout",    // amount to zero
  accent_strobe: "accent", // amount follows the real drum onsets
  hook: "lift",            // amount up and holds; the one gesture that stays
  pause: "hush",           // levels fall away, the room quiets
  whiten: "wash",          // all lamps at mid level, one colour
};

/** The catalogue id that stands in for one of the arranger's assignments. */
export function effectIdForPlanFx(fx: string | undefined): string | null {
  return fx ? (PLAN_FX_TO_EFFECT[fx] ?? null) : null;
}

export function familyOfFx(fx: string | undefined): Family | null {
  return fx ? (FX_TO_FAMILY[fx] ?? null) : null;
}

export function familyOfEffect(effect: Effect): Family | null {
  if (effect.fx) return familyOfFx(effect.fx);
  /* Schema 2 has no `fx`, so the tile is found through the plan word it stands
     in for. */
  const fx = Object.keys(PLAN_FX_TO_EFFECT).find((k) => PLAN_FX_TO_EFFECT[k] === effect.id);
  return familyOfFx(fx);
}

/** Dynamics is an envelope, not a stack of clips, so nothing drops onto it. */
export function acceptsClips(family: Family): boolean {
  return family !== "dynamics";
}

export function clipFamilies(): Family[] {
  return FAMILY_ORDER.filter(acceptsClips);
}
