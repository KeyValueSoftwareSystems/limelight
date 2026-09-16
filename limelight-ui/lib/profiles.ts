/**
 * What each device type IS, for the page that draws it.
 *
 * The authority is `readers/lights/drivers/profiles/*.profile.json` — the same
 * files the JS drivers read. This is a mirror, because the renderer needs channel
 * offsets synchronously inside a paint and cannot go and fetch them; the two are
 * held together by `profiles.test.ts`, which reads the real JSON off disk and
 * fails if a footprint, a role order or a beam angle here drifts from it.
 *
 * Before this existed, `lib/dmx.ts` carried one `PAR` and one `HEAD` offset table
 * and `lib/fixtures.ts` decided what a fixture was with `type === "head13"`. That
 * works for exactly two device types and silently mis-reads any third.
 */

/** How a fixture behaves on screen. Drawing follows from this, not from the type name. */
export type FixtureKind = "par" | "wash" | "spot" | "strobe" | "blinder" | "strip" | "laser";

export interface Profile {
  /** channels this device occupies */
  footprint: number;
  /** how it draws */
  kind: FixtureKind;
  /** channel offsets from the fixture's address, by role. Absent = not fitted. */
  at: {
    master?: number;
    r?: number;
    g?: number;
    b?: number;
    w?: number;
    c?: number;
    m?: number;
    y?: number;
    strobe?: number;
    pan?: number;
    panFine?: number;
    tilt?: number;
    tiltFine?: number;
    wheel?: number;
    gobo?: number;
    prism?: number;
    zoom?: number;
  };
  /** brightness rides the colour channels, or a master dimmer */
  brightness: "colour" | "master";
  /** narrow-to-wide beam in degrees; a zooming device gives both ends */
  beamDeg: [number, number];
  /** a shutter-and-strobe channel: `open` is the value that simply opens it */
  strobeOpen?: number;
  /** cells on a pixel device */
  cells?: number;
  /** true where no real fixture stands behind the channel map */
  invented?: boolean;
}

export const PROFILES: Record<string, Profile> = {
  /* ── generated from rig.py, the hardware this project was first built on ── */
  par7: {
    footprint: 7, kind: "par", brightness: "colour", beamDeg: [45, 45],
    at: { master: 0, r: 1, g: 2, b: 3, strobe: 4 },
  },
  head13: {
    footprint: 13, kind: "spot", brightness: "master", beamDeg: [14, 14],
    at: { pan: 0, panFine: 1, tilt: 2, tiltFine: 3, master: 5, strobe: 6,
          wheel: 7, gobo: 8, prism: 9 },
  },

  /* ── read out of the GDTF files under readers/lights/mvr/gdtf/ ─────────── */
  par5: {
    footprint: 5, kind: "par", brightness: "colour", beamDeg: [60, 60],
    at: { master: 0, r: 1, g: 2, b: 3, w: 4 },
  },
  wash12: {
    footprint: 12, kind: "wash", brightness: "master", beamDeg: [12, 58],
    at: { strobe: 0, master: 1, zoom: 2, pan: 3, tilt: 4, r: 7, g: 8, b: 9, w: 10 },
    strobeOpen: 32,
  },
  spot29: {
    footprint: 29, kind: "spot", brightness: "master", beamDeg: [8, 55],
    at: { pan: 0, tilt: 1, c: 5, m: 6, y: 7, gobo: 15, prism: 19, zoom: 23,
          strobe: 27, master: 28 },
    strobeOpen: 32,
  },
  strobe3: {
    footprint: 3, kind: "strobe", brightness: "master", beamDeg: [82, 82],
    at: { master: 0, strobe: 2 },
  },
  blinder1: {
    footprint: 1, kind: "blinder", brightness: "master", beamDeg: [61.5, 61.5],
    at: { master: 0 },
  },
  pixelbar24: {
    footprint: 24, kind: "strip", brightness: "colour", beamDeg: [5, 5],
    at: { r: 0, g: 1, b: 2, w: 3 },
    cells: 6,
  },
  laser8: {
    footprint: 8, kind: "laser", brightness: "master", beamDeg: [0.2, 30],
    at: { master: 0, r: 1, g: 2, b: 3, pan: 4, tilt: 5 },
    invented: true,
  },
};

/** The par7 fallback keeps an unknown type drawable rather than invisible. */
export function profileOf(type: string): Profile {
  return PROFILES[type] ?? PROFILES.par7;
}

export function kindOf(type: string): FixtureKind {
  return profileOf(type).kind;
}

/** Whether this device aims. Movers get a beam; everything else stays put. */
export function moves(type: string): boolean {
  const a = profileOf(type).at;
  return a.pan !== undefined && a.tilt !== undefined;
}

/* ── counting a rig out loud ────────────────────────────────────────────────
   A rig is read by what its devices DO, never by their type names: par7 and
   par5 are two fixtures and one line, and a blinder is not "a head" because it
   is not a par. Both the target line and the venue picker say this, so it is
   said once here. */

/** the words a lighting person counts a rig in, in the order they would say them */
const KIND_ORDER: readonly FixtureKind[] =
  ["spot", "wash", "par", "strip", "blinder", "strobe", "laser"];

const KIND_WORD: Record<FixtureKind, [string, string]> = {
  spot: ["beam", "beams"], wash: ["wash", "washes"], par: ["par", "pars"],
  strip: ["strip", "strips"], blinder: ["blinder", "blinders"],
  strobe: ["strobe", "strobes"], laser: ["laser", "lasers"],
};

/** "8 beams · 6 washes · 22 pars" — a rig in the language of the room. */
export function rigSummary(
  kinds: Record<string, number> | undefined,
  sep = " · ",
): string {
  const n = new Map<FixtureKind, number>();
  for (const [type, count] of Object.entries(kinds ?? {})) {
    const k = kindOf(type);
    n.set(k, (n.get(k) ?? 0) + count);
  }
  return KIND_ORDER.filter((k) => n.has(k))
    .map((k) => `${n.get(k)} ${KIND_WORD[k][n.get(k) === 1 ? 0 : 1]}`)
    .join(sep);
}
