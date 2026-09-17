import { test } from "node:test";
import assert from "node:assert/strict";
import { packRows } from "./pack.ts";
import type { Clip } from "./types";

/* `layer` is the clip's own lane, and leaving it off is what an arranger's clip
   looks like: nothing claimed, so the packer places it. */
const clip = (
  key: string, startS: number, endS: number,
  layer?: number, kind: Clip["kind"] = "gesture",
): Clip => ({
  key, source: "mine", editIndex: 0, planId: null, family: "hits",
  tile: "stab", fx: "white_blast", name: "Stab",
  bar: 1, beat: 1, beats: 1, startS, endS, params: {}, overridden: false,
  layer, kind,
});

test("clips that never overlap all sit on one row", () => {
  const p = packRows([clip("a", 0, 1), clip("b", 2, 3), clip("c", 4, 5)]);
  assert.equal(p.rows, 1);
  assert.ok(p.items.every((i) => i.row === 0));
  assert.ok(p.items.every((i) => !i.collides));
});

test("two overlapping clips take two rows", () => {
  const p = packRows([clip("a", 0, 4), clip("b", 2, 6)]);
  assert.equal(p.rows, 2);
  assert.deepEqual(p.items.map((i) => i.row).sort(), [0, 1]);
});

test("overlapping in time on DIFFERENT lanes is not a conflict", () => {
  /* It used to be: any two clips overlapping in time were both flagged. Once a
     lane decides which effect plays, two clips on separate lanes are not
     competing for anything — the top one wins and the other is simply beneath
     it, which is the arrangement, not a fault. Flagging that was crying wolf.
     The symmetry this test used to guard is now guarded where it still means
     something: "two clips may share a lane". */
  const p = packRows([clip("a", 0, 4), clip("b", 2, 6)]);
  assert.deepEqual(p.items.map((i) => i.row).sort(), [0, 1]);
  assert.ok(p.items.every((i) => !i.collides));
});

test("touching clips do not collide", () => {
  const p = packRows([clip("a", 0, 2), clip("b", 2, 4)]);
  assert.equal(p.rows, 1);
  assert.ok(p.items.every((i) => !i.collides));
});

test("a row is reused once its last clip has ended", () => {
  const p = packRows([clip("a", 0, 4), clip("b", 2, 6), clip("c", 8, 9)]);
  assert.equal(p.rows, 2);
  assert.equal(p.items.find((i) => i.clip.key === "c")!.row, 0);
});

test("three mutually overlapping clips take three rows", () => {
  const p = packRows([clip("a", 0, 9), clip("b", 1, 9), clip("c", 2, 9)]);
  assert.equal(p.rows, 3);
});

test("input order does not change the packing", () => {
  const a = packRows([clip("a", 0, 4), clip("b", 2, 6), clip("c", 8, 9)]);
  const b = packRows([clip("c", 8, 9), clip("b", 2, 6), clip("a", 0, 4)]);
  const key = (p: ReturnType<typeof packRows>) =>
    p.items.map((i) => `${i.clip.key}:${i.row}`).sort().join(",");
  assert.equal(key(a), key(b));
});

test("an empty lane still reports one row, so it keeps its height", () => {
  assert.equal(packRows([]).rows, 1);
});

/* ── the pin: the clip you are holding keeps its row ─────────────────────── */

test("a clip on its own lane stays there when the packer would have moved it up", () => {
  /* `b` would earn row 1 by overlapping `a`. Moved clear of `a`, the greedy pass
     hands it row 0 — the lane jump that used to happen under the pointer. Its
     own lane is what stops that now. */
  const bare = packRows([clip("a", 0, 4), clip("b", 6, 10)]);
  assert.equal(bare.items.find((i) => i.clip.key === "b")!.row, 0);

  const kept = packRows([clip("a", 0, 4), clip("b", 6, 10, 1)]);
  assert.equal(kept.items.find((i) => i.clip.key === "b")!.row, 1);
  assert.equal(kept.items.find((i) => i.clip.key === "a")!.row, 0);
});

test("the others give way: an unclaimed clip moves rather than the one holding a lane", () => {
  const p = packRows([clip("a", 0, 8), clip("b", 2, 10, 0)]);
  assert.equal(p.items.find((i) => i.clip.key === "b")!.row, 0);
  assert.equal(p.items.find((i) => i.clip.key === "a")!.row, 1);
});

test("a claimed lane does not push anything off a row it leaves room on", () => {
  /* Claimed late in the song on row 0; an earlier clip that clears it still
     takes row 0, because a row is free wherever the claim is not. */
  const p = packRows([clip("a", 0, 4), clip("b", 6, 10, 0)]);
  assert.equal(p.rows, 1);
  assert.ok(p.items.every((i) => i.row === 0));
});

test("two clips may share a lane, and that is what a fight over one looks like", () => {
  /* The whole point of a stored lane: the creator put both here, so both stay
     here, and the collision is reported rather than hidden by a re-pack. */
  const p = packRows([clip("a", 0, 8, 1), clip("b", 2, 10, 1)]);
  assert.equal(p.items.find((i) => i.clip.key === "a")!.row, 1);
  assert.equal(p.items.find((i) => i.clip.key === "b")!.row, 1);
  assert.ok(p.items.every((i) => i.collides));
});

test("a shared lane across KINDS is not a collision", () => {
  /* The baker lays a gesture over a state rather than instead of it, so they
     are not competing for the slot and flagging them was crying wolf. */
  const p = packRows([clip("a", 0, 8, 1, "state"), clip("b", 2, 10, 1, "gesture")]);
  assert.ok(p.items.every((i) => !i.collides));
});

test("a lonely clip on a far lane is not flagged, and the empty lanes above it stay", () => {
  const p = packRows([clip("a", 0, 4), clip("b", 6, 10, 2)]);
  assert.ok(p.items.every((i) => !i.collides), "nothing overlaps, so nothing collides");
  assert.equal(p.rows, 3, "the claimed lane exists even with empty lanes above it");
});

test("lanes still report every clip exactly once, in start order", () => {
  const clips = [clip("a", 0, 4), clip("b", 2, 6, 1), clip("c", 8, 9)];
  const p = packRows(clips);
  assert.deepEqual(p.items.map((i) => i.clip.key), ["a", "b", "c"]);
});
