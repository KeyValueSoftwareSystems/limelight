import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planToEdits, editsToPlan, type V2Plan } from "./planConvert.ts";
import type { Show, Effect } from "./types";

/* 120 BPM, 4/4, first beat at 0 — so bar b beat 1 is (b-1)*2 seconds and one
   beat is 0.5s. Every expectation below is readable off that. */
const SHOW: Show = {
  grid: { bpm: 120, beats_per_bar: 4, first_beat_s: 0 },
  sections: [
    { start: 0, end: 8, name: "intro" },
    { start: 8, end: 16, name: "chorus" },
  ],
  moments: [{ t: 4 }, { t: 12 }],
} as unknown as Show;

const CATALOGUE: Effect[] = [
  { id: "stab", kind: "gesture", default_beats: 1 },
  { id: "beam", kind: "gesture", default_beats: 2, span_anchors: ["from_moment", "to_moment"] },
  { id: "drone", kind: "state" },
] as unknown as Effect[];

test("a bar-anchored gesture lands on its bar", () => {
  /* The bug this covers: at_bar/at_beat is what a composed show file actually
     uses, and planToEdits understood every anchor EXCEPT that one — so a real
     show file loaded with all of its gestures silently missing. */
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 4, at_beat: 1 }] }, SHOW, CATALOGUE);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].bar, 4);
  assert.equal(edits[0].beat, 1);
});

test("at_beat is honoured, not floored to the bar", () => {
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 5, at_beat: 3 }] }, SHOW, CATALOGUE);
  assert.equal(edits[0].bar, 5);
  assert.equal(edits[0].beat, 3);
});

test("at_beat defaults to the downbeat", () => {
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 3 }] }, SHOW, CATALOGUE);
  assert.equal(edits[0].bar, 3);
  assert.equal(edits[0].beat, 1);
});

test("lead_beats pulls a bar-anchored gesture EARLIER, as the baker does", () => {
  /* baker.js: fire = beatIndexOfBar(at_bar, at_beat) - lead_beats */
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 4, at_beat: 1, lead_beats: 1 }] }, SHOW, CATALOGUE);
  assert.equal(edits[0].bar, 3);
  assert.equal(edits[0].beat, 4);
});

test("from_bar/to_bar becomes a span, not a point", () => {
  const edits = planToEdits({ gestures: [{ effect: "beam", from_bar: 2, to_bar: 4 }] }, SHOW, CATALOGUE);
  assert.equal(edits[0].bar, 2);
  assert.equal(edits[0].beats, 8); // two bars of 4
});

test("bar anchors win over seconds, the way baker.js reads them", () => {
  /* baker.js tests at_bar before at_s. If a cue somehow carries both, the
     timeline must agree with what will actually be baked. */
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 4, at_s: 99 }] }, SHOW, CATALOGUE);
  assert.equal(edits[0].bar, 4);
});

test("a bar anchor is not mistaken for a dial", () => {
  /* If at_bar survives into params it is written back beside the at_s that
     editsToPlan derives — and the baker prefers at_bar, so a dragged clip
     snaps back to where it came from. */
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 4, colour: "#ff9410" }] }, SHOW, CATALOGUE);
  assert.deepEqual(Object.keys(edits[0].params ?? {}), ["colour"]);
});

test("a dragged bar-anchored clip writes back ONE anchor, in seconds", () => {
  const edits = planToEdits({ gestures: [{ effect: "stab", at_bar: 4, colour: "#ff9410" }] }, SHOW, CATALOGUE);
  const moved = [{ ...edits[0], bar: 6, beat: 1 }];
  const plan = editsToPlan(moved, SHOW, CATALOGUE);
  const g = plan.gestures![0];
  assert.equal(g.at_bar, undefined);
  assert.equal(g.at_s, 10); // bar 6 at 120bpm 4/4
  assert.equal(g.colour, "#ff9410");
});

test("the anchors that already worked still work", () => {
  const plan: V2Plan = {
    gestures: [
      { effect: "stab", at_s: 6 },
      { effect: "stab", moment: 1 },
      { effect: "beam", from_moment: 0, to_moment: 1 },
      { effect: "beam", from_s: 2, to_s: 6 },
    ],
  };
  const edits = planToEdits(plan, SHOW, CATALOGUE);
  assert.equal(edits.length, 4);
  assert.equal(edits[0].bar, 4); // 6s
  assert.equal(edits[1].bar, 7); // moment 1 at 12s
});

test("a COMPOSED show file loads with every cue it declares", () => {
  /* The regression in one line: this file has 28 bar-anchored gestures and
     before the fix planToEdits returned only its 25 states and 3 bindings.

     It is deliberately not fixtures/raga-of-revenge.show.json — that one is a
     round trip of the UI's OWN output, so every gesture in it is anchored with
     at_s/from_s, the anchors planToEdits already understood. It passed while
     the timeline was dropping half of every real show. This fixture is a byte
     copy of portal/showfiles/raga-of-revenge.show.json, what the composer
     actually writes, and it anchors by bar. */
  const doc = JSON.parse(
    readFileSync(new URL("./fixtures/raga-of-revenge.composed.show.json", import.meta.url), "utf8"),
  );
  assert.ok(doc.gestures.every((g: Record<string, unknown>) => g.at_bar != null || g.from_bar != null),
    "fixture must exercise BAR anchors, or it is not testing the regression");
  const declared =
    doc.states.length + doc.bindings.length + doc.gestures.length;
  assert.equal(declared, 56);

  /* a grid and sections big enough for the file's own bars */
  const show = {
    grid: { bpm: 120, beats_per_bar: 4, first_beat_s: 0 },
    sections: Array.from({ length: 30 }, (_, i) => ({ start: i * 10, end: i * 10 + 10, name: `s${i}` })),
    moments: [],
  } as unknown as Show;

  const edits = planToEdits(doc, show, CATALOGUE);
  assert.equal(edits.length, declared);
  assert.equal(edits.filter((e) => e.type === "stab").length,
    doc.gestures.filter((g: { effect: string }) => g.effect === "stab").length);
});
