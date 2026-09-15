/* ── DMX channel offsets and rig constants ────────────────────────────────── */

export const GAMMA = 1.6;

export const PAR = { dim: 0, r: 1, g: 2, b: 3, strobe: 4 } as const;
export const HEAD = {
  pan: 0,
  panFine: 1,
  tilt: 2,
  tiltFine: 3,
  speed: 4,
  dim: 5,
  strobe: 6,
  colour: 7,
  gobo: 8,
  prism: 9,
} as const;

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/* Pan / tilt calibration from rig.py, verified by live probing */
export const PAN_CENTRE = 169;
export const PAN_DEG_PER_DMX = 540 / 255;
export const TILT_WALL = 40;
export const TILT_UP = 127;
export const TILT_WALL_EL = 20;
export const TILT_UP_EL = 90;
export const TILT_DEG_PER_DMX = (TILT_UP_EL - TILT_WALL_EL) / (TILT_UP - TILT_WALL);

/* Colour wheel: 8 slots of 16 DMX each */
export const WHEEL: [string, [number, number, number]][] = [
  ["white", [1, 1, 1]],
  ["red", [1, 0, 0]],
  ["yellow", [1, 0.85, 0]],
  ["blue", [0, 0, 1]],
  ["green", [0, 1, 0]],
  ["pink", [1, 0, 0.55]],
  ["orange", [1, 0.3, 0]],
  ["light blue", [0, 0.6, 1]],
];

export function wheelAt(v: number): { name: string; rgb: [number, number, number] } {
  if (v >= 128) return { name: "spin", rgb: [1, 1, 1] };
  const idx = Math.min(7, v >> 4);
  return { name: WHEEL[idx][0], rgb: WHEEL[idx][1] };
}

/* Intensity from DMX byte, undoing the gamma curve */
export function level(v: number): number {
  return v ? Math.pow(v / 255, 1 / GAMMA) : 0;
}

/* ── colour naming ───────────────────────────────────────────────────────── */

const HUE_NAMES: [number, string][] = [
  [16, "red"],
  [44, "amber"],
  [66, "gold"],
  [150, "green"],
  [200, "cyan"],
  [246, "blue"],
  [292, "violet"],
  [330, "magenta"],
  [360, "pink"],
];

export function colourName(r: number, g: number, b: number): string {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (!mx) return "off";
  if (d / mx < 0.12) return "white";
  let h: number;
  if (mx === r) h = ((g - b) / d + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  for (const [edge, name] of HUE_NAMES) {
    if (h < edge) return name;
  }
  return "red";
}

export const ROOTS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

export function keyHueOf(key: string | null | undefined): number | null {
  if (!key) return null;
  const root = String(key).split(" ")[0];
  const n = ROOTS[root];
  return n === undefined ? null : ((n * 7) % 12) / 12;
}
