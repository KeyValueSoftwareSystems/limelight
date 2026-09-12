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
  moments: [{ bar: 9, beat: 1, is: "entrance", what: "drums", sure: 1, weight: 0.9 },
            { bar: 13, beat: 3, is: "pause", what: "everything but bass", sure: 0.8, for_beats: 4, weight: 0.5 }],
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
  moments: SCORE.moments,
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

/* The timeline carries the moments and the looks in seconds, so the panel can
   show where the show punctuates and where a section changes look inside. */
const mo = baked.moments || [];
ok("the timeline lists the score's moments", mo.length === 2, `${mo.length}`);
const ent = mo.find(m => m.kind === "entrance");
ok("a moment lands at its exact bar/beat on the wall clock",
   ent && near(ent.t, wantAt(9)) && ent.bar === 9 && ent.beat === 1 && ent.weight === 0.9, JSON.stringify(ent));
const pz = mo.find(m => m.kind === "pause");
ok("a spanning moment carries its end in seconds", pz && near(pz.t, wantAt(13) + 2 * 60 / SCORE.grid.bpm) && near(pz.end, pz.t + 4 * 60 / SCORE.grid.bpm), JSON.stringify(pz));
const looks = baked.looks || [];
ok("the timeline lists every look (sequence assignment) in seconds",
   looks.length >= 4 && looks.every(l => typeof l.start === "number" && typeof l.end === "number" && l.seq_id && l.layer),
   JSON.stringify(looks.slice(0, 2)));
ok("a look's start matches its section's bar on the wall clock",
   looks.some(l => l.layer === "par" && near(l.start, wantAt(9))));

/* The wire holds the head's pose whenever nothing drives it (a gap between looks,
   a dark beat): a bare intent must not let the driver default pan/tilt to 0 and
   send the head lurching across the room on every blackout. */
{
  const lightsOut = path.join(tmp, "baketest.lights.json");
  execFileSync("node", [path.join(__dirname, "bake.js"), scoreFile, "1", "--lights", lightsOut], { stdio: "pipe" });
  const L = JSON.parse(fs.readFileSync(lightsOut, "utf8"));
  const pan = L.frames.map(f => f[28]), tilt = L.frames.map(f => f[30]);   // head @29: pan, tilt coarse
  const ent = L.moments.find(m => m.kind === "entrance");
  const beat = 60 / SCORE.grid.bpm, k = Math.round(ent.t * L.fps);
  /* the beat before the entrance is a blackout: the head keeps gliding along its
     own path in the dark (the override keeps its pose), and nothing may lurch --
     0 is a real pose now (the end of travel), so the test is continuity, not "never 0" */
  const k0 = Math.round((ent.t - beat) * L.fps) + 2, dark = L.frames.slice(k0, k);
  const win = L.frames.slice(k0 - 5, k + 10);
  const jump = Math.max(...win.slice(1).map((f, i) => Math.max(Math.abs(f[28] - win[i][28]), Math.abs(f[30] - win[i][30]))));
  ok("through the blackout beat and into the blast the head never lurches (7 DMX per frame at most)", dark.length > 5 && jump <= 7, `max step ${jump} over ${win.length} frames`);
  ok("and the blackout is dark", dark.every(f => f[33] === 0));
  /* on the blast (weight .9) the head heads for the wall centre (169/40), never for 0/0 */
  const before = dark[0], on = L.frames[k + 3];
  ok("on the heavy entrance the head moves toward the wall centre",
     Math.abs(on[28] - 169) <= Math.abs(before[28] - 169) && Math.abs(on[30] - 40) <= Math.abs(before[30] - 40), `pan ${before[28]}->${on[28]} tilt ${before[30]}->${on[30]}`);
}

/* the timeline carries the per-bar facts the picks were made with */
{
  const F = baked.facts;
  ok("the baked timeline carries facts anchored like the plan", F && F.from_bar === 0 && F.vectors.length === 17, F && `${F.from_bar} x ${F.vectors.length}`);
  /* the fixture's only high-energy section is also its last, so its context is final_drop */
  ok("a bar in the drop says so", F.vectors[9].form === "final_drop" && F.vectors[9].moment.includes("entrance") && F.vectors[9].moment.includes("heavy"), JSON.stringify(F.vectors[9]));
  ok("the raw hub score bakes the same facts", JSON.stringify(rawBaked.facts) === JSON.stringify(F));
}

fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
for (const [pass, name, detail] of out) {
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
