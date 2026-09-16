import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildShowFile, serializeShowFile, showFileName, SHOW_SCHEMA } from "./showfile.ts";
import type { V2Plan } from "./planConvert";

const PLAN: V2Plan = {
  plan: "one lamp becoming a congregation",
  states: [{ effect: "drone", section: 0, amount: 0.09, colour: "#ff9410" }],
  bindings: [{ effect: "pulse", section: 1, amount: 0.4 }],
  gestures: [{ effect: "lift", at_s: 12.5, for_beats: 4 }],
};

test("the envelope is the hub's: schema and song, then the plan", () => {
  const doc = buildShowFile("raga-of-revenge", PLAN);
  assert.equal(doc.schema, SHOW_SCHEMA);
  assert.equal(doc.song, "raga-of-revenge");
  /* Key ORDER matters, not just presence: server.py writes
     {"schema": ..., "song": song, **plan}, and a file downloaded here should
     diff cleanly against one the hub wrote. */
  assert.deepEqual(Object.keys(doc), ["schema", "song", "plan", "states", "bindings", "gestures"]);
});

test("the plan is carried through untouched", () => {
  const doc = buildShowFile("raga-of-revenge", PLAN);
  assert.deepEqual(doc.states, PLAN.states);
  assert.deepEqual(doc.bindings, PLAN.bindings);
  assert.deepEqual(doc.gestures, PLAN.gestures);
  assert.equal(doc.plan, PLAN.plan);
});

test("a plan with no cues still makes a valid document", () => {
  const doc = buildShowFile("empty", { plan: "", states: [], bindings: [], gestures: [] });
  assert.equal(doc.schema, SHOW_SCHEMA);
  assert.equal(doc.song, "empty");
  assert.deepEqual(doc.states, []);
});

test("a declared palette survives the wrapping", () => {
  const doc = buildShowFile("x", { ...PLAN, palette: [{ name: "saffron", rgb: [1, 0.58, 0.06] }] });
  assert.deepEqual(doc.palette, [{ name: "saffron", rgb: [1, 0.58, 0.06] }]);
});

test("the filename is what the hub calls the file", () => {
  assert.equal(showFileName("raga-of-revenge"), "raga-of-revenge.show.json");
});

test("a song name carrying a path is reduced the way the server reduces it", () => {
  /* portal/server.py runs os.path.basename over the song before it opens a
     file, so "../../etc/passwd" writes showfiles/passwd.show.json. The download
     must not claim to be a different show than a save of the same state. */
  assert.equal(showFileName("../../etc/passwd"), "passwd.show.json");
  assert.equal(showFileName("a/b/song"), "song.show.json");
  assert.equal(buildShowFile("a/b/song", PLAN).song, "song");
  assert.equal(showFileName(""), "show.show.json");
});

test("serialised with indent 1 and a trailing newline, as json.dump writes it", () => {
  const text = serializeShowFile(buildShowFile("raga-of-revenge", PLAN));
  assert.ok(text.endsWith("\n"));
  assert.equal(text.split("\n")[0], "{");
  assert.equal(text.split("\n")[1], ' "schema": "limelight.show/1",');
  /* and it is still the document it started as */
  assert.deepEqual(JSON.parse(text).gestures, PLAN.gestures);
});

test("a round trip through the real hub file keeps its shape", () => {
  /* The fixture is a genuine limelight.show/1 written by the hub — proof that
     what this module builds is the same kind of document the importer reads,
     not a shape invented here. */
  const onDisk = JSON.parse(readFileSync(new URL("./fixtures/raga-of-revenge.show.json", import.meta.url), "utf8"));
  const { schema, song, ...plan } = onDisk;
  assert.equal(schema, SHOW_SCHEMA);
  const rebuilt = buildShowFile(song, plan as V2Plan);
  assert.deepEqual(rebuilt, onDisk);
  assert.deepEqual(Object.keys(rebuilt), Object.keys(onDisk));
});

test("what it writes is what the importer accepts", () => {
  /* app/(portal)/stage asPlan(): a document is taken as a plan when it carries
     states, gestures or bindings at the top level. */
  const doc = JSON.parse(serializeShowFile(buildShowFile("raga-of-revenge", PLAN)));
  assert.ok(doc.states || doc.gestures || doc.bindings);
});
