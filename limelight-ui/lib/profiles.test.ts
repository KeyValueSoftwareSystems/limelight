/**
 * lib/profiles.ts is a mirror of the driver profiles the bake pipeline reads.
 * A mirror that can drift is worse than no mirror: the renderer would read the
 * wrong byte and draw a lamp the wrong colour, silently and only on one rig.
 * So this reads the real JSON off disk and compares, rather than restating it.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { PROFILES, profileOf, kindOf, moves, rigSummary } from "./profiles.ts";

const DIR = path.join(import.meta.dirname, "..", "..", "readers", "lights", "drivers", "profiles");

interface RawChannel { role: string; default?: number }
interface RawProfile {
  type: string;
  footprint: number;
  brightness?: string;
  channels: RawChannel[];
  beam?: { angle_deg?: number; field_deg?: number };
  zoom_deg?: [number, number];
  strobe_range?: { open: number };
  cells?: number;
  invented?: boolean;
}

const read = (t: string): RawProfile =>
  JSON.parse(fs.readFileSync(path.join(DIR, `${t}.profile.json`), "utf8"));

/* role in the profile -> key in our `at` table. Roles we deliberately ignore
   (keep_zero, speed, focus, frost, iris, strobe_duration) are absent: the page
   does not draw them. */
const ROLE_TO_KEY: Record<string, string> = {
  master: "master",
  "colour.r": "r", "colour.g": "g", "colour.b": "b", "colour.w": "w",
  "colour.c": "c", "colour.m": "m", "colour.y": "y",
  strobe: "strobe", pan: "pan", pan_fine: "panFine", tilt: "tilt", tilt_fine: "tiltFine",
  colour_wheel: "wheel", gobo: "gobo", prism: "prism", zoom: "zoom",
};

test("the profile directory is readable from here", () => {
  assert.ok(fs.existsSync(DIR), `no profiles at ${DIR}`);
});

test("every profile on disk is mirrored", () => {
  const onDisk = fs.readdirSync(DIR)
    .filter((f) => f.endsWith(".profile.json"))
    .map((f) => f.replace(".profile.json", ""))
    .sort();
  assert.deepEqual(Object.keys(PROFILES).sort(), onDisk,
    "lib/profiles.ts and readers/lights/drivers/profiles/ disagree on which devices exist");
});

for (const type of Object.keys(PROFILES)) {
  test(`${type}: footprint matches the driver profile`, () => {
    assert.equal(PROFILES[type].footprint, read(type).footprint);
  });

  test(`${type}: every mirrored channel offset points at the right role`, () => {
    const raw = read(type);
    const mine = PROFILES[type].at as Record<string, number | undefined>;
    for (const [key, offset] of Object.entries(mine)) {
      if (offset === undefined) continue;
      const role = raw.channels[offset]?.role;
      assert.ok(role !== undefined, `${type}.${key} offset ${offset} is past the footprint`);
      assert.equal(ROLE_TO_KEY[role], key,
        `${type}.${key} points at offset ${offset}, which is role "${role}"`);
    }
  });

  test(`${type}: no drawable role on disk is missing from the mirror`, () => {
    const raw = read(type);
    const mine = PROFILES[type].at as Record<string, number | undefined>;
    raw.channels.forEach((c, i) => {
      const key = ROLE_TO_KEY[c.role];
      if (!key) return;                       // a role the page does not draw
      if (PROFILES[type].cells && i >= 4) return;  // a pixel device repeats its cells
      assert.equal(mine[key], i,
        `${type} has role "${c.role}" at offset ${i}; the mirror says ${mine[key]}`);
    });
  });

  test(`${type}: brightness matches`, () => {
    const raw = read(type);
    const expected = raw.brightness
      ?? (raw.channels.some((c) => c.role === "colour.r") ? "colour" : "master");
    assert.equal(PROFILES[type].brightness, expected);
  });

  test(`${type}: beam angles come from the profile`, () => {
    const raw = read(type);
    const [lo, hi] = PROFILES[type].beamDeg;
    assert.ok(lo <= hi, `${type} beam range is inverted: ${lo}..${hi}`);
    if (raw.zoom_deg) {
      assert.deepEqual([lo, hi], raw.zoom_deg, `${type} should mirror its zoom range`);
    } else if (raw.beam?.angle_deg !== undefined) {
      assert.equal(lo, raw.beam.angle_deg, `${type} narrow end should be the GDTF beam angle`);
    }
  });

  test(`${type}: strobeOpen and cells and invented match`, () => {
    const raw = read(type);
    assert.equal(PROFILES[type].strobeOpen, raw.strobe_range?.open);
    assert.equal(PROFILES[type].cells, raw.cells);
    assert.equal(PROFILES[type].invented ?? false, raw.invented ?? false);
  });
}

test("an unknown device type still draws rather than vanishing", () => {
  assert.equal(profileOf("nonesuch"), PROFILES.par7);
  assert.equal(kindOf("nonesuch"), "par");
});

test("moves() is true exactly for the devices that aim", () => {
  const movers = Object.keys(PROFILES).filter(moves).sort();
  assert.deepEqual(movers, ["head13", "laser8", "spot29", "wash12"]);
});

/* The rig line is the only place a person reads a rig before choosing it, so it
   has to count by what a device DOES and stay in the order a lighting person
   would say it — movers, then washes, then everything that only hits. */
test("rigSummary counts a rig by kind, in the order a lighting person says it", () => {
  assert.equal(
    rigSummary({ par5: 22, wash12: 6, spot29: 8, blinder1: 4, strobe3: 2, laser8: 2, pixelbar24: 2 }),
    "8 beams \u00b7 6 washes \u00b7 22 pars \u00b7 2 strips \u00b7 4 blinders \u00b7 2 strobes \u00b7 2 lasers",
  );
});

test("rigSummary merges device types that do the same job", () => {
  /* par7 and par5 are different fixtures and one rig line: both are pars. */
  assert.equal(rigSummary({ par7: 4, par5: 2 }), "6 pars");
});

test("rigSummary says one of a thing in the singular", () => {
  assert.equal(rigSummary({ par7: 4, head13: 1 }), "1 beam \u00b7 4 pars");
});

test("rigSummary takes the separator its caller reads in", () => {
  assert.equal(rigSummary({ par7: 4, head13: 1 }, ", "), "1 beam, 4 pars");
});

test("rigSummary on a rig it cannot count is empty, not a crash", () => {
  assert.equal(rigSummary(undefined), "");
  assert.equal(rigSummary({}), "");
});
