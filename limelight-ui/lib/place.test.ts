import { test } from "node:test";
import assert from "node:assert/strict";
import { placementBeats } from "./place.ts";
import type { Effect, Grid, Section } from "./types";

/* 120bpm, 4/4: a beat is half a second, a bar is two. */
const grid: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0, bars: 64 };

const sections: Section[] = [
  { name: "intro", start: 0, end: 8 },      // 16 beats
  { name: "verse", start: 8, end: 24 },     // 32 beats
];

const fx = (over: Partial<Effect>): Effect =>
  ({ id: "x", name: "X", blurb: "", ...over }) as Effect;

test("a gesture keeps the length it declares", () => {
  assert.equal(placementBeats(fx({ kind: "gesture", default_beats: 16 }), 3, grid, sections), 16);
  assert.equal(placementBeats(fx({ kind: "gesture", default_beats: 1 }), 3, grid, sections), 1);
});

test("a schema-1 tile's own `beats` wins over everything", () => {
  assert.equal(placementBeats(fx({ kind: "state", beats: 6 }), 3, grid, sections), 6);
});

test("a state fills the rest of the section it is dropped into", () => {
  /* Dropped 2s into an 8s intro: six seconds left, twelve beats. */
  assert.equal(placementBeats(fx({ kind: "state", default_beats: 0 }), 2, grid, sections), 12);
  /* Dropped at the top of the verse: the whole verse, thirty-two beats. */
  assert.equal(placementBeats(fx({ kind: "state", default_beats: 0 }), 8, grid, sections), 32);
});

test("a binding fills its section the same way a state does", () => {
  assert.equal(placementBeats(fx({ kind: "binding", default_beats: 0 }), 8, grid, sections), 32);
});

test("a state dropped where there is no section still gets a usable bar", () => {
  assert.equal(placementBeats(fx({ kind: "state", default_beats: 0 }), 99, grid, sections), 4);
  assert.equal(placementBeats(fx({ kind: "state", default_beats: 0 }), 2, grid, []), 4);
});

test("a state dropped on the last sliver of a section is never shorter than a beat", () => {
  const beats = placementBeats(fx({ kind: "state", default_beats: 0 }), 7.99, grid, sections);
  assert.ok(beats >= 1, `expected at least a beat, got ${beats}`);
});

test("a gesture that declares nothing gets a bar rather than nothing", () => {
  assert.equal(placementBeats(fx({ kind: "gesture", default_beats: 0 }), 2, grid, sections), 4);
  assert.equal(placementBeats(fx({}), 2, grid, sections), 4);
});

test("never zero — the case that put 16px stubs on the timeline", () => {
  for (const kind of ["state", "binding", "gesture"] as const) {
    for (const at of [0, 2, 8, 23.9, 99]) {
      const beats = placementBeats(fx({ kind, default_beats: 0 }), at, grid, sections);
      assert.ok(beats > 0, `${kind} at ${at}s came out ${beats}`);
    }
  }
});
