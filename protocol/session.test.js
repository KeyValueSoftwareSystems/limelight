/* The test that has to pass before anything is built on top.
   ---------------------------------------------------------------------------
   It runs on a fake clock, so a whole song passes in no time and nothing here
   depends on how fast the machine is. The scenario in the last block is the one
   Renjith described out loud: note the next beat, pause, seek backwards, change
   the tempo, and check the beat has not moved. */
"use strict";
const { Session } = require("./session.js");
const score = require("./score.levels.json");

let t = 1000;                                   /* wall seconds, ours to move */
const clock = () => t;
const advance = s => { t += s; };

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

/* ---- the grid ----------------------------------------------------------- */
{
  const s = Session(score, { now: clock });
  ok("128 bpm means a beat every 0.46875 s",
     near(s.secondsAt(1, 2) - s.secondsAt(1, 1), 0.46875));
  ok("a bar is four of those", near(s.secondsAt(2, 1) - s.secondsAt(1, 1), 1.875));
  ok("the first beat is where the score says it is",
     near(s.secondsAt(1, 1), 0.2233));
  ok("bar 12 beat 3 round-trips",
     (p => p.bar === 12 && near(p.beat, 3, 1e-3))(s.positionAt(s.secondsAt(12, 3))),
     JSON.stringify(s.positionAt(s.secondsAt(12, 3))));
  ok("before the first beat is flagged, not reported as bar zero",
     s.positionAt(0).before_first_beat === true);
  ok("nothing is ever a negative beat", s.positionAt(0).beat > 0,
     "beat " + s.positionAt(0).beat);
}

/* ---- play and pause ------------------------------------------------------ */
{
  const s = Session(score, { now: clock });
  ok("a new session is not playing", s.now().playing === false);
  s.play(); advance(10);
  ok("ten wall seconds move the song ten seconds", near(s.now().seconds, 10, 1e-9));
  s.pause(); advance(30);
  ok("thirty seconds of pause move nothing", near(s.now().seconds, 10, 1e-9),
     "at " + s.now().seconds);
  s.play(); advance(5);
  ok("play resumes from where it stopped", near(s.now().seconds, 15, 1e-9));
}

/* ---- seek ---------------------------------------------------------------- */
{
  const s = Session(score, { now: clock });
  /* Derive the target rather than hardcoding a second. The first version of
     this test asserted bar 34 at 61.9 s because 61.9 was a number carried over
     from an older grid; bar 33 beat 1 is actually at 60.2233 s here. A test
     that recomputes cannot go stale when the score is corrected. */
  s.seek(s.secondsAt(34, 1));
  const p = s.now().position;
  ok("seek lands exactly on the bar it was given",
     p.bar === 34 && near(p.beat, 1, 1e-3), "bar " + p.bar + " beat " + p.beat);
  s.play(); advance(1.875);
  ok("one bar of wall time later, one bar later", s.now().position.bar === 35,
     "bar " + s.now().position.bar);
  s.rate(2); advance(1.875);
  ok("at double rate, one bar of wall time is two bars of song",
     s.now().position.bar === 37, "bar " + s.now().position.bar);
}

/* ---- tempo: the whole point --------------------------------------------- */
{
  const s = Session(score, { now: clock });
  s.seek(s.secondsAt(33, 1)); s.play();

  const at1 = s.next(2000);
  s.rate(1.2);
  const at12 = s.next(2000);

  const musical = x => x.map(b => b.bar + "." + b.beat).join(" ");
  const n = Math.min(at1.length, at12.length);
  ok("the same beats are coming, whatever the rate",
     musical(at1.slice(0, n)) === musical(at12.slice(0, n)),
     musical(at1.slice(0, n)) + "   vs   " + musical(at12.slice(0, n)));
  ok("but they arrive sooner in the caller's clock",
     at12[0].in_ms <= at1[0].in_ms && at12[1].in_ms < at1[1].in_ms,
     at1.slice(0, 3).map(b => b.in_ms) + "  ->  " + at12.slice(0, 3).map(b => b.in_ms));
  ok("a faster rate fits more of the song into the same two seconds",
     at12.length > at1.length, at1.length + " -> " + at12.length);
  ok("changing rate does not move the playhead",
     near(s.now().position.bar, 33, 0), "bar " + s.now().position.bar);
}

/* ---- the scenario, end to end ------------------------------------------- */
{
  const s = Session(score, { now: clock });
  s.seek(s.secondsAt(12, 1)); s.play(); advance(0.72);

  const before = s.next(4000)[0];
  s.pause(); advance(90);                 /* somebody answers the door */
  s.seek(s.secondsAt(12, 1)); advance(0.72 / 1);
  s.play(); advance(0);
  s.seek(s.secondsAt(12, 1) + 0.72);
  s.rate(1.4);
  const after = s.next(4000)[0];

  ok("after a pause, a seek and a tempo change, the next beat is the same beat",
     before.bar === after.bar && before.beat === after.beat,
     `bar ${before.bar} beat ${before.beat}  ->  bar ${after.bar} beat ${after.beat}`);
  ok("and only the milliseconds moved",
     before.in_ms !== after.in_ms, `${before.in_ms} ms -> ${after.in_ms} ms`);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
