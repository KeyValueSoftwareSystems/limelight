/* The test that has to pass before anything is built on top.
   ---------------------------------------------------------------------------
   It runs on a fake clock, so a whole song passes in no time and nothing here
   depends on how fast the machine is. The scenario in the last block is the one
   Renjith described out loud: note the next beat, pause, seek backwards, change
   the tempo, and check the beat has not moved. */
"use strict";
const { Session } = require("./session.js");
/* Read live from scores/, never from a copy beside this file: a committed
   sample goes stale the first time the pipeline changes. */
const { adapt } = require("./respond.js");
const score = adapt(JSON.parse(require("fs").readFileSync(
  __dirname + "/../scores/levels.score", "utf8")));
/* Every timing expectation comes from the score's own grid. Hardcoding 128.0
   and 0.2233 pinned this suite to a fixture that no longer exists. */
const BEAT_S = 60 / score.grid.bpm;
const BAR_S = BEAT_S * score.grid.beats_per_bar;

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
  /* Derived from the score's own grid. Hardcoding 128.0 and 0.2233 pinned this
     to a fixture that no longer exists; the live score is 128.01. */
  ok(`${score.grid.bpm} bpm means a beat every ${BEAT_S.toFixed(5)} s`,
     near(s.secondsAt(1, 2) - s.secondsAt(1, 1), BEAT_S));
  ok("a bar is four of those", near(s.secondsAt(2, 1) - s.secondsAt(1, 1), BAR_S));
  ok("the first beat is where the score says it is",
     near(s.secondsAt(1, 1), score.grid.first_beat_s));
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
  s.play(); advance(BAR_S);
  ok("one bar of wall time later, one bar later", s.now().position.bar === 35,
     "bar " + s.now().position.bar);
  s.rate(2); advance(BAR_S);
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
  /* Seeking to a section start puts several events exactly on the cursor, and
     0 ms is 0 ms at any rate. Compare the first one actually in the future. */
  const soon = x => (x.find(b => b.in_ms > 0) || {}).in_ms;
  ok("but they arrive sooner in the caller's clock",
     soon(at12) < soon(at1),
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
  /* A pickup means bar 1 does not start at beat index 0, so count from the
     first downbeat rather than assuming the song opens on one. */
  const opens = B.list.findIndex(b => b[0] === 1 && b[1] === 1);
  B.list.forEach((b, i) => {
    const k = i - opens;
    const want = k < 0 ? [0, bpb + k + 1]
                       : [Math.floor(k / bpb) + 1, (k % bpb) + 1];
    if (b[0] !== want[0] || b[1] !== want[1]) drift++;
  });
  /* On a real recording the tracker occasionally hears a bar of three or five,
     so a couple of beats land in a different slot. A numbering error would put
     every beat out, not two of five hundred. */
  ok("the listed beats follow the grid", drift <= B.list.length * 0.01,
     drift + " of " + B.list.length + " disagree");

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

  /* the whole point of layers: something that crosses a form boundary. The
     pipeline has no build layer; it has moments that carry into the next
     section, which is the same claim about the same shape. */
  const per = score.grid.beats_per_bar || 4;
  const edges = (L.form.spans || []).map(sp => sp.from.bar);
  const carries = (score.moments || []).filter(m => {
    const end = m.back_at != null ? m.back_at
              : m.for_beats ? m.bar + m.for_beats / per : null;
    return end != null && edges.some(e => m.bar < e && e < end);
  });
  ok("a moment can cross a form boundary", carries.length > 0,
     carries.length + " of " + (score.moments || []).length);

  /* several layers answer at once, and that is not a bug */
  const at78 = s.sectionsAt({ bar: 78, beat: 1 });
  /* The pipeline has no build layer. form, subsection, presence and phrase are
     the four it does have, and they answer together, which is the claim. */
  ok("at bar 78, four layers have something to say",
     !!at78.form && !!at78.subsection && at78.presence.length > 0 && !!at78.phrase,
     `form ${at78.form && at78.form.name} · doing ${at78.subsection && at78.subsection.name}` +
     ` · presence ${at78.presence.map(x=>x.name)} · phrase ${at78.phrase && at78.phrase.index}`);

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

/* ---- bar zero is a number, not an absence -------------------------------
   `x || 1` reads bar 0 as "missing" and substitutes 1, which is the same
   one-bar error grid.first_bar was introduced to kill. It was live in two
   places: a 0-based score read its energy a whole bar late, and a phrase grid
   anchored at bar 0 snapped to bar 1. Levels is 0-based, so this was the demo
   song. */
{
  const zero = {
    grid: { bpm: 120, beats_per_bar: 4, first_beat_s: 0, first_bar: 0 },
    parts: [{ from_bar: 0, to_bar: 15, role: "intro", nth: 1 }],
    bars: { intensity: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7,
                        0.8, 0.9, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5] },
  };
  const s = Session(zero, { now: clock });
  const wrong = [0, 1, 2, 3, 4, 5].filter(
    b => Math.abs(s.energyAt({ bar: b, beat: 1 }) - zero.bars.intensity[b]) > 1e-9);
  ok("a 0-based score reads its own energy, not the bar before it", wrong.length === 0,
     wrong.length ? "bars " + wrong.join(",") + " off by one"
                  : "bars 0-5 match the score");

  const phrased = Session(Object.assign({}, zero, {
    layers: { phrase: { kind: "rule", every_bars: 8, from_bar: 0 } } }), { now: clock });
  const ph = phrased.sectionsAt({ bar: 0, beat: 1 }).phrase;
  ok("a phrase grid anchored at bar 0 starts at bar 0", ph && ph.from.bar === 0,
     ph ? `starts bar ${ph.from.bar}` : "no phrase");
  const ph8 = phrased.sectionsAt({ bar: 8, beat: 1 }).phrase;
  ok("and its second phrase starts at bar 8", ph8 && ph8.index === 2 && ph8.from.bar === 8,
     ph8 ? `phrase ${ph8.index} at bar ${ph8.from.bar}` : "no phrase");
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
