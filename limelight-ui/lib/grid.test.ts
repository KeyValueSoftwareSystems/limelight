import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGridClock, positionAt, mmss, mmssms, parseTime, beatsLabel, clamp } from "./grid.ts";
import type { Grid } from "./types";

const STEADY: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0 };

test("bar 1 beat 1 sits on the first beat", () => {
  const { secondsAtBar } = makeGridClock(STEADY);
  assert.equal(secondsAtBar(1), 0);
  assert.equal(secondsAtBar(2), 2);
  assert.equal(secondsAtBar(1, 3), 1);
});

test("first_beat_s offsets every bar", () => {
  const { secondsAtBar } = makeGridClock({ ...STEADY, first_beat_s: 4.8609 });
  assert.equal(+secondsAtBar(1).toFixed(4), 4.8609);
  assert.equal(+secondsAtBar(2).toFixed(4), 6.8609);
});

test("beats_per_bar defaults to 4", () => {
  const { bpb } = makeGridClock({ bpm: 120 });
  assert.equal(bpb, 4);
});

test("positionAt is 1-based in both bar and beat", () => {
  assert.deepEqual(positionAt(0, STEADY), { bar: 1, beat: 1 });
  assert.deepEqual(positionAt(0.5, STEADY), { bar: 1, beat: 2 });
  assert.deepEqual(positionAt(2, STEADY), { bar: 2, beat: 1 });
});

test("a tempo change moves every bar after it", () => {
  const g: Grid = {
    bpm: 120, beats_per_bar: 4, first_beat_s: 0,
    tempo: [
      { from_beat: 0, at_s: 0, bpm: 120 },
      { from_beat: 8, at_s: 4, bpm: 60 },
    ],
  };
  const { secondsAtBar } = makeGridClock(g);
  assert.equal(secondsAtBar(3), 4);
  assert.equal(secondsAtBar(4), 8);
});

test("mmss formats, and survives negatives and infinity", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(65), "1:05");
  assert.equal(mmss(-2), "-0:02");
  assert.equal(mmss(Infinity), "—");
});

test("clamp bounds both ends", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

/* ── the millisecond readout ───────────────────────────────────────────────── */

test("mmssms writes m:ss.mmm", () => {
  assert.equal(mmssms(0), "0:00.000");
  assert.equal(mmssms(62.375), "1:02.375");
  assert.equal(mmssms(-1.5), "-0:01.500");
  assert.equal(mmssms(NaN), "—");
});

test("mmssms rounds the total, so 59.9996s is a minute and not sixty seconds", () => {
  assert.equal(mmssms(59.9996), "1:00.000");
  assert.equal(mmssms(59.9994), "0:59.999");
});

test("parseTime reads back what mmssms writes, and plain seconds too", () => {
  assert.equal(parseTime("1:02.375"), 62.375);
  assert.equal(parseTime("62.375"), 62.375);
  assert.equal(parseTime("  0:02 "), 2);
  assert.equal(parseTime("-0:01.500"), -1.5);
});

test("parseTime returns null rather than zero for anything that is not a time", () => {
  /* Zero would be a silent jump to the top of the song on a stray keystroke. */
  for (const bad of ["", "abc", "1:2:3", "1:", ":4", "12px", "1,5"]) {
    assert.equal(parseTime(bad), null, bad);
  }
});

test("beatsLabel shows a beat count without float noise", () => {
  assert.equal(beatsLabel(2), "2");
  assert.equal(beatsLabel(1.5), "1.5");
  assert.equal(beatsLabel(2.0000000004), "2");
  assert.equal(beatsLabel(1.4999999), "1.5");
  /* A fine nudge is smaller than the readout: it must not read as zero beats
     when the clip plainly has a length. */
  assert.equal(beatsLabel(0.031), "0.03");
});
