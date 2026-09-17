/**
 * Reading a frame back into lamp states.
 *
 * This is the path that decides what the stage preview draws, and it is easy to
 * break silently: a wrong channel offset does not throw, it just draws a lamp the
 * wrong colour on one rig. So the fixtures here are the real arena layout and the
 * real driver profiles, and every device type is asserted separately.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { placeFixtures, readFixtures, trimFixtures, meanColour, unplaceFixture, roomBounds } from "./fixtures.ts";
import { profileOf } from "./profiles.ts";
import type { Fixture, Show, TrimState } from "./types.ts";

const TRIM: TrimState = {
  master: 1, par: 1, head: 1, blackout: false, full_on: false, strobe_kill: false, hold: false,
  lead_ms: 0,
};

const LAYOUT = path.join(
  import.meta.dirname, "..", "..", "readers", "lights", "keycode-arena.layout.json",
);

const layout = JSON.parse(fs.readFileSync(LAYOUT, "utf8")) as { fixtures: Fixture[] };
const CHANNELS = 512;

function showOf(fixtures: Fixture[]): Show {
  return { fixtures, channels: CHANNELS, fps: 40, frame_count: 1 } as unknown as Show;
}

/** A frame with one fixture driven, written through its own profile's offsets. */
function frameWith(writes: Array<{ id: string; set: Record<string, number> }>): Uint8Array {
  const f = new Uint8Array(CHANNELS);
  for (const w of writes) {
    const fx = layout.fixtures.find((x) => x.id === w.id);
    assert.ok(fx, `no fixture ${w.id} in the arena layout`);
    const prof = profileOf(fx!.type);
    for (const [role, v] of Object.entries(w.set)) {
      const off = (prof.at as Record<string, number | undefined>)[role];
      assert.ok(off !== undefined, `${fx!.type} has no ${role} channel`);
      f[fx!.address - 1 + off!] = v;
    }
  }
  return f;
}

const place = placeFixtures(showOf(layout.fixtures));
const lampById = (id: string) => place.lamps.find((l) => l.id === id.replace(/_/g, " "));

/* ── placement ───────────────────────────────────────────────────────────── */

test("every fixture in the layout is placed", () => {
  assert.equal(place.lamps.length, layout.fixtures.length);
});

test("placement is on screen", () => {
  for (const l of place.lamps) {
    assert.ok(l.x >= 0 && l.x <= 1, `${l.id} x=${l.x}`);
    assert.ok(l.y >= 0 && l.y <= 1, `${l.id} y=${l.y}`);
  }
});

test("lamps are sorted back to front, so a near truss draws over a far one", () => {
  for (let i = 1; i < place.lamps.length; i++) {
    assert.ok(place.lamps[i].depth >= place.lamps[i - 1].depth);
  }
});

test("a higher trim sits higher on screen", () => {
  const back = lampById("par_back_01")!;   // 5.2 m
  const floorPod = lampById("par_floor_01")!; // 0.3 m
  assert.ok(back.y < floorPod.y, `back ${back.y} should be above pod ${floorPod.y}`);
});

test("depth is read from the layout, not assumed flat", () => {
  const back = lampById("par_back_01")!;      // depth 0.0
  const front = lampById("wash_01")!;         // depth 4.4
  assert.equal(back.depth, 0);
  assert.equal(front.depth, 1);
  assert.ok(front.scale > back.scale, "a nearer lamp draws larger");
});

test("movers and static lamps are split by capability, not by type name", () => {
  const moverTypes = new Set(place.heads.map((l) => l.type));
  assert.deepEqual([...moverTypes].sort(), ["laser8", "spot29", "wash12"]);
  assert.ok(place.pars.every((l) => !["laser8", "spot29", "wash12"].includes(l.type)));
});

/* ── reading each device type ────────────────────────────────────────────── */

