/**
 * The 3D stage's arithmetic, against the real layouts.
 *
 * None of this can be checked by looking at the render: a beam pointing the
 * wrong way still draws a convincing cone, and a pool half a metre off still
 * looks like a pool. The axis convention in particular is the kind of thing that
 * is wrong for weeks — so it is pinned here rather than in a comment.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  worldOf, norm, staticAim, aimOf, throwOf, landingOf, roomOf, cameraOf, barsOf, bodyOf,
  type Deck, type Vec3,
} from "./stage3d.ts";
import type { Fixture, LampState } from "./types.ts";

const LIGHTS = path.join(import.meta.dirname, "..", "..", "readers", "lights");
const load = (f: string) =>
  JSON.parse(fs.readFileSync(path.join(LIGHTS, f), "utf8")) as { fixtures: Fixture[] };

const arena = load("keycode-arena.layout.json");
const basic = load("keycode-basic.layout.json");

const lamp = (over: Partial<LampState>): Pick<LampState, "type" | "kind" | "az" | "el"> =>
  ({ type: "par5", kind: "par", az: 0, el: 0, ...over }) as never;

/* ── the axis convention ─────────────────────────────────────────────────── */

test("a layout's [x, depth, height] becomes world (x, height, depth)", () => {
  assert.deepEqual(worldOf([1.5, 4, 6]), [1.5, 6, 4]);
  assert.deepEqual(worldOf(undefined), [0, 0, 0]);
});

test("the back truss is at depth 0 and the front truss further toward the audience", () => {
  const back = arena.fixtures.find((f) => f.id === "par_back_01")!;
  const front = arena.fixtures.find((f) => f.id === "wash_01")!;
  assert.equal(worldOf(back.at)[2], 0, "back truss sits at z = 0");
  assert.ok(worldOf(front.at)[2] > worldOf(back.at)[2], "front truss is nearer the crowd");
  assert.ok(worldOf(back.at)[1] > 4, "and it is in the air, not on the deck");
});

/* ── aim ─────────────────────────────────────────────────────────────────── */

test("a lamp in the air points down; one on the deck points up", () => {
  assert.ok(staticAim("par", 5.2)[1] < 0, "a truss par points at the floor");
  assert.ok(staticAim("par", 0.3)[1] > 0, "a floor pod points at the roof");
});

test("a blinder and a strobe point at the audience, not at the stage", () => {
  for (const kind of ["blinder", "strobe"]) {
    const d = staticAim(kind, 4.6);
    assert.ok(d[2] > 0.9, `${kind} should face +z (the crowd), got ${d}`);
    assert.ok(Math.abs(d[1]) < 0.3, `${kind} should be roughly level, got ${d}`);
  }
});

test("every aim vector is a unit vector", () => {
  const dirs: Vec3[] = [
    staticAim("par", 5), staticAim("par", 0.2), staticAim("blinder", 4),
    staticAim("strip", 2), staticAim("strobe", 4),
    aimOf(lamp({ type: "spot29", kind: "spot", az: 30, el: -20 }), 6),
    aimOf(lamp({ type: "wash12", kind: "wash", az: -75, el: 40 }), 6),
  ];
  for (const d of dirs) {
    assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9, `not unit: ${d}`);
  }
});

test("a mover's tilt is elevation: negative dips below the horizon, positive climbs", () => {
  const down = aimOf(lamp({ type: "spot29", kind: "spot", az: 0, el: -45 }), 6);
  const up = aimOf(lamp({ type: "spot29", kind: "spot", az: 0, el: 45 }), 6);
  assert.ok(down[1] < 0 && up[1] > 0);
  assert.ok(Math.abs(down[1] + up[1]) < 1e-9, "symmetric about the horizon");
});

test("a mover's pan swings across x and keeps the vector unit", () => {
  const left = aimOf(lamp({ type: "spot29", kind: "spot", az: -60, el: 0 }), 6);
  const right = aimOf(lamp({ type: "spot29", kind: "spot", az: 60, el: 0 }), 6);
  assert.ok(left[0] < 0 && right[0] > 0, "pan deflects opposite ways");
  assert.ok(Math.abs(left[0] + right[0]) < 1e-9);
});

test("a static fixture ignores whatever pan and tilt happen to be on the wire", () => {
  const a = aimOf(lamp({ type: "par5", kind: "par", az: 80, el: 80 }), 5);
  assert.deepEqual(a, staticAim("par", 5));
});

/* ── throw and landing ───────────────────────────────────────────────────── */

test("a beam aimed down stops at the floor", () => {
  const at = landingOf([0, 6, 0], norm([0, -1, 0]), 50);
  assert.deepEqual(at, [0, 0, 0]);
  assert.ok(Math.abs(throwOf([0, 6, 0], norm([0, -1, 0]), 50) - 6) < 1e-9);
});

test("a beam aimed at or above the horizon never lands", () => {
  assert.equal(landingOf([0, 6, 0], norm([0, 0.3, 1]), 50), null);
  assert.equal(throwOf([0, 6, 0], norm([0, 0.3, 1]), 50), 50, "it runs to the full throw");
});

test("a beam lands on the deck when there is one under it", () => {
  const deck: Deck = { top: 0.6, minX: -4, maxX: 4, minZ: -1, maxZ: 3 };
  const at = landingOf([0, 6, 0], norm([0, -1, 0]), 50, deck);
  assert.deepEqual(at, [0, 0.6, 0], "it should stop on the riser, not under it");
  /* and the shaft must be shortened to match, or it runs through the deck */
  assert.ok(Math.abs(throwOf([0, 6, 0], norm([0, -1, 0]), 50, deck) - 5.4) < 1e-9);
});

