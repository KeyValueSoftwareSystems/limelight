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
import { groupStructures } from "./structures.ts";

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

/* ── where a beam lands on a surface ──────────────────────────────────────────
   The floor is not the only thing a beam can hit. Aimed level or upstage it meets
   a wall; without that, the shaft runs straight through the walls and screens and
   nothing lights up where it lands. These are the room's vertical surfaces. */

export interface Walls {
  /** the upstage wall plane (faces +Z, toward the crowd) */
  backZ: number;
  /** the two side wall planes (face inward) */
  minX: number; maxX: number;
  /** walls run from the floor up to here */
  wallTop: number;
  /** side walls run from backZ to this downstage limit */
  frontZ: number;
}

export interface Hit { point: Vec3; normal: Vec3; dist: number; }

/**
 * The nearest surface a beam meets — floor, deck, or a wall — with the surface
 * normal so a glow can be laid flat against it. Returns null when the beam
 * escapes into open air (aimed up, into no wall) within maxThrow.
 */
export function surfaceHit(origin: Vec3, dir: Vec3, maxThrow: number, deck?: Deck, walls?: Walls): Hit | null {
  let best: Hit | null = null;
  const consider = (t: number, point: Vec3, normal: Vec3) => {
    if (t <= 0.01 || t > maxThrow) return;
    if (!best || t < best.dist) best = { point, normal, dist: t };
  };

  if (deck && dir[1] < -1e-4 && origin[1] > deck.top) {          // deck top
    const t = (origin[1] - deck.top) / -dir[1];
    const x = origin[0] + dir[0] * t, z = origin[2] + dir[2] * t;
    if (x >= deck.minX && x <= deck.maxX && z >= deck.minZ && z <= deck.maxZ) {
      consider(t, [x, deck.top, z], [0, 1, 0]);
    }
  }
  if (dir[1] < -1e-4) {                                          // floor
    const t = origin[1] / -dir[1];
    consider(t, [origin[0] + dir[0] * t, 0, origin[2] + dir[2] * t], [0, 1, 0]);
  }
  if (walls) {
    if (dir[2] < -1e-4) {                                        // upstage wall
      const t = (origin[2] - walls.backZ) / -dir[2];
      const x = origin[0] + dir[0] * t, y = origin[1] + dir[1] * t;
      if (x >= walls.minX && x <= walls.maxX && y >= 0 && y <= walls.wallTop) {
        consider(t, [x, y, walls.backZ], [0, 0, 1]);
      }
    }
    if (dir[0] < -1e-4) {                                        // left wall
      const t = (origin[0] - walls.minX) / -dir[0];
      const y = origin[1] + dir[1] * t, z = origin[2] + dir[2] * t;
      if (z >= walls.backZ && z <= walls.frontZ && y >= 0 && y <= walls.wallTop) {
        consider(t, [walls.minX, y, z], [1, 0, 0]);
      }
    }
    if (dir[0] > 1e-4) {                                         // right wall
      const t = (walls.maxX - origin[0]) / dir[0];
      const y = origin[1] + dir[1] * t, z = origin[2] + dir[2] * t;
      if (z >= walls.backZ && z <= walls.frontZ && y >= 0 && y <= walls.wallTop) {
        consider(t, [walls.maxX, y, z], [-1, 0, 0]);
      }
    }
  }
  return best;
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
  /** "bar" is a straight run; "curve" follows every point, which is what an arch needs */
  kind: "bar" | "curve";
  /** every member's world position, ordered left to right */
  points: Vec3[];
  y: number;
  z: number;
  x0: number;
  x1: number;
  /** true where the fixtures on it stand vertically rather than hanging in a row */
  vertical: boolean;
}

/**
 * The steel, in world metres.
 *
 * Which fixtures form one structure is NOT decided here — lib/structures.ts owns
 * that, and the flat renderer reads the same answer through placeFixtures. The
 * two views each worked out their own version of a shared number once before,
 * in lib/exposure.ts's territory, and drifted; this is that lesson applied to
 * geometry. An arch's members vary in height, so the old height-and-depth key
 * could never have found them.
 */
export function barsOf(fixtures: Fixture[]): Bar[] {
  return groupStructures(fixtures).map((g) => {
    const points = g.members.map((i) => worldOf(fixtures[i].at));
    const xs = points.map((v) => v[0]);
    return {
      kind: g.kind,
      points,
      y: points[0][1], z: points[0][2],
      x0: Math.min(...xs), x1: Math.max(...xs),
      vertical: false,
    };
  });
}

