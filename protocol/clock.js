/* What a song clock has to do, and a test that a guessing clock cannot pass.
   ---------------------------------------------------------------------------
   The protocol answers "where are we in the song" in musical terms, but
   something has to tell it where the song is in seconds. That something is a
   clock, and everything downstream is only as good as the clock is honest.

   A consumer can get this wrong in two different ways, and they are not the
   same mistake.

     COUNTING     Start a timer when play is pressed and report elapsed time --
                  from performance.now(), or worse, by adding up frame deltas.
                  It starts before the sound does, so it runs ahead; the size of
                  that head start changes every run, so no fixed calibration
                  removes it; and it drifts from the audio over a song. This is
                  accurate never.

     READING RAW  Return audio.currentTime directly. Accurate, but an audio
                  element only updates that value a few times a second, so the
                  reading is a staircase. Anything drawing from it judders: in a
                  game the notes visibly step toward you instead of sliding.
                  This is accurate but not smooth.

     ANCHORED     Read audio.currentTime, and between its updates carry the
                  position forward with a wall clock -- re-anchoring every time
                  the audio reports a new value. Accurate AND smooth, because
                  the wall clock is only ever trusted for the few milliseconds
                  since the last real measurement, so its error can never build.

   Hand one to a Session as `songTime` and the protocol stops keeping a clock
   of its own:

       const clock = AnchoredClock(audio);
       const s = Session(score, { songTime: () => clock.position() });

   conformance() is what makes this a rule rather than advice. It drives a
   clock through an audio element that starts late, runs slightly fast, and
   updates coarsely, and reports where the clock lies. All three clocks above
   are in this file on purpose: a test that nothing can fail is not a test, so
   the suite proves the harness by failing the two that should fail.
*/
"use strict";

/* ---- a clock that counts. Kept so the test has something to fail. -------- */
function CountingClock(audio, opts) {
  const now = (opts && opts.now) || (() => performance.now() / 1000);
  let anchor = 0, anchorWall = null, playing = false;
  return {
    get playing() { return playing; },
    position() {
      if (!playing || anchorWall === null) return anchor;
      return anchor + (now() - anchorWall);
    },
    play(at) {
      anchor = at === undefined ? this.position() : Math.max(0, at);
      anchorWall = now();                 /* counting starts here... */
      playing = true;
      audio.play(anchor);                 /* ...and the sound starts later */
    },
    pause() { anchor = this.position(); playing = false; audio.pause(); },
    seek(t) { anchor = Math.max(0, t); anchorWall = now(); if (playing) audio.play(anchor); },
  };
}

/* ---- a clock that reads the audio raw. Accurate, and it judders. --------- */
function RawAudioClock(audio) {
  return {
    get playing() { return !audio.paused; },
    position() { return audio.currentTime; },
    play(at) { if (at !== undefined) audio.currentTime = Math.max(0, at); audio.play(); },
    pause() { audio.pause(); },
    seek(t) { audio.currentTime = Math.max(0, t); },
  };
}

/* ---- the one to use ----------------------------------------------------- */
function AnchoredClock(audio, opts) {
  const now = (opts && opts.now) || (() => performance.now() / 1000);
  /* How far the wall clock is allowed to carry the position on its own before
     we stop believing it. An audio element updates a few times a second; if it
     has told us nothing for this long, something is wrong and a frozen reading
     is a better answer than an invented one. */
  const maxCarry = (opts && opts.max_carry_s) || 0.25;

  let lastRaw = null;      /* the last value the audio actually reported */
  let rawAt = 0;           /* wall time when it reported it */
  let out = 0;             /* what we last returned, so we never go backwards */

  function position() {
    const raw = audio.currentTime;
    if (audio.paused) { lastRaw = raw; rawAt = now(); out = raw; return raw; }

    if (raw !== lastRaw) {               /* a real measurement arrived */
      lastRaw = raw;
      rawAt = now();
    }
    const carried = now() - rawAt;
    /* Between the audio's updates, carry forward with the wall clock. The error
       can never accumulate, because the next real reading resets it. */
    let est = lastRaw + Math.min(carried, maxCarry);
    /* Time in a song does not go backwards, and a note that jumps backwards is
       a missed hit the player did not earn. */
    if (est < out) est = out;
    out = est;
    return est;
  }

  return {
    get playing() { return !audio.paused; },
    position,
    play(at) {
      if (at !== undefined) audio.currentTime = Math.max(0, at);
      lastRaw = null; out = audio.currentTime; rawAt = now();
      audio.play();
    },
    pause() { audio.pause(); lastRaw = null; out = audio.currentTime; },
    seek(t) {
      audio.currentTime = Math.max(0, t);
      lastRaw = null; out = audio.currentTime; rawAt = now();
    },
  };
}

/* ---- an audio element that misbehaves the way real ones do --------------- */
/* start_delay_s  the gap between play() and the first sample being audible.
   update_every_s how often currentTime actually changes -- an element reports
                  a few times a second, not continuously.
   rate           the device's sample clock against the CPU's. 1.0003 means the
                  card plays slightly fast, which is an ordinary amount wrong. */
