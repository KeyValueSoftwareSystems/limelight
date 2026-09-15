import type { Effect } from "./types";

/* Schema 2's effect ids and the icon set were made for each other, so the id is
   the filename. Anything unrecognised falls back rather than rendering an empty
   tile. */
const KNOWN = new Set([
  "drone", "wash", "impact", "blackout", "hush", "ramp", "stab", "lift",
  "trade", "isolate", "strip", "cut", "swell", "gear", "follow", "split",
  "accent", "custom",
]);

export function effectIcon(effect: Pick<Effect, "id" | "base">): string {
  const name = KNOWN.has(effect.id)
    ? effect.id
    : effect.base && KNOWN.has(effect.base)
      ? effect.base
      : "custom";
  return `/icons/effects/${name}.png`;
}
