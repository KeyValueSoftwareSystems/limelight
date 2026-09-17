/**
 * The geometry of a rig in three dimensions.
 *
 * The 2D preview flattens a layout onto the screen: it keeps x, turns height
 * into "further up the picture" and depth into "smaller and hazier". That is a
 * drawing of a rig. This file is the arithmetic for standing in the room.
 *
 * WORLD AXES, once, because every sign error below would otherwise be silent:
 *
 *        +Y  up (height above the deck, metres)
 *         │
 *         │
 *         └───── +X  the audience's right
 *        ╱
 *      +Z  toward the audience
 *
 * A layout's `at` is [x, depth, height], so it maps to (x, height, depth) —
 * the second and third components swap. Depth 0 is the upstage truss and depth
 * grows toward the crowd, which is why the camera sits at a LARGER z than
 * anything in the rig and looks back down the room.
 *
 * Pure — no three.js import, no DOM. The component does the drawing; this does
 * the maths, and `stage3d.test.ts` checks it.
 */

import type { Fixture, LampState } from "./types";
import { DEG } from "./dmx.ts";
import { profileOf, moves } from "./profiles.ts";

export type Vec3 = [number, number, number];

export function norm(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** A layout position in metres → world space. */
export function worldOf(at: [number, number, number] | undefined): Vec3 {
  const [x = 0, depth = 0, height = 0] = at ?? [];
  return [x, height, depth];
}

/* ── where a lamp points ─────────────────────────────────────────────────── */

/**
 * A fixture that cannot move still points somewhere, and the direction is a
 * property of how it was hung rather than of anything in the frame. A blinder
 * faces the crowd, an uplighter on the deck faces the roof, a par on a truss
 * faces down and a little out. Getting these wrong is what makes a static rig
 * read as a row of dots rather than as light in a room.
 */
export function staticAim(kind: string, height: number): Vec3 {
  switch (kind) {
    /* the whole point of a blinder is that it is in your eyes */
    case "blinder": return norm([0, -0.22, 1]);
    case "strobe": return norm([0, -0.12, 1]);
    /* a vertical tower washes across the stage rather than down it */
    case "strip": return norm([0, 0, 1]);
    default:
      /* on the deck it can only go up; in the air it goes down and downstage */
      return height < 1 ? norm([0, 1, -0.18]) : norm([0, -1, 0.34]);
  }
}

/**
 * Where a lamp is pointing, in world space.
 *
 * For a mover this is the real pan and tilt off the wire. `az` is the pan
 * deflection (0 = straight downstage-to-upstage centre) and `el` is elevation
 * above the horizon, both already decoded by lib/fixtures.ts against the rig's
 * calibration — so this only has to turn two angles into a vector.
 */
export function aimOf(l: Pick<LampState, "type" | "kind" | "az" | "el">, height: number): Vec3 {
  if (!moves(l.type)) return staticAim(l.kind, height);
  const az = (l.az ?? 0) * DEG;
  const el = (l.el ?? 0) * DEG;
  const ce = Math.cos(el);
  return norm([Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce]);
}

/**
 * How far the beam travels before it lands.
 *
 * A shaft that runs on forever fills the room with haze and reads as fog; one
 * that stops where it hits the deck reads as a beam. So: solve for the floor
 * plane, and fall back to the full throw for anything aimed at or above the
 * horizon, which genuinely does disappear into the air.
 */
export function throwOf(origin: Vec3, dir: Vec3, maxThrow: number, deck?: Deck): number {
  if (dir[1] >= -0.02) return maxThrow;              // level or climbing
  const at = landingOf(origin, dir, maxThrow, deck);
  if (!at) return maxThrow;
  const hit = Math.max(0.4, Math.hypot(
    at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]));
  /* A head tilting through the horizon used to snap from a six-metre shaft to a
     forty-metre one in a single frame, which looks like the renderer glitching
     rather than like a lamp moving. Between -0.02 and -0.16 the two answers are
     blended, so the change arrives over a few degrees instead of all at once. */
  const g = Math.min(1, (-dir[1] - 0.02) / 0.14);
  return Math.min(maxThrow, hit * g + maxThrow * (1 - g));
}

/** A riser standing on the floor, which a beam can land on before the floor does. */
export interface Deck {
  top: number;
  minX: number; maxX: number;
  minZ: number; maxZ: number;
}

/**
 * Where a beam's axis first meets something it can light.
 *
 * The deck is checked before the floor, because a rig pointed at a stage lands
 * on the stage — putting every pool on the floor buries them under the riser,
 * which is exactly what it looked like.
 */
