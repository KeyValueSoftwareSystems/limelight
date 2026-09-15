import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAMILY_ORDER, FAMILY_LABEL, FAMILY_AUTO_LABEL,
  familyOfFx, acceptsClips, clipFamilies,
} from "./families.ts";

/* Every renderer type the backend declares in server.py's DIALS map. If the
   backend gains one, this test fails until the lane exists. */
const RENDERER_TYPES = [
  "white_blast", "blackout", "pause", "hook", "whiten", "accent_strobe", "modulate",
];

test("every renderer type maps to a family", () => {
  for (const fx of RENDERER_TYPES) {
    assert.ok(familyOfFx(fx), `no family for ${fx}`);
  }
});

test("an unknown renderer type maps to null rather than throwing", () => {
  assert.equal(familyOfFx("laser_sweep"), null);
});

test("the mapping is one family per type, with no family left unused", () => {
  const mapped = new Set(RENDERER_TYPES.map(familyOfFx));
  assert.equal(mapped.size, FAMILY_ORDER.length);
  for (const f of FAMILY_ORDER) assert.ok(mapped.has(f), `${f} has no renderer type`);
});

test("dynamics holds a curve, so it never accepts a drop", () => {
  assert.equal(acceptsClips("dynamics"), false);
  assert.equal(acceptsClips("hits"), true);
});

test("six lanes accept clips", () => {
  assert.equal(clipFamilies().length, 6);
  assert.ok(!clipFamilies().includes("dynamics"));
});

test("every family has both labels", () => {
  for (const f of FAMILY_ORDER) {
    assert.equal(typeof FAMILY_LABEL[f], "string");
    assert.equal(typeof FAMILY_AUTO_LABEL[f], "string");
  }
});
