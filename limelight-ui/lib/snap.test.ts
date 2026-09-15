import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnap } from "./snap.ts";
import type { SnapContext } from "./snap.ts";

const CTX: SnapContext = {
  bpb: 4,
  totalBeats: 200,
  playheadBeat: 20,
  sections: [{ beat: 32, label: "chorus" }],
  moments: [{ beat: 33, label: "the riff" }],
};

test("snapping off returns nothing at all", () => {
  assert.equal(resolveSnap(CTX, 32.2, 2, "off"), null);
});

test("nothing within the radius returns null", () => {
  assert.equal(resolveSnap({ ...CTX, playheadBeat: null }, 50.5, 0.1, "bar"), null);
});

test("a bar line is found at bar strength", () => {
  // beat 40 is bar 11's downbeat; 40.6 is 0.6 away, inside a radius of 1.
  const t = resolveSnap({ ...CTX, playheadBeat: null, sections: [], moments: [] },
                        40.6, 1, "bar");
  assert.equal(t?.kind, "bar");
  assert.equal(t?.beat, 40);
  assert.equal(t?.label, "bar 11");
});

test("bar strength never snaps to a plain beat", () => {
  const t = resolveSnap({ ...CTX, playheadBeat: null, sections: [], moments: [] },
                        41.1, 0.5, "bar");
  assert.equal(t, null);
});

test("beat strength snaps to the nearest beat", () => {
  const t = resolveSnap({ ...CTX, playheadBeat: null, sections: [], moments: [] },
                        41.1, 0.5, "beat");
  assert.equal(t?.kind, "beat");
  assert.equal(t?.beat, 41);
});

test("priority beats proximity: a section wins over a nearer moment", () => {
  // raw 32.9 is 0.9 from the section at 32 and 0.1 from the moment at 33.
  const t = resolveSnap(CTX, 32.9, 2, "beat");
  assert.equal(t?.kind, "section");
  assert.equal(t?.beat, 32);
});

test("the playhead outranks everything", () => {
  const ctx = { ...CTX, playheadBeat: 32.5 };
  const t = resolveSnap(ctx, 32.6, 2, "beat");
  assert.equal(t?.kind, "playhead");
});

test("among equals, the nearest wins", () => {
  const ctx = { ...CTX, playheadBeat: null, moments: [], sections: [
    { beat: 32, label: "chorus" }, { beat: 36, label: "verse" },
  ] };
  assert.equal(resolveSnap(ctx, 35, 4, "bar")?.label, "verse");
});

test("a bar line beyond the end of the song is not offered", () => {
  const ctx = { ...CTX, totalBeats: 40, playheadBeat: null, sections: [], moments: [] };
  assert.equal(resolveSnap(ctx, 43, 2, "bar"), null);
});
