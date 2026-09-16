import { test } from "node:test";
import assert from "node:assert/strict";
import { timeToX, xToTime, fit, clampView, zoomAt, panBy, barTicks, beatTicks, timeTicks, energyPeaks, beatAtTime, beatsAcross } from "./timeline.ts";
import type { Grid } from "./types";

const DUR = 240;
const GRID: Grid = { bpm: 120, beats_per_bar: 4, first_beat_s: 0 };
const W = 1000;

test("fit shows the whole song", () => {
  assert.deepEqual(fit(DUR), { from: 0, to: DUR });
});

test("time and pixels round-trip", () => {
  const v = { from: 60, to: 120 };
  for (const t of [60, 75, 90, 119.9]) {
    assert.ok(Math.abs(xToTime(timeToX(t, v, W), v, W) - t) < 1e-9, `round-trip failed at ${t}`);
  }
});

test("the left edge is x=0 and the right edge is the full width", () => {
  const v = { from: 10, to: 20 };
  assert.equal(timeToX(10, v, W), 0);
  assert.equal(timeToX(20, v, W), W);
});

test("a view is never allowed outside the song", () => {
  assert.deepEqual(clampView({ from: -50, to: 100 }, DUR, 1), { from: 0, to: 150 });
  assert.deepEqual(clampView({ from: 200, to: 400 }, DUR, 1), { from: 40, to: 240 });
});

test("a view never shrinks below the minimum span", () => {
  const v = clampView({ from: 10, to: 10.0001 }, DUR, 2);
  assert.ok(v.to - v.from >= 2);
});

test("zoom keeps the anchored time under the same pixel", () => {
  const v = { from: 0, to: DUR };
  const anchor = 90;
  const z = zoomAt(v, anchor, 0.5, DUR, 1);
  assert.ok(z.to - z.from < v.to - v.from, "did not zoom in");
  const before = timeToX(anchor, v, W);
  const after = timeToX(anchor, z, W);
  assert.ok(Math.abs(before - after) < 0.5, `anchor drifted ${before} -> ${after}`);
});

test("zooming out past the song just fits it", () => {
  const z = zoomAt({ from: 100, to: 140 }, 120, 100, DUR, 1);
  assert.deepEqual(z, { from: 0, to: DUR });
});

test("panning shifts the window and stops at the ends", () => {
  assert.deepEqual(panBy({ from: 10, to: 20 }, 5, DUR, 1), { from: 15, to: 25 });
  assert.deepEqual(panBy({ from: 0, to: 10 }, -5, DUR, 1), { from: 0, to: 10 });
  assert.deepEqual(panBy({ from: 230, to: 240 }, 5, DUR, 1), { from: 230, to: 240 });
});

test("beatAtTime is the inverse of the grid", () => {
  assert.equal(beatAtTime(0, GRID), 0);
  assert.equal(beatAtTime(2, GRID), 4);
});

test("bar ticks thin out as the view widens, and never crowd", () => {
  const wide = barTicks({ from: 0, to: 240 }, GRID, W);
  const tight = barTicks({ from: 0, to: 8 }, GRID, W);
  assert.ok(wide.length > 0 && tight.length > 0);
  assert.ok(wide.every((t, i, a) => i === 0 || t.bar > a[i - 1].bar), "bars not ascending");
  // at 1000px nothing should be closer than ~40px apart
  for (const ticks of [wide, tight]) {
    for (let i = 1; i < ticks.length; i++) {
      const gap = timeToX(ticks[i].t, { from: 0, to: ticks === wide ? 240 : 8 }, W)
                - timeToX(ticks[i - 1].t, { from: 0, to: ticks === wide ? 240 : 8 }, W);
      assert.ok(gap >= 39, `ticks only ${gap.toFixed(1)}px apart`);
    }
  }
});

test("every bar tick is a real downbeat", () => {
  const ticks = barTicks({ from: 0, to: 16 }, GRID, W);
  for (const t of ticks) {
    assert.ok(Math.abs(t.t - (t.bar - 1) * 2) < 1e-9, `bar ${t.bar} at ${t.t}`);
  }
});

/* The snap magnet has to reach the same distance on screen at every zoom. When
   its radius was a number of BEATS, zooming in grew it: at the zoom you place
   at, 0.6 beats was 23px of pull, so a drop halfway through a bar was dragged
   onto a bar line it was nowhere near. */
