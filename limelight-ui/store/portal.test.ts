import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { usePortalStore } from "./portal.ts";
import type { Edit } from "../lib/types";

/* The undo stack on the store the stage page actually uses. There is a second,
   older store (store/editor.ts) carrying its own tested undo — nothing imports
   it, so its green tests were never evidence about this. */

const edit = (bar: number): Edit => ({ type: "wash", bar, beat: 1, beats: 4 });

const st = () => usePortalStore.getState();
const bars = () => st().edits.map((e) => e.bar);

beforeEach(() => {
  usePortalStore.setState({ edits: [], past: [], future: [], editGroup: null, sel: -1 });
});

test("placing something is undoable, and redoable after that", () => {
  st().addEdit(edit(1));
  st().addEdit(edit(9));
  assert.deepEqual(bars(), [1, 9]);

  st().undo();
  assert.deepEqual(bars(), [1]);
  st().undo();
  assert.deepEqual(bars(), []);

  st().redo();
  assert.deepEqual(bars(), [1]);
  st().redo();
  assert.deepEqual(bars(), [1, 9]);
});

test("undo at the bottom of the stack does nothing rather than throwing", () => {
  st().undo();
  st().undo();
  assert.deepEqual(bars(), []);
});

test("a move is undoable, and takes the clip back to where it started", () => {
  st().addEdit(edit(1));
  st().updateEdit(0, { bar: 17 });
  assert.deepEqual(bars(), [17]);
  st().undo();
  assert.deepEqual(bars(), [1]);
});

test("a removal is undoable", () => {
  st().addEdit(edit(1));
  st().addEdit(edit(9));
  st().removeEdit(0);
  assert.deepEqual(bars(), [9]);
  st().undo();
  assert.deepEqual(bars(), [1, 9]);
});

/* ── the rule that makes undo usable: one gesture, one step ──────────────── */

test("a drag writes on every pointer move and still costs ONE undo", () => {
  st().addEdit(edit(1));
  const depth = st().past.length;
  /* what a drag across the timeline looks like from here */
  for (let bar = 2; bar <= 40; bar++) st().updateEdit(0, { bar }, "live");
  assert.equal(st().past.length, depth + 1, "the whole drag recorded once");
  assert.deepEqual(bars(), [40]);

  st().undo();
  assert.deepEqual(bars(), [1], "undo goes back past the whole drag, not one pixel of it");
});

test("the next drag is its own step once the gesture has ended", () => {
  st().addEdit(edit(1));
  for (let bar = 2; bar <= 10; bar++) st().updateEdit(0, { bar }, "live");
  st().endEditGroup();
  for (let bar = 11; bar <= 20; bar++) st().updateEdit(0, { bar }, "live");

  assert.deepEqual(bars(), [20]);
  st().undo();
  assert.deepEqual(bars(), [10], "back to where the first drag left it");
  st().undo();
  assert.deepEqual(bars(), [1]);
});

test("taking an arranger clip over mid-drag joins the drag's step", () => {
  /* materialise, then carry it — one gesture, so one undo takes back both. */
  st().addEdit(edit(5), "live");
  for (let bar = 6; bar <= 12; bar++) st().updateEdit(0, { bar }, "live");
  st().endEditGroup();

  st().undo();
  assert.deepEqual(bars(), [], "the clip it created goes with the drag that created it");
});

test("an ungrouped change never folds into a gesture", () => {
  st().addEdit(edit(1), "live");
  st().addEdit(edit(2));
  assert.equal(st().past.length, 2);
});

/* ── history and the rest of the world ───────────────────────────────────── */

test("a paste of four clips is one step, not four", () => {
  st().addEdit(edit(1));
  const depth = st().past.length;
  st().setEdits([...st().edits, edit(5), edit(6), edit(7), edit(8)], "push");
  assert.equal(st().past.length, depth + 1);
  st().undo();
  assert.deepEqual(bars(), [1]);
});

test("a show arriving wipes the stack — there is nothing behind it", () => {
  st().addEdit(edit(1));
  st().setEdits([edit(3), edit(4)]);
  assert.deepEqual(st().past, []);
  assert.deepEqual(st().future, []);
  st().undo();
  assert.deepEqual(bars(), [3, 4], "undo cannot reach across a different show");
});

test("opening a new show clears the stack", () => {
  st().addEdit(edit(1));
  st().resetForShow();
  assert.deepEqual(st().past, []);
  assert.deepEqual(st().future, []);
  assert.equal(st().editGroup, null);
});

test("a fresh edit after an undo drops the redo branch", () => {
  st().addEdit(edit(1));
  st().addEdit(edit(9));
  st().undo();
  assert.deepEqual(bars(), [1]);
  st().addEdit(edit(20));
  assert.deepEqual(st().future, [], "the branch nobody can reach any more is gone");
  st().redo();
  assert.deepEqual(bars(), [1, 20], "redo has nothing to do");
});

test("undo drops `sel` — it is an index into the list being replaced", () => {
  st().addEdit(edit(1));
  st().addEdit(edit(9));
  assert.equal(st().sel, 1);
  st().undo();
  assert.equal(st().sel, -1);
});

test("stepping either way closes the open gesture", () => {
  st().addEdit(edit(1));
  st().updateEdit(0, { bar: 4 }, "live");
  assert.equal(st().editGroup, "live");
  st().undo();
  assert.equal(st().editGroup, null);
  st().redo();
  assert.equal(st().editGroup, null);
});

test("the stack is bounded, and keeps the most recent end", () => {
  for (let i = 0; i < 260; i++) st().addEdit(edit(i));
  assert.ok(st().past.length <= 200, `stack grew to ${st().past.length}`);
  st().undo();
  assert.equal(st().edits.length, 259, "the newest step is still the one undo takes back");
});
