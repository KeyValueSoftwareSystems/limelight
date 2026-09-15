import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILY_VAR, PHASE_VAR, familyHue, phaseTint } from "./tokens.ts";
import { FAMILY_ORDER } from "./families.ts";

test("every lane family has a hue variable", () => {
  for (const f of FAMILY_ORDER) {
    assert.ok(FAMILY_VAR[f], `no hue variable for ${f}`);
  }
});

test("no two families share a hue variable", () => {
  const vars = FAMILY_ORDER.map((f) => FAMILY_VAR[f]);
  assert.equal(new Set(vars).size, vars.length);
});

test("familyHue returns a css var reference, not a raw colour", () => {
  assert.equal(familyHue("hits"), "var(--fam-hits)");
  assert.ok(!familyHue("wash").startsWith("#"));
});

/* The phase contexts the arranger actually emits, observed on real scores. */
const REAL_PHASES = [
  "intro", "drop", "silence", "break", "verse", "build", "final_drop", "outro",
];

test("every phase the arranger emits has a tint", () => {
  for (const p of REAL_PHASES) {
    assert.ok(PHASE_VAR[p], `no tint for phase ${p}`);
  }
});

test("an unknown or absent phase falls back rather than breaking", () => {
  assert.equal(phaseTint("nonesuch"), "var(--phase-unknown)");
  assert.equal(phaseTint(null), "var(--phase-unknown)");
  assert.equal(phaseTint(undefined), "var(--phase-unknown)");
});

test("a known phase resolves to its own tint", () => {
  assert.equal(phaseTint("final_drop"), "var(--phase-final-drop)");
});
