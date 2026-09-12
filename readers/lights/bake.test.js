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
   secondsAt(9) = first_beat_s + 9 bars, NOT secondsAt(10). */
ok("intro phase starts at the score's bar 0", near(intro.start, S.secondsAt(0, 1)),
   `baked ${intro.start} want ${S.secondsAt(0, 1).toFixed(3)}`);
ok("drop phase starts at the score's bar 9 (not a bar late)",
   near(drop.start, S.secondsAt(9, 1)),
   `baked ${drop.start} want ${S.secondsAt(9, 1).toFixed(3)} (bug bakes ${S.secondsAt(10, 1).toFixed(3)})`);
ok("drop is not baked a whole bar late",
   !near(drop.start, S.secondsAt(10, 1), 0.02),
   `baked ${drop.start}`);

/* And a frame sampled inside the drop must actually carry the drop's bar. */
const barSec = SCORE.grid.beats_per_bar * 60 / SCORE.grid.bpm;
const midDrop = S.secondsAt(12, 1);                 // a few bars into the drop
const tick = baked.ticks.find(k => k.t >= midDrop);
ok("a frame inside the drop reports a bar within the drop section",
   tick && tick.bar >= 9 && tick.bar < 17, tick ? `bar ${tick.bar} @ ${tick.t}s` : "no tick");

fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
for (const [pass, name, detail] of out) {
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