/* ── the stage set: deck, goalpost towers, DJ booth ──────────────────────────
   The rig used to hang over a low riser box in an otherwise empty room, which is
   why it read as "bars floating above the floor". A real gig has a raised deck to
   stand on, steel towers holding the overhead truss up, and — for the club/EDM
   rooms this drives — a booth downstage-centre. The geometry is inferred from the
   rig the same way the room is, because the venue files carry fixtures, not sets. */

export interface StageDeck extends Deck {
  centreX: number; centreZ: number;
  width: number; depth: number; height: number;
  /** the downstage edge, where the deck meets the floor toward the crowd */
  frontZ: number;
}

/** A raised performance deck, wider than the rig and sat under the upstage truss. */
export function deckOf(room: RoomBounds): StageDeck {
  /* A rig that hangs in the air stands on a raised deck; a floor rig (every
     fixture on the ground) gets a flush deck so its fixtures sit on the ground
     plane rather than being buried inside a one-metre riser. */
  const height = room.maxY > 1.5 ? 1.0 : 0.0;     // a stage you stand on, not a 0.6 kerb
  const width = room.width + 6;                    // extends past the outermost fixtures
  const depth = Math.max(3.5, room.depth * 0.6);
  const centreX = room.centreX;
  const minZ = room.minZ - 0.6;                    // a little behind the back truss
  const maxZ = minZ + depth;
  return {
    top: height, height,
    minX: centreX - width / 2, maxX: centreX + width / 2,
    minZ, maxZ, frontZ: maxZ,
    centreX, centreZ: (minZ + maxZ) / 2, width, depth,
  };
}

/** A vertical truss tower standing from the floor up to a horizontal truss. */
export interface Tower { x: number; z: number; yTop: number; yBottom: number; }

/**
 * A tower at each end of every overhead bar, floor to truss. Ends shared by two
 * bars collapse to one tower, which then reaches the taller of them — otherwise a
 * back truss and a mid truss at the same corner would draw two towers in one spot.
 */
export function towersOf(bars: Bar[]): Tower[] {
  const by = new Map<string, Tower>();
  for (const bar of bars) {
    for (const x of [bar.x0, bar.x1]) {
      const key = `${x.toFixed(3)}:${bar.z.toFixed(3)}`;
      const cur = by.get(key);
      if (cur) cur.yTop = Math.max(cur.yTop, bar.y);
      else by.set(key, { x, z: bar.z, yTop: bar.y, yBottom: 0 });
    }
  }
  return [...by.values()];
}

/** The DJ booth: a raised block downstage-of-centre, on the deck, facing the crowd. */
export interface Booth { x: number; z: number; w: number; d: number; h: number; top: number; }

export function boothOf(deck: StageDeck): Booth {
  const w = Math.min(3.0, deck.width * 0.28);
  const d = Math.min(1.8, deck.depth * 0.4);
  const h = 1.1;
  return {
    x: deck.centreX,
    z: deck.maxZ - d / 2 - 0.5,                    // toward the downstage edge
    w, d, h,
    top: deck.top + h,
  };
}

/* ── the video screens ────────────────────────────────────────────────────── */

/** A flat LED surface, centred at (x,y,z), w wide and h tall, facing the crowd. */
export interface Screen { x: number; y: number; z: number; w: number; h: number; }
export interface Screens { wall: Screen; pillars: Screen[]; }

/**
 * The screens a real stage carries: one big LED wall upstage behind the band,
 * and a tall LED pillar flanking each side. Sized off the room so a club and an
 * arena both get a wall in proportion. They face the crowd (+Z).
 */
export function screensOf(room: RoomBounds, deck: StageDeck): Screens {
  const wallH = Math.max(3, room.maxY * 0.78);
  const wallW = Math.min(deck.width * 0.82, room.width + 4);
  const wall: Screen = {
    x: room.centreX,
    y: deck.top + 0.4 + wallH / 2,          // sits just above the deck
    z: room.minZ - 2.2,                       // upstage, in front of the back wall
    w: wallW, h: wallH,
  };

  const pillarH = Math.max(3.5, room.maxY * 0.92);
  const pillarW = 0.5;
  const outer = room.width / 2 + 1.2;
  const pillars: Screen[] = [-1, 1].map((sx) => ({
    x: room.centreX + sx * outer,
    y: pillarH / 2,
    z: room.minZ - 0.3,
    w: pillarW, h: pillarH,
  }));

  return { wall, pillars };
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
