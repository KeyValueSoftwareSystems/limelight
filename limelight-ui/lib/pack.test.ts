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
