import type { Effect, EffectDial } from "./types";

/* What an effect lets you change, in words a person would use.
 *
 * The catalogue names its dials for the renderer — `amount`, `for_beats`,
 * `every_beats`, `bed_colour` — and serves twenty-five effects declaring
 * thirty-odd of them between them. That is the right vocabulary at the wire and
 * the wrong one on a palette tile, where the question being asked is "if I put
 * this down, what will I be able to do with it". */

export interface DialInfo {
  /** The catalogue's own name for it. */
  id: string;
  /** What to call it on screen. */
  label: string;
  /** Its range or its setting, already rendered: "30–80%", "all", "1–4 beats". */
  value: string;
  /** Whether the clip's inspector actually offers it today. */
  editable: boolean;
  /** rgb 0..1, for the ones that are a colour — drawn rather than described. */
  swatches: [number, number, number][];
}

/** The dials the clip inspector puts a control on. Everything else an effect
 *  declares is real, and the baker reads it, but the creator cannot turn it
 *  here yet — so it is listed as a setting, not offered as a control. */
const EDITABLE = new Set(["amount", "colour"]);

/** Dials the timeline owns rather than the inspector: `for_beats` IS the clip's
 *  length, so it is changed by trimming the clip, not by a field. */
const BY_LENGTH = new Set(["for_beats"]);

const LABELS: Record<string, string> = {
  amount: "Intensity",
  intensity: "Intensity",
  colour: "Colour",
  colours: "Colours",
  bed_colour: "Bed colour",
  extent: "Extent",
  coverage: "Coverage",
  floor: "Floor",
  peak: "Peak",
  rest: "Resting level",
  depth: "Depth",
  spread: "Spread",
  stagger: "Stagger",
  smooth: "Smoothing",
  lean: "Lean",
  response: "Response",
  threshold: "Threshold",
  travel: "Travel",
  tilt: "Tilt",
  curve: "Curve",
  rise: "Rise",
  keep: "Keep",
  which: "Which lamps",
  pattern: "Pattern",
  gobo: "Gobo",
  hz: "Rate (Hz)",
  stream: "Follows",
  streams: "Streams",
  from: "From",
  to: "To",
  by: "By",
  for_beats: "Length",
  over_beats: "Animates over",
  every_beats: "Every",
  beats_per_turn: "Beats per turn",
};

/** `every_beats` → "Every beats" beats a raw key, and it keeps working for a
 *  dial the catalogue grows tomorrow that nothing here has heard of. */
function prettify(id: string): string {
  const words = id.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isRgb(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number");
}

/** Levels are declared 0..1 and read as percentages everywhere a person sees
 *  them — the inspector's Intensity slider included. */
const AS_PERCENT = new Set(["amount", "intensity", "floor", "peak", "depth", "rest", "threshold"]);

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function describe(id: string, dial: EffectDial): { value: string; swatches: [number, number, number][] } {
  const { min, max, default: def } = dial;

  if (isRgb(def)) return { value: "", swatches: [def] };
  if (Array.isArray(def) && def.every(isRgb)) {
    return { value: "", swatches: def as [number, number, number][] };
  }

  if (typeof min === "number" && typeof max === "number") {
    if (AS_PERCENT.has(id)) return { value: `${Math.round(min * 100)}–${Math.round(max * 100)}%`, swatches: [] };
    const unit = id.endsWith("_beats") || id === "beats_per_turn" ? " beats" : "";
    return { value: `${num(min)}–${num(max)}${unit}`, swatches: [] };
  }

  if (def === undefined || def === null) return { value: "", swatches: [] };
  if (typeof def === "number" && AS_PERCENT.has(id)) {
    return { value: `${Math.round(def * 100)}%`, swatches: [] };
  }
  if (typeof def === "number") return { value: num(def), swatches: [] };
  return { value: String(def), swatches: [] };
}

/**
 * Everything the effect declares, in reading order: what you can change first,
 * then what it comes set to.
 *
 * `for_beats` is dropped rather than listed twice — the length is offered on its
 * own line by whatever is showing this, because it is the one control that is
 * the same for every effect and is worked by dragging the clip's edge.
 */
export function dialsOf(effect: Effect): DialInfo[] {
  const out: DialInfo[] = [];
  for (const [id, dial] of Object.entries(effect.dials ?? {})) {
    if (BY_LENGTH.has(id)) continue;
    const { value, swatches } = describe(id, dial ?? {});
    out.push({
      id,
      label: LABELS[id] ?? prettify(id),
      value,
      editable: EDITABLE.has(id),
      swatches,
    });
  }
  return out.sort((a, b) => Number(b.editable) - Number(a.editable) || a.label.localeCompare(b.label));
}

/** How the effect behaves in time, for the line under its name. */
export function kindNote(effect: Effect): string {
  switch (effect.kind ?? "gesture") {
    case "state":
      return "State · fills the section you drop it in";
    case "binding":
      return "Binding · follows the track across its section";
    default:
      return "Gesture · a cue of its own length";
  }
}