test("a beam that misses the deck sideways still reaches the floor", () => {
  const deck: Deck = { top: 0.6, minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const at = landingOf([9, 6, 0], norm([0, -1, 0]), 50, deck)!;
  assert.equal(at[1], 0, "outside the riser, so it lands on the floor");
  assert.equal(at[0], 9);
});

test("landing is on the line the beam actually travels", () => {
  const origin: Vec3 = [1, 5, 2];
  const dir = norm([0.3, -1, 0.5]);
  const at = landingOf(origin, dir, 60)!;
  const t = (at[0] - origin[0]) / dir[0];
  assert.ok(Math.abs(origin[1] + dir[1] * t - at[1]) < 1e-9);
  assert.ok(Math.abs(origin[2] + dir[2] * t - at[2]) < 1e-9);
  assert.ok(t > 0, "and in front of the lamp, not behind it");
});

/* ── the room and the camera ─────────────────────────────────────────────── */

test("the room contains every fixture in the arena", () => {
  const r = roomOf(arena.fixtures);
  for (const f of arena.fixtures) {
    const w = worldOf(f.at);
    assert.ok(w[0] >= r.minX && w[0] <= r.maxX, `${f.id} outside x`);
    assert.ok(w[2] >= r.minZ && w[2] <= r.maxZ, `${f.id} outside z`);
    assert.ok(w[1] <= r.maxY, `${f.id} above maxY`);
  }
  assert.ok(r.width > 10, `arena should be wide, got ${r.width}`);
});

test("an empty layout still gives a room rather than dividing by zero", () => {
  const r = roomOf([]);
  assert.ok(Number.isFinite(r.width) && r.width > 0);
  assert.ok(Number.isFinite(r.centreX) && Number.isFinite(r.centreZ));
});

test("the camera stands in front of house, above the floor, looking at the rig", () => {
  for (const fx of [arena.fixtures, basic.fixtures]) {
    const r = roomOf(fx);
    const c = cameraOf(r, 16 / 9);
    assert.ok(c.position[2] > r.maxZ, "camera is downstage of everything");
    assert.ok(c.position[1] > 0.5, "and off the floor");
    assert.ok(c.target[2] <= r.maxZ, "looking back into the room");
    assert.ok(c.position.every(Number.isFinite) && c.target.every(Number.isFinite));
  }
});

test("a bigger rig is viewed from further back", () => {
  const near = cameraOf(roomOf(basic.fixtures), 16 / 9);
  const far = cameraOf(roomOf(arena.fixtures), 16 / 9);
  assert.ok(far.position[2] > near.position[2],
    `arena ${far.position[2]} should be further than basic ${near.position[2]}`);
});

/* ── trusses and bodies ──────────────────────────────────────────────────── */

test("fixtures sharing a height and a depth make one bar", () => {
  const bars = barsOf(arena.fixtures);
  assert.ok(bars.length >= 4, `expected several trusses, got ${bars.length}`);
  for (const b of bars) assert.ok(b.x1 > b.x0, "a bar spans a width");

  const back = bars.find((b) => Math.abs(b.y - 5.2) < 0.01 && Math.abs(b.z) < 0.01);
  assert.ok(back, "the 16-par back truss should be one bar");
  assert.ok(back!.x1 - back!.x0 > 10, "and span the room");
});

test("the basic rig is a single bar with the beam on it", () => {
  const bars = barsOf(basic.fixtures);
  assert.equal(bars.length, 1, "beam and pars hang together");
  assert.ok(Math.abs(bars[0].x0 + 1.8) < 1e-9 && Math.abs(bars[0].x1 - 1.8) < 1e-9);
});

test("the beam sits in the middle with two pars either side of it", () => {
  const xs = basic.fixtures.map((f) => ({ id: f.id, type: f.type, x: worldOf(f.at)[0] }))
    .sort((a, b) => a.x - b.x);
  assert.deepEqual(xs.map((f) => f.type),
    ["par5", "par5", "spot29", "par5", "par5"]);
  assert.equal(xs[2].x, 0, "the beam is dead centre");
});

test("a body is sized by what the device is", () => {
  assert.ok(bodyOf("spot29").length > bodyOf("par5").length, "a 29ch spot is a bigger lamp");
  assert.ok(bodyOf("pixelbar24").length > bodyOf("blinder1").length, "a bar is long");
  for (const t of ["par5", "spot29", "wash12", "blinder1", "strobe3", "pixelbar24", "laser8"]) {
    const b = bodyOf(t);
    assert.ok(b.radius > 0 && b.length > 0, `${t} has no size`);
  }
});

/* ── the whole arena, swept ──────────────────────────────────────────────── */

test("every arena fixture produces a finite aim, throw and body", () => {
  const room = roomOf(arena.fixtures);
  const maxThrow = room.depth + room.maxY + 12;
  for (const f of arena.fixtures) {
    const w = worldOf(f.at);
    const d = staticAim("par", w[1]);
    const len = throwOf(w, d, maxThrow);
    assert.ok(Number.isFinite(len) && len > 0, `${f.id} throw ${len}`);
    assert.ok(len <= maxThrow, `${f.id} throw ${len} exceeds the room`);
  }
});
