/**
 * The show-file loader, against the real file and the real score it names.
 *
 * The point of most of these is that a cue which cannot be placed has to SAY
 * so. The format positions by index, and an index is only meaningful against the
 * score it was written from — so silent loss is the failure this guards.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { resolve, toClips, coverage, type ShowFile, type Against } from "./showfile.ts";
import type { Grid, Section, Moment } from "./types.ts";

const FILE = path.join(
  import.meta.dirname, "..", "..", "portal", "showfiles", "raga-of-revenge.show.json",
);
const file = JSON.parse(fs.readFileSync(FILE, "utf8")) as ShowFile;

/* the real grid and structure of raga-of-revenge, off the bake */
const grid: Grid = {
  bpm: 119.982, beats_per_bar: 4, first_beat_s: 1.7481, bars: 65,
  tempo: [
    { from_beat: 0, at_s: 1.7481, bpm: 89.341 },
    { from_beat: 24, at_s: 17.8662, bpm: 119.982 },
  ],
};
const sections: Section[] = [
  { name: "intro", start: -0.94, end: 17.87, phase: "intro" },
  { name: "interlude", start: 17.87, end: 31.87, phase: "break" },
  { name: "pre-chorus", start: 31.87, end: 47.87, phase: "build" },
  { name: "chorus", start: 47.87, end: 109.88, phase: "drop" },
  { name: "breakdown", start: 109.88, end: 117.88, phase: "break" },
  { name: "pre-chorus", start: 117.88, end: 125.88, phase: "build" },
  { name: "outro", start: 125.88, end: 135.88, phase: "outro" },
];
const moments: Moment[] = [
  { t: 17.87, kind: "entrance", what: "drums" },
  { t: 31.37, kind: "fill", what: "drums" },
  { t: 47.87, kind: "entrance", what: "voice" },
  { t: 109.88, kind: "exit", what: "bass" },
  { t: 111.88, kind: "exit", what: "drums" },
  { t: 115.88, kind: "transition", what: "voice" },
  { t: 120.88, kind: "release", what: "tension" },
  { t: 123.88, kind: "accent", what: "the band" },
];
const against: Against = { grid, sections, moments, duration_s: 131.286 };

/* ── the file itself ─────────────────────────────────────────────────────── */

test("the file carries three lists and a plan", () => {
  assert.ok(file.plan && file.plan.length > 10);
  assert.equal(file.states?.length, 7);
  assert.equal(file.bindings?.length, 1);
  assert.equal(file.gestures?.length, 21);
});

/* ── states and bindings place against sections ──────────────────────────── */

test("every state resolves: it names a section this song has", () => {
  const r = resolve(file, against);
  const states = r.cues.filter((c) => c.row === "state");
  assert.equal(states.length, 7, `states lost: ${JSON.stringify(r.problems)}`);
});

test("a state holds for its whole section, not for one beat", () => {
  const r = resolve(file, against);
  const intro = r.cues.find((c) => c.row === "state" && c.section === 0)!;
  assert.ok(intro.beats > 8, `intro state is only ${intro.beats} beats`);
  assert.ok(intro.endS > intro.startS);
});

test("the binding resolves against its section", () => {
  const r = resolve(file, against);
  assert.equal(r.cues.filter((c) => c.row === "binding").length, 1);
});

/* ── the reason `at` had to be added ─────────────────────────────────────── */

test("the real file places every one of its cues", () => {
  const r = resolve(file, against);
  const total = (file.states?.length ?? 0) + (file.bindings?.length ?? 0) + (file.gestures?.length ?? 0);
  assert.equal(r.cues.length, total, `unplaced: ${JSON.stringify(r.problems)}`);
  assert.deepEqual(r.problems, []);
});

test("a cue lands where its own note says it should", () => {
  /* the `why` states the intended time; the placement must agree with it */
  const r = resolve(file, against);
  let checked = 0;
  for (const c of r.cues) {
    const m = /(\d+(?:\.\d+)?)\s*s\b/.exec(c.why ?? "");
    if (!m || c.row !== "gesture" || c.leadBeats) continue;   // a lead is meant to land early
    checked++;
    assert.ok(Math.abs(c.startS - Number(m[1])) < 1.2,
      `${c.effect} says ${m[1]}s, landed at ${c.startS.toFixed(1)}s`);
  }
  assert.ok(checked >= 10, `only checked ${checked} cues`);
});

/* an index that does not resolve must still be REPORTED, not swallowed: that is
   what went wrong with this file in the first place */
test("an index the score does not have is reported, not dropped", () => {
  const bad: ShowFile = {
    gestures: [{ id: "g-bad", effect: "impact", moment: 99, for_beats: 2 }],
    states: [{ id: "s-bad", effect: "drone", section: 42 }],
  };
  const r = resolve(bad, against);
  assert.equal(r.cues.length, 0);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.find((p) => p.id === "g-bad")!.says,
    /moment 99 does not exist — this song has 8/);
  assert.match(r.problems.find((p) => p.id === "s-bad")!.says,
    /section 42 does not exist — this song has 7/);
});

test("an explicit `at` places a cue regardless of the index", () => {
  const fixed: ShowFile = {
    gestures: [
      { id: "g-fixed", effect: "impact", moment: 99, at: { bar: 22, beat: 1, beats: 2 } },
    ],
  };
  const r = resolve(fixed, against);
  assert.equal(r.problems.length, 0, "an `at` should not need the index to exist");
  assert.equal(r.cues.length, 1);
  assert.equal(r.cues[0].bar, 22);
  assert.equal(r.cues[0].beats, 2);
});

