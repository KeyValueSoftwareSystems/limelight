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

export function familyOfFx(fx: string | undefined): Family | null {
  return fx ? (FX_TO_FAMILY[fx] ?? null) : null;
}

export function familyOfEffect(effect: Effect): Family | null {
  return familyOfFx(effect.fx);
}

/** Dynamics is an envelope, not a stack of clips, so nothing drops onto it. */
export function acceptsClips(family: Family): boolean {
  return family !== "dynamics";
}

export function clipFamilies(): Family[] {
  return FAMILY_ORDER.filter(acceptsClips);
}
