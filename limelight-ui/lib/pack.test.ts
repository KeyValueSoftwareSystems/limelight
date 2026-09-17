import { test } from "node:test";
import assert from "node:assert/strict";
import { packRows } from "./pack.ts";
import type { Clip } from "./types";

const clip = (key: string, startS: number, endS: number): Clip => ({
  key, source: "mine", editIndex: 0, planId: null, family: "hits",
  tile: "stab", fx: "white_blast", name: "Stab",
  bar: 1, beat: 1, beats: 1, startS, endS, params: {}, overridden: false,
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

test("both sides of an overlap are flagged, not just the one pushed down", () => {
  const p = packRows([clip("a", 0, 4), clip("b", 2, 6)]);
  assert.ok(p.items.every((i) => i.collides), "an overlap must be visible on both clips");
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

test("a pinned clip stays on its row when the packer would have moved it up", () => {
  /* `b` earned row 1 by overlapping `a`. Dragged clear of `a`, the greedy pass
     would hand it row 0 — the lane jump that happens under the pointer. */
  const bare = packRows([clip("a", 0, 4), clip("b", 6, 10)]);
  assert.equal(bare.items.find((i) => i.clip.key === "b")!.row, 0);

  const pinned = packRows([clip("a", 0, 4), clip("b", 6, 10)], { key: "b", row: 1 });
  assert.equal(pinned.items.find((i) => i.clip.key === "b")!.row, 1);
  assert.equal(pinned.items.find((i) => i.clip.key === "a")!.row, 0);
});

test("the others give way: an overlapping clip moves rather than the pinned one", () => {
  const p = packRows([clip("a", 0, 8), clip("b", 2, 10)], { key: "b", row: 0 });
  assert.equal(p.items.find((i) => i.clip.key === "b")!.row, 0);
  assert.equal(p.items.find((i) => i.clip.key === "a")!.row, 1);
});

test("a pinned clip does not push anything off a row it leaves room on", () => {
  /* Pinned late in the song on row 0; an earlier clip that clears it still
     takes row 0, because a row is free wherever the pin is not. */
  const p = packRows([clip("a", 0, 4), clip("b", 6, 10)], { key: "b", row: 0 });
  assert.equal(p.rows, 1);
  assert.ok(p.items.every((i) => i.row === 0));
});

test("a pin nobody claims is ignored", () => {
  const p = packRows([clip("a", 0, 4), clip("b", 2, 6)], { key: "gone", row: 3 });
  assert.equal(p.rows, 2);
});

test("collision is read off time, so a lonely pinned clip is not flagged", () => {
  const p = packRows([clip("a", 0, 4), clip("b", 6, 10)], { key: "b", row: 2 });
  assert.ok(p.items.every((i) => !i.collides), "nothing overlaps, so nothing collides");
  assert.equal(p.rows, 3, "the pinned row exists even with empty lanes above it");
});

test("pinning still reports every clip exactly once, in start order", () => {
  const clips = [clip("a", 0, 4), clip("b", 2, 6), clip("c", 8, 9)];
  const p = packRows(clips, { key: "b", row: 1 });
  assert.deepEqual(p.items.map((i) => i.clip.key), ["a", "b", "c"]);
});
