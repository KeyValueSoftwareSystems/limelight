import { test } from "node:test";
import assert from "node:assert/strict";
import { useEditor } from "./editor.ts";

const reset = () => useEditor.getState().reset();
const S = () => useEditor.getState();

test("adding an edit records it and selects it", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  assert.equal(S().edits.length, 1);
  assert.equal(S().edits[0].bar, 5);
});

test("undo restores the previous edit list", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().addEdit({ type: "cut", bar: 9, beats: 2 });
  assert.equal(S().edits.length, 2);
  S().undo();
  assert.equal(S().edits.length, 1);
  S().undo();
  assert.equal(S().edits.length, 0);
});

test("undo past the beginning is a no-op, not a crash", () => {
  reset();
  S().undo();
  S().undo();
  assert.equal(S().edits.length, 0);
});

test("redo replays what undo removed", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().undo();
  assert.equal(S().edits.length, 0);
  S().redo();
  assert.equal(S().edits.length, 1);
  assert.equal(S().edits[0].type, "stab");
});

test("a new edit after undo clears the redo branch", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().undo();
  S().addEdit({ type: "cut", bar: 9, beats: 1 });
  S().redo();
  assert.equal(S().edits.length, 1);
  assert.equal(S().edits[0].type, "cut", "redo resurrected an abandoned branch");
});

test("updateEdit changes one edit in place and is undoable", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().updateEdit(0, { bar: 9, beats: 4 });
  assert.equal(S().edits[0].bar, 9);
  assert.equal(S().edits[0].beats, 4);
  S().undo();
  assert.equal(S().edits[0].bar, 5);
});

test("removeEdit drops it and clears any selection pointing at it", () => {
  reset();
  S().addEdit({ type: "stab", bar: 5, beats: 1 });
  S().select(["mine:0"]);
  S().removeEdit(0);
  assert.equal(S().edits.length, 0);
  assert.deepEqual(S().selection, []);
});

test("selection is replaced by select and extended by addToSelection", () => {
  reset();
  S().select(["a"]);
  assert.deepEqual(S().selection, ["a"]);
  S().addToSelection("b");
  assert.deepEqual(S().selection, ["a", "b"]);
  S().addToSelection("b");
  assert.deepEqual(S().selection, ["a"], "clicking a selected clip should deselect it");
  S().select([]);
  assert.deepEqual(S().selection, []);
});

test("lane bypass toggles and is not part of undo history", () => {
  reset();
  S().addEdit({ type: "stab", bar: 1, beats: 1 });
  S().toggleBypass("hits");
  assert.deepEqual(S().bypass, ["hits"]);
  S().undo();
  assert.deepEqual(S().bypass, ["hits"], "bypass is a view setting, not an edit");
  S().toggleBypass("hits");
  assert.deepEqual(S().bypass, []);
});

test("view and snap are plain settings", () => {
  reset();
  S().setView({ from: 10, to: 20 });
  assert.deepEqual(S().view, { from: 10, to: 20 });
  S().setSnap("beat");
  assert.equal(S().snap, "beat");
});

test("editsForBake drops bypassed lanes without touching the real edit list", () => {
  reset();
  S().addEdit({ type: "stab", bar: 1, beats: 1 });   // hits
  S().addEdit({ type: "cut", bar: 2, beats: 1 });    // darkness
  S().toggleBypass("hits");
  const out = S().editsForBake();
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "cut");
  assert.equal(S().edits.length, 2, "bypass must not mutate the edit list");
});