test("an RGBW par reads its colour and level", () => {
  const f = frameWith([{ id: "par_back_01", set: { master: 255, r: 255, g: 0, b: 0 } }]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const l = st.lamps.find((x) => x.id === "par back 01")!;
  assert.ok(l.k > 0.99, `k=${l.k}`);
  assert.deepEqual(l.rgb, [1, 0, 0]);
  assert.equal(l.kind, "par");
});

test("a par's brightness is on its colour channels, so half red is half lit", () => {
  const f = frameWith([{ id: "par_back_01", set: { master: 255, r: 128, g: 0, b: 0 } }]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const l = st.lamps.find((x) => x.id === "par back 01")!;
  assert.ok(l.k > 0.3 && l.k < 0.9, `k=${l.k}`);
  assert.deepEqual(l.rgb, [1, 0, 0]);
});

test("a CMY spot reads subtractive colour back as the colour it makes", () => {
  /* red = block green and blue */
  const f = frameWith([{ id: "spot_1", set: { master: 255, c: 0, m: 255, y: 255 } }]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const l = st.lamps.find((x) => x.id === "spot 1")!;
  assert.ok(l.k > 0.99, `k=${l.k}`);
  assert.deepEqual(l.rgb, [1, 0, 0], "CMY 0/255/255 should read as red");
  assert.equal(l.kind, "spot");
});

test("a spot with no flags in is white", () => {
  const f = frameWith([{ id: "spot_1", set: { master: 255, c: 0, m: 0, y: 0 } }]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const l = st.lamps.find((x) => x.id === "spot 1")!;
  assert.deepEqual(l.rgb, [1, 1, 1]);
});

test("a zoom channel widens the beam between the fixture's real limits", () => {
  const prof = profileOf("spot29");
  const narrow = readFixtures(0, frameWith([{ id: "spot_1", set: { master: 255, zoom: 0 } }]),
    showOf(layout.fixtures), place)!.lamps.find((x) => x.id === "spot 1")!;
  const wide = readFixtures(0, frameWith([{ id: "spot_1", set: { master: 255, zoom: 255 } }]),
    showOf(layout.fixtures), place)!.lamps.find((x) => x.id === "spot 1")!;
  assert.equal(narrow.spreadDeg, prof.beamDeg[0]);
  assert.equal(wide.spreadDeg, prof.beamDeg[1]);
  assert.ok(wide.spreadDeg > narrow.spreadDeg);
});

test("a shutter-and-strobe channel reads open as NOT strobing", () => {
  const prof = profileOf("wash12");
  const open = readFixtures(0, frameWith([{ id: "wash_01", set: { master: 255, strobe: prof.strobeOpen! } }]),
    showOf(layout.fixtures), place)!.lamps.find((x) => x.id === "wash 01")!;
  assert.equal(open.strobe, 0, "shutter open is not a strobe");
  const fast = readFixtures(0, frameWith([{ id: "wash_01", set: { master: 255, strobe: 255 } }]),
    showOf(layout.fixtures), place)!.lamps.find((x) => x.id === "wash 01")!;
  assert.ok(fast.strobe > 0.9, `strobe=${fast.strobe}`);
});

test("a blinder has no colour channels and reads as warm white", () => {
  const f = frameWith([{ id: "blinder_1", set: { master: 255 } }]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const l = st.lamps.find((x) => x.id === "blinder 1")!;
  assert.ok(l.k > 0.99);
  assert.equal(l.kind, "blinder");
  assert.ok(l.rgb[0] >= l.rgb[1] && l.rgb[1] >= l.rgb[2], `warm, got ${l.rgb}`);
});

test("a pixel bar reads each cell separately", () => {
  const fx = layout.fixtures.find((x) => x.id === "strip_1")!;
  const f = new Uint8Array(CHANNELS);
  /* cell 0 red, cell 3 blue, the rest dark */
  f[fx.address - 1 + 0] = 255;
  f[fx.address - 1 + 3 * 4 + 2] = 255;
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const l = st.lamps.find((x) => x.id === "strip 1")!;
  assert.equal(l.kind, "strip");
  assert.equal(l.cells?.length, 6);
  assert.deepEqual(l.cells![0].rgb, [1, 0, 0]);
  assert.deepEqual(l.cells![3].rgb, [0, 0, 1]);
  assert.ok(l.cells![1].k === 0, "an unlit cell stays dark");
});

test("a mover's aim becomes a screen rotation", () => {
  const centred = readFixtures(0, frameWith([{ id: "spot_1", set: { master: 255, pan: 128, tilt: 128 } }]),
    showOf(layout.fixtures), place)!.lamps.find((x) => x.id === "spot 1")!;
  const swung = readFixtures(0, frameWith([{ id: "spot_1", set: { master: 255, pan: 220, tilt: 128 } }]),
    showOf(layout.fixtures), place)!.lamps.find((x) => x.id === "spot 1")!;
  assert.notEqual(centred.rot, swung.rot, "panning should change where the beam points");
  assert.ok(Number.isFinite(centred.rot) && Number.isFinite(centred.reach));
});

test("a dark frame lights nothing", () => {
  const st = readFixtures(0, new Uint8Array(CHANNELS), showOf(layout.fixtures), place)!;
  assert.ok(st.lamps.every((l) => l.k === 0), "every lamp should be dark");
});

test("reading past the end of the buffer is null, not a crash", () => {
  assert.equal(readFixtures(99, new Uint8Array(CHANNELS), showOf(layout.fixtures), place), null);
});

/* ── trims ───────────────────────────────────────────────────────────────── */

test("a blackout trim kills every lamp without editing the show", () => {
  const f = frameWith([
    { id: "par_back_01", set: { master: 255, r: 255, g: 255, b: 255 } },
    { id: "spot_1", set: { master: 255 } },
  ]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const out = trimFixtures(st, { ...TRIM, blackout: true });
  assert.ok(out.lamps.every((l) => l.k === 0));
  assert.ok(st.lamps.some((l) => l.k > 0), "the source states are untouched");
});

test("par and head trims scale their own groups", () => {
  const f = frameWith([
    { id: "par_back_01", set: { master: 255, r: 255, g: 255, b: 255 } },
    { id: "spot_1", set: { master: 255 } },
  ]);
  const st = readFixtures(0, f, showOf(layout.fixtures), place)!;
  const out = trimFixtures(st, { ...TRIM, par: 0 });
  assert.equal(out.lamps.find((l) => l.id === "par back 01")!.k, 0);
  assert.ok(out.lamps.find((l) => l.id === "spot 1")!.k > 0.9, "the spot is a head, not a par");
});

/* ── an older rig still reads ────────────────────────────────────────────── */

test("the original par7/head13 rig still reads correctly", () => {
  const club = JSON.parse(fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "readers", "lights", "club16-2head.layout.json"),
    "utf8",
  )) as { fixtures: Fixture[] };
  const p = placeFixtures(showOf(club.fixtures));
  assert.equal(p.lamps.length, 18);
  assert.equal(p.heads.length, 2, "two head13 movers");
  assert.equal(p.pars.length, 16);

  const par = club.fixtures.find((x) => x.type === "par7")!;
  const f = new Uint8Array(CHANNELS);
  f[par.address - 1 + 0] = 255;   // master
  f[par.address - 1 + 1] = 255;   // red
  const st = readFixtures(0, f, showOf(club.fixtures), p)!;
  const l = st.lamps.find((x) => x.addr === par.address)!;
  assert.ok(l.k > 0.99, `k=${l.k}`);
  assert.deepEqual(l.rgb, [1, 0, 0]);
});

test("meanColour weights by brightness", () => {
  const c = meanColour([
    { k: 1, rgb: [1, 0, 0] },
    { k: 0, rgb: [0, 0, 1] },
  ]);
  assert.deepEqual(c, [1, 0, 0]);
  assert.equal(meanColour([{ k: 0, rgb: [1, 1, 1] }]), null);
});

/* placeFixtures and drawPar are shared by EVERY rig. The arch band and the halo
   cap are safe to land only because these pin what a line rig does. */
test("REGRESSION: a line rig keeps the old screen band", () => {
  const DESK = [
    { id: "par_1", type: "par7", address: 1, at: [-1, 0, 2.4] as [number, number, number] },
    { id: "par_8", type: "par7", address: 8, at: [-0.5, 0, 2.4] as [number, number, number] },
    { id: "par_15", type: "par7", address: 15, at: [0.5, 0, 2.4] as [number, number, number] },
    { id: "par_22", type: "par7", address: 22, at: [1, 0, 2.4] as [number, number, number] },
    { id: "head", type: "head13", address: 29, at: [0, 0.3, 2.6] as [number, number, number] },
  ];
  const p = placeFixtures({ fixtures: DESK } as never);
  const ys = p.lamps.map((l) => l.y);
  assert.ok(Math.min(...ys) >= 0.38, `top lamp at ${Math.min(...ys)}`);
  assert.ok(Math.max(...ys) <= 0.82, `bottom lamp at ${Math.max(...ys)}`);
  assert.ok(p.lamps.every((l) => l.spacing > 0 && l.spacing <= 1));
});

test("a fixture dragged on the stage lands where it was dropped", () => {
  const room = { width: 14, depth: 6, height: 7 };
  const bounds = roomBounds(room)!;
  assert.ok(bounds);

  const at: Array<[number, number, number]> = [
    [-6.2, 0, 1.1], [-2.5, 1.4, 3.2], [0, 3.0, 6.4], [3.75, 5.9, 2.0], [6.5, 4.2, 5.55],
  ];
  const fixtures = at.map((a, i) => ({
    id: `f${i}`, type: "par5", at: a, universe: 0, address: i * 5 + 1,
  }));

  const place = placeFixtures({ fixtures, geometry: "line" } as never, bounds);
  assert.equal(place.lamps.length, at.length);

  for (const l of place.lamps) {
    const i = Number(l.id.replace(/\D/g, ""));
    const back = unplaceFixture({ x: l.x, y: l.y }, l.depth, bounds, "line");
    assert.ok(Math.abs(back.x - at[i][0]) < 1e-9, `x ${back.x} vs ${at[i][0]}`);
    assert.ok(Math.abs(back.height - at[i][2]) < 1e-9, `z ${back.height} vs ${at[i][2]}`);
  }
});

test("a declared room pins the extent, so adding a fixture does not move the others", () => {
  const room = { width: 14, depth: 6, height: 7 };
  const fx = (id: string, x: number, y: number, z: number, addr: number) => ({
    id, type: "par5", at: [x, y, z] as [number, number, number], universe: 0, address: addr,
  });
  const before = [fx("a", -3, 0, 3, 1), fx("c", 3, 0, 3, 6)];
  const after = [...before, fx("b", 8, 0, 3, 11)];
  const xOf = (list: unknown[], id: string, r?: unknown) =>
    placeFixtures({ fixtures: list, room: r } as never).lamps.find((l) => l.id === id)!.x;

  assert.ok(
    Math.abs(xOf(before, "c") - xOf(after, "c")) > 0.2,
    "without a room the rig rescales around whatever it happens to span",
  );
  assert.ok(
    Math.abs(xOf(before, "c", room) - xOf(after, "c", room)) < 1e-9,
    "with a room declared, a fixture stays where it hangs",
  );
});
