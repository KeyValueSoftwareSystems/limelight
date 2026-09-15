import type {
  Show,
  Fixture,
  FixturePlacement,
  FixtureStates,
  LampPosition,
  LampState,
  ParState,
  HeadState,
  TrimState,
} from "./types";
import { GAMMA, level, wheelAt, PAN_CENTRE, PAN_DEG_PER_DMX, TILT_WALL, TILT_WALL_EL, TILT_DEG_PER_DMX, DEG } from "./dmx.ts";
import { profileOf, moves, type Profile } from "./profiles.ts";

/* ── placement ───────────────────────────────────────────────────────────────
   A layout's `at` is [x, depth, height] in metres in the audience frame: +x is
   the audience's right, depth grows toward the audience, height is from the
   floor. Two of those three used to be thrown away — everything was laid on one
   line and a rig with a back truss and a front truss drew as a single row.      */

const L_EDGE = 0.07;
const R_EDGE = 0.93;

function spanOf(values: number[]): { lo: number; span: number } {
  if (!values.length) return { lo: 0, span: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return { lo, span: hi - lo || 1 };
}

/**
 * Lay fixtures out on the screen. Positions are normalised (0–1).
 *
 * Depth is a perspective, not a coordinate: a lamp further from the audience
 * sits higher on the screen, draws smaller and gets more air in front of it.
 * That is what lets a trussed rig read as a room rather than as a row.
 */
export function placeFixtures(show: Show | null): FixturePlacement {
  const fx = show?.fixtures ?? [];
  if (!fx.length) return { lamps: [], pars: [], heads: [] };

  const X = spanOf(fx.map((f: Fixture) => f.at?.[0] ?? 0));
  const D = spanOf(fx.map((f: Fixture) => f.at?.[1] ?? 0));
  const H = spanOf(fx.map((f: Fixture) => f.at?.[2] ?? 0));
  /* a rig with one truss has no depth and no height to read; keep it on the old
     single-line geometry rather than dividing by a span that is really zero */
  const flatDepth = D.span < 0.01;
  const flatHeight = H.span < 0.01;

  const lamps: LampPosition[] = fx.map((f: Fixture) => {
    const prof = profileOf(f.type);
    const xm = f.at?.[0] ?? 0;
    const depth = flatDepth ? 0 : ((f.at?.[1] ?? 0) - D.lo) / D.span;
    const height = flatHeight ? 0.5 : ((f.at?.[2] ?? 0) - H.lo) / H.span;

    /* nearer the audience = lower on screen and larger */
    const perspective = 0.86 + 0.14 * depth;
    const x = 0.5 + ((L_EDGE + ((xm - X.lo) / X.span) * (R_EDGE - L_EDGE)) - 0.5) * perspective;
    const y = 0.80 - 0.40 * height + 0.06 * depth
      - (flatHeight && flatDepth ? 0.02 * Math.abs(x - 0.5) * 2 : 0);

    return {
      addr: f.address,
      id: f.id.replace(/_/g, " "),
      type: f.type,
      kind: prof.kind,
      x,
      y,
      depth,
      height,
      scale: 0.72 + 0.46 * depth,
    };
  });

  /* draw back-to-front so a near truss overlaps a far one */
  lamps.sort((a, b) => a.depth - b.depth);

  return { lamps, pars: lamps.filter((l) => !moves(l.type)), heads: lamps.filter((l) => moves(l.type)) };
}

/* ── reading one frame ───────────────────────────────────────────────────── */

function colourOf(f: Uint8Array, i: number, p: Profile): { rgb: [number, number, number]; peak: number } {
  const a = p.at;
  if (a.r !== undefined && a.g !== undefined && a.b !== undefined) {
    const r = f[i + a.r], g = f[i + a.g], b = f[i + a.b];
    const peak = Math.max(r, g, b);
    return { rgb: peak ? [r / peak, g / peak, b / peak] : [0, 0, 0], peak };
  }
  /* subtractive: the flags take colour OUT of a white lamp */
  if (a.c !== undefined && a.m !== undefined && a.y !== undefined) {
    const r = 1 - f[i + a.c] / 255, g = 1 - f[i + a.m] / 255, b = 1 - f[i + a.y] / 255;
    const peak = Math.max(r, g, b);
    return { rgb: peak ? [r / peak, g / peak, b / peak] : [0, 0, 0], peak: peak * 255 };
  }
  if (a.wheel !== undefined) {
    return { rgb: wheelAt(f[i + a.wheel]).rgb, peak: 255 };
  }
  /* a blinder or a xenon strobe: white is the whole point, it cannot be tinted */
  return { rgb: [1, 0.93, 0.82], peak: 255 };
}

function strobeOf(f: Uint8Array, i: number, p: Profile): number {
  if (p.at.strobe === undefined) return 0;
  const v = f[i + p.at.strobe];
  if (p.strobeOpen === undefined) return v / 255;
  /* a shutter-and-strobe channel: at or below `open` it is simply open */
  return v <= p.strobeOpen ? 0 : Math.min(1, (v - p.strobeOpen) / (255 - p.strobeOpen));
}

/** Where a mover is pointing, as a screen rotation and a reach along it. */
function aimOf(f: Uint8Array, i: number, p: Profile) {
  const a = p.at;
  if (a.pan === undefined || a.tilt === undefined) return { rot: 0, reach: 0, az: 0, el: 0 };
  const panC = a.panFine !== undefined ? (f[i + a.pan] * 256 + f[i + a.panFine]) / 256 : f[i + a.pan];
  const tiltC = a.tiltFine !== undefined ? (f[i + a.tilt] * 256 + f[i + a.tiltFine]) / 256 : f[i + a.tilt];
  const az = (panC - PAN_CENTRE) * PAN_DEG_PER_DMX * DEG;
  const el = (TILT_WALL_EL + (tiltC - TILT_WALL) * TILT_DEG_PER_DMX) * DEG;
  const ax = Math.sin(az) * Math.cos(el);
  const ay = Math.sin(el);
  return { rot: Math.atan2(ax, ay), reach: Math.hypot(ax, ay), az: az / DEG, el: el / DEG, panC, tiltC };
}

/** Beam width in degrees, honouring a zoom channel where the device has one. */
function spreadOf(f: Uint8Array, i: number, p: Profile): number {
  const [lo, hi] = p.beamDeg;
  if (p.at.zoom === undefined || lo === hi) return lo;
  return lo + (f[i + p.at.zoom] / 255) * (hi - lo);
}

/**
 * Read every fixture's state from a frame buffer at a given index.
 */
export function readFixtures(
  idx: number,
  frames: Uint8Array,
  show: Show,
  place: FixturePlacement,
): FixtureStates | null {
  if (!frames || !show || !place) return null;
  const base = idx * show.channels;
  if (base < 0 || base + show.channels > frames.length) return null;
  const f = frames;

  const lamps: LampState[] = place.lamps.map((pos) => {
    const p = profileOf(pos.type);
    const i = base + pos.addr - 1;
    const { rgb, peak } = colourOf(f, i, p);
    const k = p.brightness === "colour"
      ? level(peak)
      : level(p.at.master !== undefined ? f[i + p.at.master] : 0);
    const aim = aimOf(f, i, p);

    /* a pixel device is several lamps in one footprint; read each cell so the bar
       can run a chase inside itself rather than glowing as a single block */
    let cells: LampState["cells"];
    if (p.cells && p.at.r !== undefined) {
      cells = [];
      for (let c = 0; c < p.cells; c++) {
        const ci = i + c * 4;
        const r = f[ci + p.at.r], g = f[ci + (p.at.g ?? 1)], b = f[ci + (p.at.b ?? 2)];
        const pk = Math.max(r, g, b);
        cells.push({ k: level(pk), rgb: pk ? [r / pk, g / pk, b / pk] : [0, 0, 0] });
      }
    }

    return {
      ...pos,
      k,
      rgb,
      strobe: strobeOf(f, i, p),
      spreadDeg: spreadOf(f, i, p),
      gobo: p.at.gobo !== undefined ? f[i + p.at.gobo] : 0,
      prism: p.at.prism !== undefined && f[i + p.at.prism] > 20,
      rot: aim.rot,
      reach: aim.reach,
      az: aim.az,
      el: aim.el,
      cells,
    };
  });

  return withViews(lamps);
}

/* `pars` and `heads` are views over `lamps`, kept because the panels and the
   marketplace preview ask for them by those names. `head` is the first mover,
   which the state panel reads to name what the rig is doing. */
function withViews(lamps: LampState[]): FixtureStates {
  const heads = lamps.filter((l) => moves(l.type));
  const pars = lamps.filter((l) => !moves(l.type));
  return { lamps, pars: pars as ParState[], heads: heads as HeadState[], head: heads[0] ?? pars[0] ?? null };
}

/**
 * Apply console trims to fixture states. Trims never edit the show—
 * they scale what leaves the sender.
 */
export function trimFixtures(fx: FixtureStates, trims: TrimState): FixtureStates {
  const g = (k: number) => (k <= 0 ? 0 : Math.pow(k, 1 / GAMMA));
  const parK = trims.blackout ? 0 : trims.master * trims.par;
  const headK = trims.blackout ? 0 : trims.master * trims.head;

  return withViews(fx.lamps.map((l) => ({
    ...l,
    k: l.k * g(moves(l.type) ? headK : parK),
    cells: l.cells?.map((c) => ({ ...c, k: c.k * g(parK) })),
  })));
}

/**
 * Mean colour of a group of fixtures, weighted by brightness.
 */
export function meanColour(list: Array<{ k: number; rgb: [number, number, number] }>): [number, number, number] | null {
  const lit = list.filter((x) => x.k > 0.02);
  if (!lit.length) return null;
  const w = lit.reduce((s, x) => s + x.k, 0);
  return [0, 1, 2].map((i) => lit.reduce((s, x) => s + x.rgb[i] * x.k, 0) / w) as [number, number, number];
}
