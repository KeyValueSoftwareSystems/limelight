import { test } from "node:test";
import assert from "node:assert/strict";
import { spanOf, overlaps, tileForClip } from "./clips.ts";
import type { Clip } from "./types";

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
import { effectIdForPlanFx } from "./families.ts";
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

/* ── schema 2 ────────────────────────────────────────────────────────────────
   The catalogue above is schema 1: its tiles declare the plan's word as `fx`,
   so the two vocabularies met on their own. Production is schema 2, where a
   tile has `dimension` and `default_beats` and no `fx` at all. Every test above
   passed while the real timeline was broken, because none of them used the
   shape the server actually serves. These do. */

const CATALOGUE_V2: Effect[] = [
  { id: "impact", name: "Impact", blurb: "", kind: "gesture", dimension: "amount",
    default_beats: 1, dials: { amount: { default: 1 } } },
  { id: "blackout", name: "Blackout", blurb: "", kind: "gesture", dimension: "amount",
    default_beats: 1, dials: { amount: { default: 0 } } },
];

test("schema 2: a plan assignment resolves to a catalogue tile", () => {
  assert.equal(effectIdForPlanFx("white_blast"), "impact");
  assert.equal(effectIdForPlanFx("blackout"), "blackout");
  assert.equal(effectIdForPlanFx("not_a_plan_word"), null);
});

test("schema 2: taking over an arranger clip overrides it", () => {
  // p0 is a white_blast at bar 2; Impact is the tile that stands in for it.
  const clips = buildClips(PLAN, [{ type: "impact", bar: 2, beats: 1 }], CATALOGUE_V2, GRID);
  assert.equal(clips.find((c) => c.planId === "p0")?.overridden, true);
});

test("schema 2: a different tile at the same place overrides nothing", () => {
  const clips = buildClips(PLAN, [{ type: "blackout", bar: 2, beats: 1 }], CATALOGUE_V2, GRID);
  assert.equal(clips.find((c) => c.planId === "p0")?.overridden, false);
});

test("a taken-over clip stays overridden after the copy is moved away", () => {
  /* The whole point of `from`. Overlap alone let the machine's version come
     back the moment you dragged your copy off it — the duplicate-on-move bug. */
  const moved = buildClips(
    PLAN, [{ type: "impact", bar: 40, beats: 1, from: "p0" }], CATALOGUE_V2, GRID,
  );
  assert.equal(moved.find((c) => c.planId === "p0")?.overridden, true);
  assert.equal(moved.filter((c) => c.source === "mine").length, 1);
});

test("schema 2: an edit lands in its real family, not everything in one lane", () => {
  const [c] = buildClips(null, [{ type: "blackout", bar: 1, beats: 1 }], CATALOGUE_V2, GRID);
  assert.equal(c.family, "darkness");
  const [h] = buildClips(null, [{ type: "impact", bar: 1, beats: 1 }], CATALOGUE_V2, GRID);
  assert.equal(h.family, "hits");
});

/* ── clip -> the catalogue tile it came from ───────────────────────────────────
   Four vocabularies meet in tileForClip, and getting it wrong is silent: a null
   means the clip cannot be taken over, moved, resized or copied, and nothing
   says so. That is exactly the bug that froze every cue in a show file. */

const clip = (over: Partial<Clip>): Clip => ({
  key: "k", source: "auto", editIndex: null, planId: null, family: "hits",
  tile: null, fx: "white_blast", name: "n", bar: 1, beat: 1, beats: 1,
  startS: 0, endS: 1, params: {}, overridden: false, ...over,
});

/* Schema 2: the catalogue id IS the identity, and no tile carries `fx`. */
const SCHEMA2: Effect[] = [
  { id: "impact", name: "Impact", blurb: "", kind: "gesture", dimension: "amount", default_beats: 1 },
  { id: "stab", name: "Stab", blurb: "", kind: "gesture", dimension: "amount", default_beats: 1 },
];
/* Schema 1: tiles name the renderer type directly. */
const SCHEMA1: Effect[] = [
  { id: "impact", name: "Impact", blurb: "", fx: "white_blast", beats: 1 },
  { id: "impact_long", name: "Impact (long)", blurb: "", fx: "white_blast", beats: 4 },
];

test("a clip that names its tile is resolved by that, first", () => {
  assert.equal(tileForClip(clip({ tile: "stab", fx: "white_blast" }), SCHEMA2)?.id, "stab");
});

test("an arranger clip on a schema-2 catalogue resolves through the plan word", () => {
  /* No tile, no `fx` on any tile to match: the plan-word mapping is the only
     route left, and without it not one of the arranger's clips could be moved. */
  assert.equal(tileForClip(clip({ fx: "white_blast" }), SCHEMA2)?.id, "impact");
});

test("on a schema-1 catalogue the fx match wins, and length breaks the tie", () => {
  assert.equal(tileForClip(clip({ fx: "white_blast", beats: 4 }), SCHEMA1)?.id, "impact_long");
  assert.equal(tileForClip(clip({ fx: "white_blast", beats: 1 }), SCHEMA1)?.id, "impact");
  /* A length nothing offers still resolves, rather than falling through. */
  assert.equal(tileForClip(clip({ fx: "white_blast", beats: 3 }), SCHEMA1)?.id, "impact");
});

test("a tile the catalogue has never heard of is null, not a wrong guess", () => {
  assert.equal(tileForClip(clip({ fx: "not_an_effect" }), SCHEMA2), null);
  assert.equal(tileForClip(clip({ tile: "gone", fx: "also_gone" }), SCHEMA2), null);
});

test("a stale tile id still resolves if the clip's fx is known", () => {
  /* `tile` is a preference, not a veto: a show file written against an older
     catalogue must not leave its cues frozen. */
  assert.equal(tileForClip(clip({ tile: "retired", fx: "white_blast" }), SCHEMA1)?.id, "impact");
});
