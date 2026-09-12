/* The test that has to pass before anything is built on top.
   ---------------------------------------------------------------------------
   It runs on a fake clock, so a whole song passes in no time and nothing here
   depends on how fast the machine is. The scenario in the last block is the one
   Renjith described out loud: note the next beat, pause, seek backwards, change
   the tempo, and check the beat has not moved. */
"use strict";
const { Session } = require("./session.js");
const score = JSON.parse(require("fs").readFileSync(__dirname + "/levels.score", "utf8"));

let t = 1000;                                   /* wall seconds, ours to move */
const clock = () => t;
const advance = s => { t += s; };

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);
const bpb = score.grid.beats_per_bar;
const at = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);

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

/* ---- beats and downbeats are written out, and must agree with the grid --- */
{
  const s = Session(score, { now: clock });
  const B = score.beats, D = score.downbeats;
  ok("beats are listed as [bar, beat], never as seconds",
     Array.isArray(B.list[0]) && B.list[0].length === 2,
     JSON.stringify(B.list[0]));
  ok("no second appears anywhere in the beat list",
     B.list.every(b => Number.isInteger(b[0]) && Number.isInteger(b[1])));

  /* the list is a convenience; the grid is the authority. If these two ever
     disagree the list is what is wrong, so check it every run. */
  let drift = 0;
  B.list.forEach((b, i) => {
    if (b[0] !== Math.floor(i / bpb) + 1 || b[1] !== (i % bpb) + 1) drift++;
  });
  ok("every listed beat is where the grid puts it", drift === 0, drift + " disagree");

  ok("downbeats are the beat ones", D.list.every(b => b[1] === 1));
  ok("there is one downbeat per bar",
     D.count === new Set(B.list.map(b => b[0])).size,
     `${D.count} downbeats, ${new Set(B.list.map(b => b[0])).size} bars`);

  /* and the whole point: the list survives a tempo change untouched */
  const before = JSON.stringify(B.list.slice(0, 8));
  s.rate(1.7);
  ok("the beat list does not change when the tempo does",
     JSON.stringify(score.beats.list.slice(0, 8)) === before);
}

/* ---- energy ------------------------------------------------------------- */
{
  const s = Session(score, { now: clock });
  const E = score.energy;
  ok("energy is one number per bar, not a list of coordinates",
     E.per === "bar" && typeof E.values[0] === "number", E.values.length + " values");
  ok("energy reads at a bar line exactly as stored",
     near(s.energyAt({ bar: E.from_bar, beat: 1 }), E.values[0], 1e-9));
  const mid = s.energyAt({ bar: E.from_bar, beat: 1 + bpb / 2 });
  ok("and interpolates between bars on the client",
     mid > Math.min(E.values[0], E.values[1]) - 1e-9 &&
     mid < Math.max(E.values[0], E.values[1]) + 1e-9,
     `${E.values[0]} .. ${mid} .. ${E.values[1]}`);
}

/* ---- sections, in layers ------------------------------------------------ */
{
  const s = Session(score, { now: clock });
  const L = score.layers || {};
  ok("the score carries more than one layer", Object.keys(L).length >= 4,
     Object.keys(L).join(", "));

  /* a partition covers every bar exactly once */
  let multi = 0, none = 0;
  for (let bar = 4; bar < 120; bar++) {
    const hit = (L.form.spans || []).filter(sp =>
      bar >= sp.from.bar && bar < sp.to.bar);
    if (hit.length > 1) multi++;
    if (hit.length === 0) none++;
  }
  ok("form is a partition -- never two at once", multi === 0, multi + " overlaps");
  ok("form is a partition -- never a gap", none === 0, none + " uncovered bars");

  /* the whole point of layers: something that crosses a form boundary */
  const build = (L.build.spans || [])[0];
  const crossed = (L.form.spans || []).filter(sp =>
    at(sp.from) > at(build.from) && at(sp.from) < at(build.to));
  ok("a build crosses a form boundary, which is why layers exist",
     crossed.length >= 1,
     `build bar ${build.from.bar}-${build.to.bar} crosses ` +
     crossed.map(c => c.name + " at " + c.from.bar).join(", "));

  /* several layers answer at once, and that is not a bug */
  const at78 = s.sectionsAt({ bar: 78, beat: 1 });
  ok("at bar 78, four layers have something to say",
     !!at78.form && at78.build.length > 0 && at78.presence.length > 0 && !!at78.phrase,
     `form ${at78.form.name} · energy ${at78.build.map(x=>x.name)} · ` +
     `presence ${at78.presence.map(x=>x.name)} · phrase ${at78.phrase.index}`);

  /* rule 8: the voice has one writer */
  const vocalInPresence = (L.presence.spans || []).some(sp => sp.name === "vocals");
  ok("the voice is not described by two layers at once", !vocalInPresence);

  /* phrase is derived, not stored */
  ok("phrase is a rule rather than a list", L.phrase.kind === "rule");
  const p1 = s.sectionsAt({ bar: L.phrase.from_bar, beat: 1 }).phrase;
  const p2 = s.sectionsAt({ bar: L.phrase.from_bar + L.phrase.every_bars, beat: 1 }).phrase;
  ok("consecutive phrases are consecutive", p2.index === p1.index + 1,
     p1.index + " -> " + p2.index);
}

/* ---- until(): building toward a change rather than reacting to one ------- */
{
  const s = Session(score, { now: clock });
  const form = (score.layers.form.spans || []).find(sp => sp.to.bar - sp.from.bar >= 4);
  s.seek(s.secondsAt(form.from.bar, 1)); s.play();

  const u = s.until("form");
  ok("until() says which section ends and when", u && u.name === form.name,
     u && `${u.name} in ${u.in_ms} ms`);
  ok("and how many bars that is",
     near(u.bars, form.to.bar - form.from.bar, 1e-6), u && u.bars + " bars");

  s.rate(2);
  const u2 = s.until("form");
  ok("the bars do not change with tempo", near(u2.bars, u.bars, 1e-6));
  ok("the milliseconds halve", near(u2.in_ms, Math.round(u.in_ms / 2), 1),
     `${u.in_ms} -> ${u2.in_ms}`);
}

/* ---- boundaries arrive in next(), with lead time ------------------------ */
{
  const s = Session(score, { now: clock });
  const form = score.layers.form.spans[3];
  s.seek(s.secondsAt(form.to.bar, 1) - 1.0); s.play();
  const up = s.next(2000).filter(e => e.layer);
  ok("a section boundary shows up before it happens", up.length > 0,
     up.map(e => e.what + " +" + e.in_ms + "ms").join("  "));
  ok("and it is announced early enough to act on",
     up.every(e => e.in_ms >= 0 && e.in_ms <= 2000));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
