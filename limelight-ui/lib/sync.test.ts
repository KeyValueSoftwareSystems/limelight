/**
 * Choosing which baked frame to show for a moment of audio.
 *
 * The bug this exists for: `audio.currentTime` is where the DECODER is, not
 * what has reached the speakers. Every device buffers — 20ms on a wired output,
 * well over 150ms on Bluetooth — so drawing the frame at the decode position
 * puts the lights AHEAD of the music by that much. Constant, not growing, which
 * is exactly what "slightly out of sync" feels like.
 */
import { test } from "node:test";
import assert from "node:assert";
import { frameFor, outputLatencyOf, SYNC_NUDGE_LIMIT } from "./sync.ts";

const FPS = 40;
const COUNT = 5252;                 // raga-of-revenge, 131.3s at 40fps

test("with no offset the frame is the one containing t", () => {
  assert.equal(frameFor(0, FPS, COUNT, 0), 0);
  assert.equal(frameFor(1, FPS, COUNT, 0), 40);
  assert.equal(frameFor(49.8, FPS, COUNT, 0), Math.round(49.8 * FPS));
});

test("it rounds rather than floors", () => {
  /* flooring biases every frame half a step late — 12.5ms at 40fps, for free */
  assert.equal(frameFor(1.0 + 0.9 / FPS, FPS, COUNT, 0), 41);
  assert.equal(frameFor(1.0 + 0.1 / FPS, FPS, COUNT, 0), 40);
});

test("the offset shifts the chosen frame by exactly offset * fps", () => {
  const base = frameFor(60, FPS, COUNT, 0);
  assert.equal(frameFor(60, FPS, COUNT, 0.1), base - 4, "100ms of latency is 4 frames at 40fps");
  assert.equal(frameFor(60, FPS, COUNT, -0.1), base + 4);
});

test("a positive offset means the lights wait for the sound", () => {
  /* output latency is positive: the listener hears t - latency, so the frame
     shown must be the one for t - latency */
  const withLatency = frameFor(60, FPS, COUNT, 0.08);
  const without = frameFor(60, FPS, COUNT, 0);
  assert.ok(withLatency < without, "compensating must play the show slightly later");
});

test("it never leaves the buffer", () => {
  assert.equal(frameFor(-5, FPS, COUNT, 0), 0);
  assert.equal(frameFor(0, FPS, COUNT, 5), 0, "a big offset cannot go negative");
  assert.equal(frameFor(1e6, FPS, COUNT, 0), COUNT - 1);
  assert.equal(frameFor(10, FPS, 0, 0), 0, "an empty show is not a crash");
});

test("a nonsense fps does not produce NaN", () => {
  for (const fps of [0, -1, NaN, Infinity]) {
    const i = frameFor(10, fps as number, COUNT, 0);
    assert.ok(Number.isInteger(i) && i >= 0 && i < COUNT, `fps ${fps} gave ${i}`);
  }
});

test("a nonsense offset does not produce NaN", () => {
  for (const off of [NaN, Infinity, -Infinity]) {
    const i = frameFor(10, FPS, COUNT, off as number);
    assert.ok(Number.isInteger(i) && i >= 0 && i < COUNT, `offset ${off} gave ${i}`);
  }
});

/* ── reading the device's own latency ────────────────────────────────────── */

test("output latency comes from the audio context when it reports one", () => {
  assert.equal(outputLatencyOf({ outputLatency: 0.12, baseLatency: 0.01 }), 0.13);
});

test("baseLatency alone is used when outputLatency is missing", () => {
  /* Safari reports only baseLatency */
  assert.equal(outputLatencyOf({ baseLatency: 0.02 }), 0.02);
});

test("no context, or a silent one, reports nothing rather than guessing", () => {
  assert.equal(outputLatencyOf(null), 0);
  assert.equal(outputLatencyOf({}), 0);
  assert.equal(outputLatencyOf({ outputLatency: NaN }), 0);
  /* headless and some virtual devices report 0; that is a real answer */
  assert.equal(outputLatencyOf({ outputLatency: 0, baseLatency: 0 }), 0);
});

test("an absurd reported latency is not trusted", () => {
  /* a second of latency is a broken driver, not a device */
  assert.equal(outputLatencyOf({ outputLatency: 4 }), 0);
});

test("the manual nudge is bounded", () => {
  assert.ok(SYNC_NUDGE_LIMIT > 0 && SYNC_NUDGE_LIMIT <= 0.5);
});
