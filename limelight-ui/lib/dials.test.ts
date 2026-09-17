import { test } from "node:test";
import assert from "node:assert/strict";
import { dialsOf, kindNote } from "./dials.ts";
import type { Effect } from "./types";

const fx = (over: Partial<Effect>): Effect =>
  ({ id: "x", name: "X", blurb: "", ...over }) as Effect;

/* The real Wash, as the catalogue serves it. */
const wash = fx({
  kind: "state",
  dials: {
    amount: { default: 0.55, min: 0.3, max: 0.8 },
    colour: { default: [0.2, 0.4, 1] as unknown as number },
    extent: { default: "all" as unknown as number },
  },
});

test("a level reads as the percentage range the inspector shows", () => {
  const amount = dialsOf(wash).find((d) => d.id === "amount")!;
  assert.equal(amount.label, "Intensity");
  assert.equal(amount.value, "30–80%");
  assert.equal(amount.editable, true);
});

test("a colour is carried as a swatch, not as three decimals", () => {
  const colour = dialsOf(wash).find((d) => d.id === "colour")!;
  assert.deepEqual(colour.swatches, [[0.2, 0.4, 1]]);
  assert.equal(colour.value, "");
  assert.equal(colour.editable, true);
});

test("a list of colours becomes a row of swatches", () => {
  const d = dialsOf(fx({ dials: { colours: { default: [[0.1, 0.55, 1], [1, 0.3, 0.55]] as unknown as number } } }));
  assert.equal(d[0].swatches.length, 2);
});

test("what the inspector cannot change is still listed, but not as editable", () => {
  const extent = dialsOf(wash).find((d) => d.id === "extent")!;
  assert.equal(extent.value, "all");
  assert.equal(extent.editable, false);
});

test("editable dials are listed first", () => {
  const order = dialsOf(wash).map((d) => d.editable);
  assert.deepEqual(order, [...order].sort((a, b) => Number(b) - Number(a)));
});

test("the clip's length is not listed as a dial — it is the clip", () => {
  const d = dialsOf(fx({ dials: { for_beats: { default: 1, min: 1, max: 4 } } }));
  assert.deepEqual(d, []);
});

test("a beat count keeps its unit", () => {
  const d = dialsOf(fx({ dials: { every_beats: { default: 1, min: 0.25, max: 8 } } }));
  assert.equal(d[0].label, "Every");
  assert.equal(d[0].value, "0.25–8 beats");
});

test("a dial nobody has named yet still reads as English", () => {
  const d = dialsOf(fx({ dials: { wobble_width: { default: 3 } } }));
  assert.equal(d[0].label, "Wobble width");
  assert.equal(d[0].value, "3");
});

test("an effect with no dials lists nothing rather than throwing", () => {
  assert.deepEqual(dialsOf(fx({})), []);
});

test("the kind note says how the effect behaves in time", () => {
  assert.match(kindNote(fx({ kind: "state" })), /section/);
  assert.match(kindNote(fx({ kind: "binding" })), /track/);
  assert.match(kindNote(fx({ kind: "gesture" })), /length/);
  assert.match(kindNote(fx({})), /length/);
});