test("a cue records the lead it was given", () => {
  const r = resolve(file, against);
  const climax = r.cues.find((c) => c.effect === "impact" && (c.why ?? "").includes("CLIMAX"))!;
  assert.equal(climax.leadBeats, 6);
  /* 105.8s less six beats at 120bpm is 102.8s */
  assert.ok(Math.abs(climax.startS - 102.8) < 0.6, `landed at ${climax.startS}`);
});

test("`lead_beats` pulls a gesture earlier than its moment", () => {
  const f: ShowFile = {
    gestures: [
      { id: "on", effect: "impact", moment: 2, for_beats: 2 },
      { id: "early", effect: "blackout", moment: 2, for_beats: 2, lead_beats: 3 },
    ],
  };
  const r = resolve(f, against);
  const on = r.cues.find((c) => c.id === "on")!;
  const early = r.cues.find((c) => c.id === "early")!;
  assert.ok(early.startS < on.startS, "lead_beats must land before the moment");
  const bpb = 4;
  const d = ((on.bar - early.bar) * bpb + (on.beat - early.beat));
  assert.equal(d, 3, `expected 3 beats of lead, got ${d}`);
});

/* ── positions land on the grid ──────────────────────────────────────────── */

test("a gesture lands within a beat of the moment it names", () => {
  const f: ShowFile = { gestures: [{ id: "g", effect: "impact", moment: 2, for_beats: 1 }] };
  const r = resolve(f, against);
  assert.equal(r.problems.length, 0);
  /* moment 2 is the voice entrance at 47.87s */
  assert.ok(Math.abs(r.cues[0].startS - 47.87) < 0.6,
    `landed at ${r.cues[0].startS}, wanted ~47.87`);
});

test("the tempo change is honoured when placing", () => {
  /* moment 0 is at 17.87s, exactly where the song moves 89 -> 120 bpm */
  const f: ShowFile = { gestures: [{ id: "g", effect: "stab", moment: 0, for_beats: 1 }] };
  const r = resolve(f, against);
  assert.ok(Math.abs(r.cues[0].startS - 17.87) < 0.6);
});

test("cues come back in time order", () => {
  const r = resolve(file, against);
  for (let i = 1; i < r.cues.length; i++) {
    assert.ok(r.cues[i].startS >= r.cues[i - 1].startS);
  }
});

/* ── dials survive ───────────────────────────────────────────────────────── */

test("a cue keeps its dials and drops only its positioning fields", () => {
  const r = resolve(file, against);
  const climax = r.cues.find((c) => c.row === "state" && c.section === 4)!;
  assert.equal(climax.effect, "drive");
  assert.equal(climax.params.amount, 1.0);
  assert.equal(climax.params.floor, 0.62);
  assert.deepEqual(climax.params.colours, [[1, 0.78, 0.34], [1, 0.52, 0.12]]);
  assert.ok(!("section" in climax.params), "provenance is not a dial");
  assert.ok(!("why" in climax.params), "the note is not a dial");
});

test("the `why` is carried through, because it is the point of the file", () => {
  const r = resolve(file, against);
  assert.ok(r.cues.every((c) => typeof c.why === "string" && c.why.length > 0));
});

/* ── drawing ─────────────────────────────────────────────────────────────── */

test("cues become clips the timeline can draw", () => {
  const r = resolve(file, against);
  const clips = toClips(r, [{ id: "impact", name: "Impact" }, { id: "hush", name: "Hush" }]);
  assert.equal(clips.length, r.cues.length);
  for (const c of clips) {
    assert.ok(c.key && c.family && c.beats > 0);
    assert.ok(Number.isFinite(c.startS) && Number.isFinite(c.endS));
    assert.ok(c.endS > c.startS);
  }
});

test("an effect this build has never heard of still draws", () => {
  const f: ShowFile = { states: [{ id: "s", effect: "pulse", section: 2, amount: 0.5 }] };
  const clips = toClips(resolve(f, against), []);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].fx, "pulse");
  assert.ok(clips[0].family, "it must still land in a lane");
});

/* ── what would actually reach the rig ───────────────────────────────────── */

test("coverage separates unknown effects from unrendered ones", () => {
  const r = resolve(file, against);
  const CATALOGUE = ["drone","wash","impact","blackout","hush","ramp","stab","lift",
                     "trade","isolate","strip","cut","swell","gear","follow","split","accent"];
  const RENDERS = ["drone","wash","impact","blackout","hush","ramp","stab","lift",
                   "strip","cut","swell","accent"];
  const c = coverage(r, CATALOGUE, RENDERS);
  assert.equal(c.renders.length + c.unknown.length + c.noRenderer.length, r.cues.length);
  /* pulse, drive and anticipation are in the file and in no catalogue */
  const unknownNames = new Set(c.unknown.map((x) => x.effect));
  assert.ok(unknownNames.has("pulse") || unknownNames.has("drive"),
    `expected pulse/drive to be unknown, got ${[...unknownNames]}`);
});

test("an empty file is not a crash", () => {
  const r = resolve({}, against);
  assert.deepEqual(r.cues, []);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(toClips(r, []), []);
});