test("a pixel radius is the same pixels, whatever the zoom", () => {
  const wide = { from: 0, to: DUR };
  const close = { from: 60, to: 66 };
  const rWide = beatsAcross(500, 10, wide, W, GRID);
  const rClose = beatsAcross(500, 10, close, W, GRID);
  // 120bpm in 4/4 is two beats a second
  assert.ok(Math.abs(rWide - (10 / W) * DUR * 2) < 1e-9, `wide radius ${rWide}`);
  assert.ok(Math.abs(rClose - (10 / W) * 6 * 2) < 1e-9, `close radius ${rClose}`);
  assert.ok(rWide > rClose, "zooming in must shrink the radius in beats");
});

test("the radius is measured at the pointer, so a tempo change is respected", () => {
  const changing: Grid = {
    bpm: 60,
    beats_per_bar: 4,
    first_beat_s: 0,
    tempo: [{ from_beat: 0, at_s: 0, bpm: 60 }, { from_beat: 60, at_s: 60, bpm: 120 }],
  };
  const v = { from: 0, to: 120 };
  const slow = beatsAcross(100, 10, v, W, changing);   // inside the 60bpm stretch
  const fast = beatsAcross(900, 10, v, W, changing);   // inside the 120bpm stretch
  assert.ok(Math.abs(fast - slow * 2) < 1e-9, `${slow} then ${fast}`);
});

/* ── vertical guides ──────────────────────────────────────────────────────── */

test("beat ticks land on every beat, downbeats marked", () => {
  /* 120bpm: a beat is 0.5s. Four seconds across 1000px is 125px a beat. */
  const ticks = beatTicks({ from: 0, to: 4 }, GRID, W);
  assert.deepEqual(ticks.map((t) => t.t), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  assert.deepEqual(ticks.filter((t) => t.strong).map((t) => t.t), [0, 2, 4]);
});

test("beat ticks give up rather than draw a hatch nobody can count", () => {
  /* The whole song across 1000px is 2px a beat. */
  assert.deepEqual(beatTicks({ from: 0, to: DUR }, GRID, W), []);
  assert.deepEqual(beatTicks({ from: 0, to: 4 }, GRID, 0), []);
  assert.deepEqual(beatTicks({ from: 4, to: 4 }, GRID, W), []);
});

test("the time ladder picks a step a person would say out loud", () => {
  /* 240s across 1000px wants >=62px a tick, so >=14.9s: the ladder's 15. */
  assert.equal(timeTicks({ from: 0, to: DUR }, W)[1].t - timeTicks({ from: 0, to: DUR }, W)[0].t, 15);
  /* Half a second across the same width wants >=31ms: the ladder's 50ms, and
     the label switches to milliseconds because the step is under a second. */
  const close = timeTicks({ from: 10, to: 10.5 }, W);
  assert.equal(Math.round((close[1].t - close[0].t) * 1000), 50);
  assert.equal(close[0].label, "0:10.000");
});

test("time ticks stay on whole steps instead of drifting off a float sum", () => {
  const ticks = timeTicks({ from: 0, to: 3 }, 2000);
  /* 0.1 added to itself thirty times is 3.0000000000000004, which formats as
     an impossible time and puts the line a pixel out. */
  for (const tk of ticks) assert.equal(tk.t, Math.round(tk.t * 1000) / 1000);
  assert.ok(ticks.every((tk) => tk.t >= 0 && tk.t <= 3));
});

test("time ticks never start before the view", () => {
  assert.ok(timeTicks({ from: 61, to: 121 }, W).every((t) => t.t >= 61));
});

test("energy peaks are the bars the song turns over on", () => {
  //            bar 1   2    3    4    5    6
  const energy = [0.2, 0.6, 0.3, 0.9, 0.9, 0.1];
  const peaks = energyPeaks(energy, GRID);
  /* bar 2 (index 1) and the FIRST bar of the 0.9 plateau (index 3) — a plateau
     is one lift, not two. Bar 2 starts at 2s, bar 4 at 6s. */
  assert.deepEqual(peaks.map((p) => p.t), [2, 6]);
  assert.deepEqual(peaks.map((p) => p.strong), [false, true]);
});

test("energy peaks skip holes in the score rather than reading them as zero", () => {
  assert.deepEqual(energyPeaks([0.2, null, 0.3, null, 0.9], GRID), []);
  assert.deepEqual(energyPeaks([], GRID), []);
  assert.deepEqual(energyPeaks([0.9], GRID), []);
});
