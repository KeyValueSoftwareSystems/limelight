import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./fixture.ts";
import { buildClips } from "./clips.ts";

test("the fixture is a coherent show", () => {
  assert.equal(FIXTURE.show.song, "levels");
  assert.ok(FIXTURE.show.duration_s! > 200);
  assert.equal(FIXTURE.show.grid.beats_per_bar, 4);
  assert.ok(FIXTURE.show.sections.length >= 10);
  assert.equal(FIXTURE.show.downbeats.length, 124);
});

test("it carries the musical detail the timeline draws", () => {
  assert.ok(FIXTURE.energy.length > 100);
  assert.ok(FIXTURE.show.moments.length >= 10);
  const m = FIXTURE.show.moments[0];
  assert.equal(typeof m.t, "number");
  assert.equal(typeof m.kind, "string");
});

test("it carries the arranger's plan", () => {
  const p = FIXTURE.show.plan;
  assert.ok(p, "no plan on the fixture");
  assert.ok(p!.punctuation.length > 30);
  assert.ok(p!.dynamics.length > 30);
  assert.equal(p!.looks.length, FIXTURE.show.sections.length);
});

test("every section start lands inside the show", () => {
  for (const s of FIXTURE.show.sections) {
    assert.ok(s.start >= 0 && s.end <= FIXTURE.show.duration_s! + 1, JSON.stringify(s));
    assert.ok(s.end > s.start);
  }
});

test("buildClips turns the fixture plan into ghost clips", () => {
  const clips = buildClips(FIXTURE.show.plan ?? null, [], FIXTURE.effects, FIXTURE.show.grid);
  assert.ok(clips.length > 20, `only ${clips.length} clips`);
  assert.ok(clips.every((c) => c.source === "auto"));
  assert.ok(clips.every((c) => c.startS < c.endS));
});