function FakeAudio(now, opts) {
  opts = opts || {};
  const startDelay = opts.start_delay_s === undefined ? 0.08 : opts.start_delay_s;
  const updateEvery = opts.update_every_s === undefined ? 0.05 : opts.update_every_s;
  const rate = opts.rate === undefined ? 1 : opts.rate;
  let from = 0, startedWall = null, reported = 0;

  const self = {
    paused: true,
    get currentTime() {
      if (startedWall === null) return reported;
      const t = self.trueTime();
      /* only report on the update grid: this is the staircase */
      const steps = Math.floor((t - from) / updateEvery);
      reported = steps < 0 ? from : from + steps * updateEvery;
      return reported;
    },
    set currentTime(v) { from = Math.max(0, v); reported = from; startedWall = null; },
    trueTime() {
      if (startedWall === null) return from;
      const e = now() - startedWall - startDelay;
      return e < 0 ? from : from + e * rate;
    },
    play(at) {
      if (at !== undefined) { from = Math.max(0, at); reported = from; }
      startedWall = now();
      self.paused = false;
    },
    pause() { from = self.trueTime(); reported = from; startedWall = null; self.paused = true; },
  };
  return self;
}

function conformance(makeClock, label) {
  const res = [];
  const ok = (n, c, d) => res.push([!!c, (label ? label + ": " : "") + n, d || ""]);

  /* --- 1. the sound starts late, and the clock must not run ahead of it --- */
  let t = 0; const now = () => t;
  let a = FakeAudio(now, { start_delay_s: 0.080, update_every_s: 0.001, rate: 1 });
  let c = makeClock(a, { now });
  c.play(0);
  t += 0.040;                                  /* 40 ms in: still silent */
  const silent = (c.position() - a.trueTime()) * 1000;
  ok("does not run ahead of a sound that has not started", Math.abs(silent) < 8,
     `${silent >= 0 ? "+" : ""}${silent.toFixed(0)} ms ahead while still silent`);

  t += 1.0;
  const started = (c.position() - a.trueTime()) * 1000;
  ok("agrees with the audio once it is playing", Math.abs(started) < 8,
     `${started >= 0 ? "+" : ""}${started.toFixed(0)} ms`);

  /* --- 2. the same test with a different start delay ---------------------- */
  /* The one a fixed calibration cannot survive: if the error differs between
     these two, no single number corrects both. */
  t = 0;
  let a2 = FakeAudio(now, { start_delay_s: 0.020, update_every_s: 0.001, rate: 1 });
  let c2 = makeClock(a2, { now });
  c2.play(0);
  t += 1.020;
  const other = (c2.position() - a2.trueTime()) * 1000;
  ok("is wrong by the same amount when the start delay changes",
     Math.abs(other - started) < 8,
     `${started.toFixed(0)} ms at one delay, ${other.toFixed(0)} ms at another`
     + (Math.abs(other - started) >= 8 ? " -- a fixed calibration cannot fix both" : ""));

  /* --- 3. the card runs fast, and the clock must run fast with it --------- */
  t = 0;
  let a3 = FakeAudio(now, { start_delay_s: 0, update_every_s: 0.001, rate: 1.0003 });
  let c3 = makeClock(a3, { now });
  c3.play(0);
  t += 1.0; const early = (c3.position() - a3.trueTime()) * 1000;
  t += 240.0; const late = (c3.position() - a3.trueTime()) * 1000;
  ok("does not slide apart from the audio across a song", Math.abs(late - early) < 50,
     `${early.toFixed(0)} ms at the start, ${late.toFixed(0)} ms four minutes in`);

  /* --- 4. smooth enough to draw from ------------------------------------- */
  /* A game reads the clock once per frame and moves everything by the
     difference. If the clock only changes a few times a second, the reading is
     a staircase and the notes step toward the player instead of sliding. */
  t = 0;
  let a4 = FakeAudio(now, { start_delay_s: 0, update_every_s: 0.050, rate: 1 });
  let c4 = makeClock(a4, { now });
  c4.play(0);
  const frame = 1 / 60;
  let prev = c4.position(), biggest = 0, stalls = 0;
  for (let i = 0; i < 120; i++) {
    t += frame;
    const p = c4.position();
    const step = p - prev;
    if (step > biggest) biggest = step;
    if (step < frame * 0.25) stalls++;
    prev = p;
  }
  ok("moves by about one frame per frame, so nothing judders",
     biggest < frame * 2.5 && stalls < 12,
     `biggest jump ${(biggest * 1000).toFixed(0)} ms (a frame is ${(frame * 1000).toFixed(0)}), `
     + `${stalls} of 120 frames stalled`);

  /* --- 5. never backwards ------------------------------------------------ */
  t = 0;
  let a5 = FakeAudio(now, { start_delay_s: 0.03, update_every_s: 0.050, rate: 1 });
  let c5 = makeClock(a5, { now });
  c5.play(0);
  let last = -Infinity, back = 0;
  for (let i = 0; i < 200; i++) { t += frame / 2; const p = c5.position(); if (p < last - 1e-9) back++; last = p; }
  ok("never goes backwards", back === 0, `${back} backward steps`);

  /* --- 6. paused means paused, and a seek lands where it was sent --------- */
  t = 0;
  let a6 = FakeAudio(now, { start_delay_s: 0, update_every_s: 0.001, rate: 1 });
  let c6 = makeClock(a6, { now });
  c6.play(10);
  t += 2.0;
  const held = c6.position();
  c6.pause();
  t += 30.0;
  ok("does not move while paused", Math.abs(c6.position() - held) * 1000 < 8,
     `moved ${((c6.position() - held) * 1000).toFixed(0)} ms in 30 s of pause`);
  c6.seek(61.9);
  ok("reports where it was sent", Math.abs(c6.position() - 61.9) < 0.008,
     `${c6.position().toFixed(3)} s`);

  return res;
}

const M = { CountingClock, RawAudioClock, AnchoredClock, FakeAudio, conformance };
if (typeof module !== "undefined" && module.exports) module.exports = M;
if (typeof window !== "undefined") window.LimelightClock = M;
