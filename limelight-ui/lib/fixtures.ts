import type {
  Show,
  Fixture,
  FixturePlacement,
  FixturePosition,
  FixtureStates,
  ParState,
  HeadState,
  TrimState,
} from "./types";
import {
  PAR,
  HEAD,
  GAMMA,
  level,
  wheelAt,
  PAN_CENTRE,
  PAN_DEG_PER_DMX,
  TILT_WALL,
  TILT_WALL_EL,
  TILT_DEG_PER_DMX,
  DEG,
} from "./dmx";

/**
 * Lay out fixtures on the screen from a show's fixture list.
 * Positions are in normalised coordinates (0–1).
 */
export function placeFixtures(show: Show | null): FixturePlacement {
  const fx = show?.fixtures ?? [];
  if (!fx.length) return { pars: [], heads: [] };

  const xs = fx.map((f: Fixture) => f.at?.[0] ?? 0);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo || 1;
  const L = 0.09;
  const R = 0.91;

  const zs = fx.map((f: Fixture) => f.at?.[2] ?? 0);
  const zlo = Math.min(...zs);
  const zhi = Math.max(...zs);
  const zspan = zhi - zlo || 1;

  const pars: FixturePosition[] = [];
  const heads: FixturePosition[] = [];

  for (const f of fx) {
    const x = L + (((f.at?.[0] ?? 0) - lo) / span) * (R - L);
    const z = ((f.at?.[2] ?? 0) - zlo) / zspan;
    const row: FixturePosition = {
      addr: f.address,
      id: f.id.replace(/_/g, " "),
      x,
      y: 0.782 - 0.3 * z - (zspan > 0.01 ? 0 : 0.02) * Math.abs(x - 0.5) * 2,
    };
    if (f.type === "head13") heads.push(row);
    else pars.push(row);
  }

  return { pars, heads };
}

/**
 * Read fixture states from a frame buffer at a given index.
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

  const pars: ParState[] = place.pars.map((p) => {
    const i = base + p.addr - 1;
    const r = f[i + PAR.r];
    const g = f[i + PAR.g];
    const b = f[i + PAR.b];
    const peak = Math.max(r, g, b);
    return {
      ...p,
      r,
      g,
      b,
      strobe: f[i + PAR.strobe],
      k: level(peak),
      rgb: peak ? [r / peak, g / peak, b / peak] as [number, number, number] : [0, 0, 0],
    };
  });

  const heads: HeadState[] = place.heads.map((H0) => {
    const h = base + H0.addr - 1;
    const panC = (f[h + HEAD.pan] * 256 + f[h + HEAD.panFine]) / 256;
    const tiltC = (f[h + HEAD.tilt] * 256 + f[h + HEAD.tiltFine]) / 256;
    const az = (panC - PAN_CENTRE) * PAN_DEG_PER_DMX * DEG;
    const el = (TILT_WALL_EL + (tiltC - TILT_WALL) * TILT_DEG_PER_DMX) * DEG;
    const ax = Math.sin(az) * Math.cos(el);
    const ay = Math.sin(el);
    const wheel = wheelAt(f[h + HEAD.colour]);
    return {
      ...H0,
      panC,
      tiltC,
      dim: f[h + HEAD.dim],
      strobe: f[h + HEAD.strobe],
      wheel,
      k: level(f[h + HEAD.dim]),
      rgb: wheel.rgb,
      az: az / DEG,
      el: el / DEG,
      rot: Math.atan2(ax, ay),
      reach: Math.hypot(ax, ay),
    };
  });

  const defaultHead: HeadState = heads[0] ?? {
    addr: 0,
    id: "",
    x: 0.5,
    y: 0.74,
    k: 0,
    rgb: [1, 1, 1],
    rot: 0,
    reach: 0,
    az: 0,
    el: 0,
    wheel: { name: "—", rgb: [1, 1, 1] },
    dim: 0,
    panC: 0,
    tiltC: 0,
    strobe: 0,
  };

  return { pars, heads, head: defaultHead };
}

/**
 * Apply console trims to fixture states. Trims never edit the show—
 * they scale what leaves the sender.
 */
export function trimFixtures(fx: FixtureStates, trims: TrimState): FixtureStates {
  const g = (k: number) => (k <= 0 ? 0 : Math.pow(k, 1 / GAMMA));
  const parK = trims.blackout ? 0 : trims.master * trims.par;
  const headK = trims.blackout ? 0 : trims.master * trims.head;

  const heads = fx.heads.map((h) => ({ ...h, k: h.k * g(headK) }));
  return {
    pars: fx.pars.map((p) => ({ ...p, k: p.k * g(parK) })),
    heads,
    head: heads[0] ?? fx.head,
  };
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