export function landingOf(origin: Vec3, dir: Vec3, maxThrow: number, deck?: Deck): Vec3 | null {
  if (dir[1] >= -0.02) return null;

  if (deck && origin[1] > deck.top) {
    const td = (origin[1] - deck.top) / -dir[1];
    const x = origin[0] + dir[0] * td;
    const z = origin[2] + dir[2] * td;
    if (td <= maxThrow && x >= deck.minX && x <= deck.maxX && z >= deck.minZ && z <= deck.maxZ) {
      return [x, deck.top, z];
    }
  }

  const t = origin[1] / -dir[1];
  if (t > maxThrow) return null;
  return [origin[0] + dir[0] * t, 0, origin[2] + dir[2] * t];
}

/* ── the room the rig is in ──────────────────────────────────────────────── */

export interface RoomBounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  maxY: number;
  width: number; depth: number;
  centreX: number; centreZ: number;
}

/** The extent of the rig, padded out to a room that contains it. */
export function roomOf(fixtures: Fixture[]): RoomBounds {
  if (!fixtures.length) {
    return { minX: -5, maxX: 5, minZ: 0, maxZ: 5, maxY: 6,
             width: 10, depth: 5, centreX: 0, centreZ: 2.5 };
  }
  const p = fixtures.map((f) => worldOf(f.at));
  const minX = Math.min(...p.map((v) => v[0]));
  const maxX = Math.max(...p.map((v) => v[0]));
  const minZ = Math.min(...p.map((v) => v[2]));
  const maxZ = Math.max(...p.map((v) => v[2]));
  const maxY = Math.max(...p.map((v) => v[1]));
  return {
    minX, maxX, minZ, maxZ, maxY,
    width: Math.max(2, maxX - minX),
    depth: Math.max(1, maxZ - minZ),
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
  };
}

/**
 * Front of house, slightly raised: centred on the room, a few metres up, far
 * enough back that the whole rig fits, looking at the middle of the rig rather
 * than at the floor. The distance scales with the rig, so a four-par desk rig
 * and a 46-fixture arena both fill the frame.
 */
export function cameraOf(room: RoomBounds, aspect: number): { position: Vec3; target: Vec3; fov: number } {
  const fov = 42;
  const need = Math.max(room.width / Math.max(aspect, 0.5), room.maxY * 1.2 + 0.5);
  const back = (need / 2) / Math.tan(fov * 0.5 * DEG);
  return {
    position: [room.centreX, Math.min(3.2, room.maxY * 0.45 + 0.9), room.maxZ + Math.max(2.6, back * 1.04)],
    target: [room.centreX, room.maxY * 0.46, room.centreZ],
    fov,
  };
}

/* ── trusses ─────────────────────────────────────────────────────────────── */

export interface Bar {
  y: number;
  z: number;
  x0: number;
  x1: number;
  /** true where the fixtures on it stand vertically rather than hanging in a row */
  vertical: boolean;
}

/**
 * The steel. Fixtures sharing a height and a depth are on one bar; a pair that
 * shares only x and z is a vertical tower. Drawing the structure is most of
 * what stops a rig looking like lamps floating in a void.
 */
export function barsOf(fixtures: Fixture[]): Bar[] {
  const groups = new Map<string, Vec3[]>();
  for (const f of fixtures) {
    const w = worldOf(f.at);
    const key = `${w[1].toFixed(2)}:${w[2].toFixed(2)}`;
    const g = groups.get(key);
    if (g) g.push(w); else groups.set(key, [w]);
  }
  const bars: Bar[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const xs = g.map((v) => v[0]);
    bars.push({
      y: g[0][1], z: g[0][2],
      x0: Math.min(...xs), x1: Math.max(...xs),
      vertical: false,
    });
  }
  return bars;
}

/* ── how big a lamp body is ──────────────────────────────────────────────── */

/** Rough real sizes in metres, so a par is not the same object as a 29ch spot. */
export function bodyOf(type: string): { radius: number; length: number } {
  const p = profileOf(type);
  switch (p.kind) {
    case "spot": return { radius: 0.17, length: 0.46 };
    case "wash": return { radius: 0.15, length: 0.34 };
    case "blinder": return { radius: 0.22, length: 0.16 };
    case "strobe": return { radius: 0.18, length: 0.18 };
    case "strip": return { radius: 0.06, length: 1.0 };
    case "laser": return { radius: 0.11, length: 0.28 };
    default: return { radius: 0.12, length: 0.26 };
  }
}
