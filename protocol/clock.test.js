/* The clock contract, checked -- including that the check can fail.
   ---------------------------------------------------------------------------
   A test nothing can fail is not a test. That is not a general worry here, it
   is the specific bug this project has hit three times: a phrase origin scored
   against itself, a scores check that would have skipped when its input went
   missing, and a bar base that agreed with whatever it was given. So this
   asserts both halves -- that the anchored clock keeps the contract, and that
   the other two break it, each in its own way. */
"use strict";
const { CountingClock, RawAudioClock, AnchoredClock, FakeAudio, conformance } = require("./clock.js");
const { Session } = require("./session.js");

const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

/* ---- the anchored clock keeps the contract ------------------------------ */
for (const [p, n, d] of conformance((a, o) => AnchoredClock(a, o), "anchored")) ok(n, p, d);

/* ---- and the other two fail, on different things ------------------------ */
const counting = conformance((a, o) => CountingClock(a, o), "counting");
const raw = conformance((a, o) => RawAudioClock(a, o), "raw");
const failed = l => l.filter(r => !r[0]).map(r => r[1].split(": ")[1]);

ok("the harness can fail: a counting clock is never accurate",
   failed(counting).length >= 3, failed(counting).join("; "));
ok("it fails on the three things that put a show out of sync",
   ["ahead of a sound", "start delay changes", "slide apart"]
     .every(k => failed(counting).some(f => f.includes(k))));
ok("a counting clock is smooth, which is why it is believed",
   !failed(counting).some(f => f.includes("judders")),
   "accurate never, smooth always -- it looks right and is not");

ok("reading the audio raw is accurate", 
   !["ahead of a sound", "slide apart", "start delay"].some(k => failed(raw).some(f => f.includes(k))));
ok("but it judders, which is the other way to get this wrong",
   failed(raw).some(f => f.includes("judders")), failed(raw).join("; "));

ok("only the anchored clock passes everything",
   conformance((a, o) => AnchoredClock(a, o)).every(r => r[0]));

/* ---- a calibration tuned on one run is wrong on the next ---------------- */
/* This is the evening that keeps getting spent in the room. */
{
  let t = 0; const now = () => t;
  const a = FakeAudio(now, { start_delay_s: 0.080, update_every_s: 0.001 });
  const c = CountingClock(a, { now });
  c.play(0); t += 1.08;
  const tuned = c.position() - a.trueTime();          /* fixes THIS run exactly */

  t = 0;
  const a2 = FakeAudio(now, { start_delay_s: 0.025, update_every_s: 0.001 });
  const c2 = CountingClock(a2, { now });
  c2.play(0); t += 1.025;
  const left = (c2.position() - tuned - a2.trueTime()) * 1000;
  ok("a calibration tuned on one run is wrong on the next", Math.abs(left) > 20,
     `tuned out ${(tuned * 1000).toFixed(0)} ms, still ${left.toFixed(0)} ms out next time`);
}

/* ---- the clock plugs into the protocol --------------------------------- */
const score = { grid: { bpm: 120, beats_per_bar: 4, first_beat_s: 0, first_bar: 1 } };
{
  let t = 0; const now = () => t;
  const a = FakeAudio(now, { start_delay_s: 0.100, update_every_s: 0.001 });
  const clock = AnchoredClock(a, { now });
  const s = Session(score, { songTime: () => clock.position() });
  clock.play(0);
  t += 0.050;                                    /* half the start delay: silent */
  const p0 = s.now().position;
  ok("the protocol does not advance while the audio is still silent",
     p0.bar === 1 && p0.beat === 1, `bar ${p0.bar} beat ${p0.beat}`);

  t += 2.100;                                    /* 2.05 s of music = bar 2 beat 1.1 */
  const p1 = s.now().position;
  ok("and lands on the bar the audio is actually at",
     p1.bar === 2 && Math.abs(p1.beat - 1.1) < 0.02, `bar ${p1.bar} beat ${p1.beat}`);
}

/* ---- what a rhythm game actually asks for ------------------------------ */
/* A note takes a fixed time to travel from the spawn point to the strike line.
   That travel time IS the lead time: ask the protocol what is coming in the
   next 1200 ms and those are exactly the notes to spawn this frame. */
{
  let t = 0; const now = () => t;
  const a = FakeAudio(now, { start_delay_s: 0.02, update_every_s: 0.050 });
  const clock = AnchoredClock(a, { now });
  const s = Session(score, { songTime: () => clock.position() });
  clock.play(0);
  t += 0.5;

  const APPROACH_MS = 1200;
  const spawned = new Map();                    /* one note per beat, never twice */
  const frame = 1 / 60;
  for (let i = 0; i < 600; i++) {               /* ten seconds of frames */
    t += frame;
    for (const b of s.next(APPROACH_MS)) {
      if (b.what) continue;                     /* section events, not beats */
      const key = `${b.bar}:${b.beat}`;
      if (!spawned.has(key)) spawned.set(key, { frame: i, in_ms: b.in_ms });
    }
  }
  const beats = [...spawned.values()];
  ok("every beat in the window gets spawned exactly once", spawned.size > 15,
     `${spawned.size} notes over ten seconds at 120 bpm`);

  /* The first call is different and a game has to expect it. next() answers
     "what is inside the window", not "what just entered it", so the first call
     after play or a seek hands back a backlog -- notes already part-way to the
     strike line, some of them nearly on it. Spawn those at their true distance
     or drop them; do not give them a full approach, or they arrive late. */
  const firstBatch = beats.filter(b => b.frame === 0).map(b => b.in_ms);
  ok("the first call hands back everything already in the window",
     firstBatch.length > 1 && Math.min(...firstBatch) < APPROACH_MS * 0.5,
     `${firstBatch.length} notes at ${Math.min(...firstBatch)}-${Math.max(...firstBatch)} ms`);

  const steady = beats.filter(b => b.frame > 0).map(b => b.in_ms);
  ok("after that, each new note arrives with a full approach of warning",
     steady.every(l => l > APPROACH_MS - 25 && l <= APPROACH_MS),
     `lead times ${Math.min(...steady)}-${Math.max(...steady)} ms, asked for ${APPROACH_MS}`);
}

/* ---- and a tempo change costs the game nothing ------------------------- */
{
  const s = Session(score, { now: () => 0 });
  s.seek(10.1).play();   /* not exactly on a beat: that is a degenerate case */
  const atOne = s.next(1200).filter(b => !b.what);
  s.rate(1.5);
  const atOneFive = s.next(1200).filter(b => !b.what);
  ok("a faster song puts more notes inside the same approach window",
     atOneFive.length > atOne.length, `${atOne.length} -> ${atOneFive.length} notes`);
  ok("and they are the same beats, arriving sooner",
     atOne[0].bar === atOneFive[0].bar && atOne[0].beat === atOneFive[0].beat
     && atOneFive[0].in_ms < atOne[0].in_ms,
     `bar ${atOne[0].bar} beat ${atOne[0].beat}: ${atOne[0].in_ms} -> ${atOneFive[0].in_ms} ms`);
}

for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} of ${out.length} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
