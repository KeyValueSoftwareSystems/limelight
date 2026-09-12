/* bake.js tests -- the show's wall clock must match the score's own clock.
   The regression this pins: a 0-based score (grid.first_bar = 0, as the pipeline
   now emits) had every section baked one bar late, because bake.js applied a
   bar-base shift that session.js already applies. A one-bar error is a drop that
   lights after the drop has landed. Plain node idiom. */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const { Session } = require("../../protocol/session.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 0.02 : e);

/* A minimal but real score, numbered from bar 0 the way the pipeline writes it. */
const SCORE = {
  score: "baketest",
  grid: { bpm: 128.01, first_beat_s: 4.8609, beats_per_bar: 4, bars: 18, first_bar: 0, last_bar: 17 },
  sections: [
    { from: { bar: 0, beat: 1 }, to: { bar: 9, beat: 1 }, name: "intro" },
    { from: { bar: 9, beat: 1 }, to: { bar: 17, beat: 1 }, name: "drop" },
  ],
  energy: { per: "bar", from_bar: 0, values: [
    0.05, 0.05, 0.06, 0.05, 0.07, 0.06, 0.05, 0.05, 0.06,
    0.90, 0.92, 0.95, 0.90, 0.93, 0.88, 0.90, 0.95, 0.90] },
};

const S = Session(SCORE, { now: () => 0 });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bake-"));
const scoreFile = path.join(tmp, "baketest.score.json");
const outFile = path.join(tmp, "baketest.frames.json");
fs.writeFileSync(scoreFile, JSON.stringify(SCORE));

execFileSync("node", [path.join(__dirname, "bake.js"), scoreFile, "1", "--out", outFile],
  { stdio: "pipe" });
const baked = JSON.parse(fs.readFileSync(outFile, "utf8"));
const phaseOf = name => baked.phases.find(p => (p.phase || "").length >= 0 &&
  baked.phases.indexOf(p) === SCORE.sections.findIndex(s => s.name === name));
const intro = baked.phases[0], drop = baked.phases[1];

/* The score says the drop is at bar 9; on a first_bar=0 score that is
   bar 9 = first_beat_s + 8 bars, because bar 1 is the first downbeat. */
/* Derived from the grid, never from session.secondsAt: comparing bake against
   the same function bake calls moved both together and hid a whole-bar lag
   for as long as it existed. Bar 1 begins on the first downbeat; bar 0 is
   the pickup before it. */
const oneBar = (60 / SCORE.grid.bpm) * SCORE.grid.beats_per_bar;
const wantAt = b => SCORE.grid.first_beat_s + (b - 1) * oneBar;
ok("intro phase starts at the score's bar 0", near(intro.start, wantAt(0)),
   `baked ${intro.start} want ${wantAt(0).toFixed(3)}`);
ok("drop phase starts at the score's bar 9 (not a bar late)",
   near(drop.start, wantAt(9)),
   `baked ${drop.start} want ${wantAt(9).toFixed(3)} (bug baked ${wantAt(10).toFixed(3)})`);
ok("drop is not baked a whole bar late",
   !near(drop.start, wantAt(10), 0.02),
   `baked ${drop.start}`);

/* And a frame sampled inside the drop must actually carry the drop's bar. */
const barSec = SCORE.grid.beats_per_bar * 60 / SCORE.grid.bpm;
const midDrop = S.secondsAt(12, 1);                 // a few bars into the drop
const tick = baked.ticks.find(k => k.t >= midDrop);
ok("a frame inside the drop reports a bar within the drop section",
   tick && tick.bar >= 9 && tick.bar < 17, tick ? `bar ${tick.bar} @ ${tick.t}s` : "no tick");

/* And baking the RAW hub score (parts, no sections) must place the drop at the
   same wall time -- the reader consumes the hub score directly, no formatter. */
const RAW = {
  score: "baketest", version: 0,
  grid: SCORE.grid,
  parts: [
    { from_bar: 0, to_bar: 8, role: "intro", nth: 1, like: "A", returns: true,
      feels: "no drums", fullness: 0.68, rise: -0.02, playing: ["other"],
      stems: { drums: { is: "none", level: 0.01 }, other: { is: "full", level: 0.8 } } },
    { from_bar: 9, to_bar: 16, role: "drop", nth: 1, like: "B", returns: true,
      feels: "drums in", fullness: 0.74, rise: 0.09, playing: ["drums", "bass"],
      stems: { drums: { is: "full", level: 0.94 }, bass: { is: "full", level: 0.9 } } },
  ],
  bars: { intensity: SCORE.energy.values },
};
const rawFile = path.join(tmp, "raw.score");
const rawOut = path.join(tmp, "raw.frames.json");
fs.writeFileSync(rawFile, JSON.stringify(RAW));
execFileSync("node", [path.join(__dirname, "bake.js"), rawFile, "1", "--out", rawOut], { stdio: "pipe" });
const rawBaked = JSON.parse(fs.readFileSync(rawOut, "utf8"));
ok("raw hub score bakes the drop at the same time as the formatted one",
   near(rawBaked.phases[1].start, wantAt(9)),
   `raw ${rawBaked.phases[1].start} want ${wantAt(9).toFixed(3)}`);
ok("raw and formatted scores bake the same phase starts",
   JSON.stringify(rawBaked.phases.map(p => p.start)) === JSON.stringify(baked.phases.map(p => p.start)),
   `raw ${JSON.stringify(rawBaked.phases.map(p => p.start))}`);

fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
for (const [pass, name, detail] of out) {
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
