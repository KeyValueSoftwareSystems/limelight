import { test } from "node:test";
import assert from "node:assert/strict";
import { spanOf, overlaps } from "./clips.ts";

test("bar 1 beat 1 is beat index 0", () => {
  assert.deepEqual(spanOf(1, 1, 4, 4), { from: 0, to: 4 });
});

test("a later bar starts a whole bar of beats further on", () => {
  assert.deepEqual(spanOf(2, 1, 1, 4), { from: 4, to: 5 });
  assert.deepEqual(spanOf(17, 1, 1, 4), { from: 64, to: 65 });
});

test("the beat within a bar offsets the start", () => {
  assert.deepEqual(spanOf(1, 3, 2, 4), { from: 2, to: 4 });
  assert.deepEqual(spanOf(2, 4, 1, 4), { from: 7, to: 8 });
});

test("beats_per_bar other than 4 is honoured", () => {
  assert.deepEqual(spanOf(2, 1, 3, 3), { from: 3, to: 6 });
});

test("overlap is half-open, so touching spans do not overlap", () => {
  assert.equal(overlaps({ from: 0, to: 4 }, { from: 4, to: 8 }), false);
  assert.equal(overlaps({ from: 4, to: 8 }, { from: 0, to: 4 }), false);
});

test("overlap catches partial and full containment either way round", () => {
  assert.equal(overlaps({ from: 0, to: 4 }, { from: 3, to: 8 }), true);
  assert.equal(overlaps({ from: 0, to: 8 }, { from: 3, to: 4 }), true);
  assert.equal(overlaps({ from: 3, to: 4 }, { from: 0, to: 8 }), true);
});

import { buildClips } from "./clips.ts";
import type { Effect, Grid } from "./types";

const GRID: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0 };

const CATALOGUE: Effect[] = [
  { id: "stab", name: "Stab", blurb: "", fx: "white_blast", beats: 1,
    params: { strength: 0.9, coverage: "inner", tone: "key" } },
  { id: "cut", name: "Cut", blurb: "", fx: "blackout", beats: 1,
    params: { strength: 1 } },
];

test("an edit becomes a clip in its family's lane", () => {
  const clips = buildClips(null, [{ type: "stab", bar: 2, beats: 2 }], CATALOGUE, GRID);
  assert.equal(clips.length, 1);
  const c = clips[0];
  assert.equal(c.source, "mine");
  assert.equal(c.family, "hits");
  assert.equal(c.tile, "stab");
  assert.equal(c.fx, "white_blast");
  assert.equal(c.name, "Stab");
  assert.equal(c.editIndex, 0);
  assert.equal(c.bar, 2);
  assert.equal(c.beat, 1);
  assert.equal(c.beats, 2);
});

test("beat defaults to 1 when the edit omits it", () => {
  const [c] = buildClips(null, [{ type: "stab", bar: 3, beats: 1 }], CATALOGUE, GRID);
  assert.equal(c.beat, 1);
  assert.equal(c.startS, 4);
});

test("a mid-bar beat resolves to the right seconds", () => {
  const [c] = buildClips(null, [{ type: "stab", bar: 2, beat: 3, beats: 2 }], CATALOGUE, GRID);
  assert.equal(c.startS, 3);
  assert.equal(c.endS, 4);
});

test("edit params override the tile's own dials", () => {
  const [c] = buildClips(
    null,
    [{ type: "stab", bar: 1, beats: 1, params: { coverage: "outer" } }],
    CATALOGUE, GRID,
  );
  assert.equal(c.params.coverage, "outer");
  assert.equal(c.params.tone, "key");
  assert.equal(c.params.strength, 0.9);
});

test("an edit naming no known tile is dropped, as the server drops it", () => {
  const clips = buildClips(null, [{ type: "nonesuch", bar: 1, beats: 1 }], CATALOGUE, GRID);
  assert.equal(clips.length, 0);
});

test("an off edit draws nothing", () => {
  const clips = buildClips(
    null, [{ type: "stab", bar: 1, beats: 1, off: true }], CATALOGUE, GRID,
  );
  assert.equal(clips.length, 0);
});

test("editIndex points into the original edits array, gaps and all", () => {
  const [c] = buildClips(
    null,
    [{ type: "nonesuch", bar: 1, beats: 1 }, { type: "cut", bar: 5, beats: 1 }],
    CATALOGUE, GRID,
  );
  assert.equal(c.editIndex, 1);
  assert.equal(c.family, "darkness");
});

import type { ShowPlan } from "./types";

const PLAN: ShowPlan = {
  punctuation: [
    { id: "p0", fx: "white_blast", bar: 2, beat: 1, beats: 1, params: {}, context: "drop" },
    { id: "p1", fx: "blackout",    bar: 6, beat: 1, beats: 2, params: {}, context: "silence" },
    { id: "p2", fx: "modulate",    bar: 9, beat: 1, beats: 4, params: {}, context: "drop" },
  ],
  dynamics: [],
  looks: [],
};

test("the arranger's punctuation becomes ghost clips", () => {
  const clips = buildClips(PLAN, [], CATALOGUE, GRID);
  const autos = clips.filter((c) => c.source === "auto");
  assert.equal(autos.length, 2);
  assert.equal(autos[0].planId, "p0");
  assert.equal(autos[0].family, "hits");
  assert.equal(autos[0].tile, null);
  assert.equal(autos[0].name, "Hit");
  assert.equal(autos[0].overridden, false);
});

test("a modulate assignment is a curve, not a clip", () => {
  const clips = buildClips(PLAN, [], CATALOGUE, GRID);
  assert.ok(!clips.some((c) => c.fx === "modulate"));
});

test("your clip overrides the arranger's of the same renderer type", () => {
  const clips = buildClips(PLAN, [{ type: "stab", bar: 2, beats: 1 }], CATALOGUE, GRID);
  const p0 = clips.find((c) => c.planId === "p0");
  assert.equal(p0?.overridden, true);
});

test("a different renderer type at the same place overrides nothing", () => {
  const clips = buildClips(PLAN, [{ type: "cut", bar: 2, beats: 1 }], CATALOGUE, GRID);
  assert.equal(clips.find((c) => c.planId === "p0")?.overridden, false);
});

test("a clip that only touches an auto clip does not override it", () => {
  // p0 occupies beats [4,5). An edit at bar 1 occupies [0,4) — adjacent, not overlapping.
  const clips = buildClips(PLAN, [{ type: "stab", bar: 1, beats: 4 }], CATALOGUE, GRID);
  assert.equal(clips.find((c) => c.planId === "p0")?.overridden, false);
});

test("an off edit overrides without drawing anything", () => {
  const clips = buildClips(
    PLAN, [{ type: "cut", bar: 6, beats: 2, off: true }], CATALOGUE, GRID,
  );
  assert.equal(clips.find((c) => c.planId === "p1")?.overridden, true);
  assert.equal(clips.filter((c) => c.source === "mine").length, 0);
});

test("clips come back in time order regardless of source", () => {
  const clips = buildClips(PLAN, [{ type: "stab", bar: 1, beats: 1 }], CATALOGUE, GRID);
  const starts = clips.map((c) => c.startS);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});
