/**
 * A venue's colour palette, and the conversions it needs to travel.
 *
 * The room owns a handful of colours and a show spends them; portal/validator.py
 * snaps every cue's colour to the nearest declared entry, which is what keeps a
 * show looking like one show rather than a bag of hues. The picker speaks hex,
 * the baker speaks rgb 0..1, and a person reads names — so all three live here
 * and nowhere else.
 */

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
