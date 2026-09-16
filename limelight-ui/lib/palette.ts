/**
 * A venue's colour palette, and the conversions it needs to travel.
 *
 * The room owns a handful of colours and a show spends them; portal/validator.py
 * snaps every cue's colour to the nearest declared entry, which is what keeps a
 * show looking like one show rather than a bag of hues. The picker speaks hex,
 * the baker speaks rgb 0..1, and a person reads names — so all three live here
 * and nowhere else.
 */

import type { PaletteColour } from "./types";

export type Rgb01 = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Hex in, the baker's 0..1 triple out. Anything unreadable is black. */
export function hexToRgb01(hex: string): Rgb01 {
  const m = HEX.exec((hex ?? "").trim());
  if (!m) return [0, 0, 0];
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The way back, for a picker that only understands hex. */
export function rgb01ToHex(rgb: Rgb01): string {
  const byte = (v: number) => {
    const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return b.toString(16).padStart(2, "0");
  };
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}

function toHsl(hex: string): { h: number; s: number; l: number; c: number } {
  const [r, g, b] = hexToRgb01(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l, c: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return { h, s, l, c: d };
}

/* Whether a colour has a hue at all is a question about CHROMA, not about HSL
   saturation. Saturation is chroma divided by how much room lightness leaves for
   it, so it runs away at both ends of the scale: #e6eaf2, the app's own
   off-white, scores 31% saturated on 4.7% chroma, and naming by saturation put
   "blue" in the plan for a colour nobody would call blue. */
const ACHROMATIC = 0.1;

/* The words a lighting person uses for a gel, in the order of the wheel. Each
   entry claims everything up to the next one's start. */
const HUES: { upTo: number; name: string }[] = [
  { upTo: 15, name: "red" },
  { upTo: 45, name: "amber" },
  { upTo: 65, name: "gold" },
  { upTo: 160, name: "green" },
  { upTo: 200, name: "cyan" },
  { upTo: 250, name: "blue" },
  { upTo: 285, name: "violet" },
  { upTo: 320, name: "magenta" },
  { upTo: 345, name: "pink" },
  { upTo: 360, name: "red" },
];

/**
 * What to call a colour.
 *
 * Derived on every read, never stored beside the hex. A name carried alongside
 * the value goes stale the first time someone drags the picker from red to
 * blue, and the plan handed to the baker would then describe a palette it does
 * not have.
 */
export function colourName(hex: string): string {
  const { h, c, l } = toHsl(hex);
  if (c < ACHROMATIC) return l >= 0.72 ? "white" : l <= 0.1 ? "black" : "grey";
  return HUES.find((x) => h < x.upTo)!.name;
}

/**
 * A colour to offer when someone adds one: the hue furthest from every hue
 * already in the palette, so a new swatch is distinguishable on sight rather
 * than a near-duplicate of the one beside it.
 */
export function nextColour(used: string[]): string {
  const taken = used
    .map((hex) => toHsl(hex))
    .filter((c) => c.c >= ACHROMATIC)
    .map((c) => c.h)
    .sort((a, b) => a - b);

  if (!taken.length) return "#ff5a45";

  /* the widest gap on the wheel, wrapping past 360 */
  let bestAt = (taken[0] + 180) % 360;
  let bestGap = -1;
  for (let i = 0; i < taken.length; i++) {
    const a = taken[i];
    const b = i + 1 < taken.length ? taken[i + 1] : taken[0] + 360;
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = (a + gap / 2) % 360;
    }
  }
  return hslToHex(bestAt, 0.85, 0.55);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb: Rgb01 = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg].map((v) => v + m) as Rgb01;
  return rgb01ToHex(rgb);
}

/* ── the colours a show already uses ────────────────────────────────────────
   A mirror of portal/recolour.py:extract_palette, and held to it by
   palette.test.ts, which reads a real show file off disk and compares.

   The two have to agree: /api/recolour derives the OLD palette this way and maps
   from it positionally, so if the editor showed a different set than the server
   mapped from, the swatch you dragged would not be the colour that moved. */

const COLOUR_KEYS = ["colour", "under", "to", "from", "bed_colour"] as const;
const CUE_LISTS = ["states", "bindings", "gestures"] as const;
/** Euclidean distance below which a colour counts as white */
const WHITE = 0.08;
/** how close two colours have to be before they are the same palette entry */
const NEAR = 0.06;

interface Cue { [key: string]: unknown }

/** A colour value as the plan may write it: "#rrggbb" or an rgb 0..1 triple. */
function asRgb(v: unknown): Rgb01 | null {
  if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return hexToRgb01(v);
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number")) {
    return v.map((x) => Math.max(0, Math.min(1, x))) as Rgb01;
  }
  return null;
}

const dist2 = (a: Rgb01, b: Rgb01) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const isWhite = (rgb: Rgb01) => dist2(rgb, [1, 1, 1]) < WHITE ** 2;

/**
 * The palette a show is working in: the one it declares, or — until it has been
 * recoloured once and therefore declares nothing — the one its cues add up to,
 * most-used first, near-duplicates folded together and whites pushed to the end
 * so they do not spend a slot meant for a colour.
 */
export function extractPalette(show: unknown, keep = 5): PaletteColour[] {
  const s = (show ?? {}) as { palette?: unknown } & Record<string, unknown>;

  if (Array.isArray(s.palette) && s.palette.length) {
    return s.palette
      .map((e) => asRgb((e as { rgb?: unknown })?.rgb ?? e))
      .filter((rgb): rgb is Rgb01 => rgb !== null)
      .map((rgb, i) => ({ id: `p${i}`, hex: rgb01ToHex(rgb) }));
  }

  const seen = new Map<string, { rgb: Rgb01; n: number }>();
  const count = (v: unknown) => {
    const rgb = asRgb(v);
    if (!rgb) return;
    const k = rgb.map((x) => x.toFixed(4)).join(",");
    const cur = seen.get(k);
    if (cur) cur.n += 1;
    else seen.set(k, { rgb, n: 1 });
  };

  for (const list of CUE_LISTS) {
    for (const cue of (s[list] as Cue[] | undefined) ?? []) {
      for (const ck of COLOUR_KEYS) count(cue[ck]);
      const arr = cue.colours;
      if (Array.isArray(arr)) for (const item of arr) count(item);
    }
  }

  const chromatic: Rgb01[] = [];
  const whites: Rgb01[] = [];
  let pool = [...seen.values()].sort((a, b) => b.n - a.n);

  while (pool.length && chromatic.length + whites.length < keep) {
    const { rgb } = pool.shift()!;
    (isWhite(rgb) ? whites : chromatic).push(rgb);
    pool = pool.filter((p) => dist2(p.rgb, rgb) > NEAR ** 2);
  }

  return [...chromatic, ...whites].map((rgb, i) => ({ id: `c${i}`, hex: rgb01ToHex(rgb) }));
}
