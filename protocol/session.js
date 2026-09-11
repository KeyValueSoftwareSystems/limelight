/* A session: the container's side of the protocol.  Beats only, for now.
   ---------------------------------------------------------------------------
   The score says three things -- the tempo, where the first beat lands, and how
   many beats to a bar -- and every beat in the recording is derived from those
   rather than transmitted. That is the whole reason a tempo change costs
   nothing here: a list of beat times in seconds would be wrong the instant the
   rate moved, and would have to be fetched again.

   Two clocks live in this file and keeping them apart is the design:

     the SCORE clock   song seconds -> musical position.  Fixed forever.
                       Rate never touches it. Bar 12 beat 3 is at the same
                       song-second whatever speed you play the record.

     the TRANSPORT     wall time -> song seconds.  Rate lives here, and here
                       only. Play, pause and seek are facts about this clock
                       and the score never hears about them.

   So `now()` answers in musical position, and `next()` answers in the caller's
   own milliseconds -- which is the only place the two clocks meet.

     const s = Session(score);
     s.play(); s.pause(); s.seek(61.9); s.rate(1.4);
     s.now()        -> { position: {bar, beat}, phase, to_next_beat_ms }
     s.next(2000)   -> [ { bar, beat, accent, in_ms } ]
*/
"use strict";

function Session(score, opts) {
  const g = (score && score.grid) || {};
  const bpm = g.bpm, bpb = g.beats_per_bar || 4, first = g.first_beat_s || 0;
  if (!bpm) throw new Error("a score needs grid.bpm");

  const beatSec = 60 / bpm;              /* song seconds per beat -- never scaled */
  const barSec = beatSec * bpb;

  /* An injectable clock, so the tests can run without waiting for real time
     and a browser can hand us an audio element's own clock instead. */
  const wall = (opts && opts.now) || (() => Date.now() / 1000);

  /* A real music container already has a clock -- an audio element knows its
     own position better than we ever could. When one is handed to us we read
     it instead of running a second clock beside it, because two clocks in one
     program drift and then somebody spends an evening finding out why the
     lights are 40 ms late. */
  const songTime = opts && opts.songTime;

  let playing = false, rate = 1;
  let held = 0;                          /* song seconds, while paused */
  let since = wall();                    /* wall seconds at the last transition */

  /* song seconds now. The only expression in this file where rate appears. */
  function seconds() {
    if (songTime) return songTime();
    return playing ? held + (wall() - since) * rate : held;
  }

  /* ---- the score clock: pure, and rate cannot reach it ------------------- */
  const mod = (x, m) => ((x % m) + m) % m;   /* music has no negative beat */

  function positionAt(t) {
    const b = (t - first) / barSec;
    return {
      bar: Math.floor(b) + 1,
      beat: +(mod(b, 1) * bpb + 1).toFixed(4),
      before_first_beat: t < first,
    };
  }
  /* the song second a given bar and beat lands on */
  function secondsAt(bar, beat) {
    return first + (bar - 1) * barSec + ((beat || 1) - 1) * beatSec;
  }
  /* beats laid on one line, so "which beat is this" is one division */
  const index = t => (t - first) / beatSec;
  const fromIndex = i => ({ bar: Math.floor(i / bpb) + 1, beat: (mod(i, bpb)) + 1 });

  /* ---- the two questions a container actually asks ----------------------- */
  function now() {
    const t = seconds();
    const i = index(t);
    const within = mod(i, 1);                       /* 0 exactly on the beat */
    return {
      playing, rate, seconds: +t.toFixed(4),
      position: positionAt(t),
      phase: +within.toFixed(4),
      to_next_beat_ms: Math.round((1 - within) * beatSec / rate * 1000),
    };
  }

  /* What is coming in the next stretch of the CALLER'S time. A container asks
     in its own milliseconds because that is what it will schedule against, and
     rate is applied once, here, at the boundary. */
  function next(lead_ms) {
    const t = seconds();
    const songAhead = (lead_ms / 1000) * rate;
    const out = [];
    for (let i = Math.ceil(index(t)); i < index(t + songAhead); i++) {
      const p = fromIndex(i);
      out.push({
        bar: p.bar, beat: p.beat,
        accent: p.beat === 1,
        in_ms: Math.round((secondsAt(p.bar, p.beat) - t) / rate * 1000),
      });
    }
    return out;
  }

  /* ---- transport. None of this is the score's business. ------------------ */
  /* When the container owns the clock these only record what it told us, so
     that `now()` can report playing/rate honestly. The container moves its own
     audio; we are not going to fight it for control of the playhead. */
  function play() { if (!playing) { if (!songTime) { held = seconds(); since = wall(); } playing = true; } return api; }
  function pause() { if (playing) { if (!songTime) held = seconds(); playing = false; } return api; }
  function seek(t) { if (!songTime) { held = t; since = wall(); } return api; }
  function setRate(r) { if (!songTime) { held = seconds(); since = wall(); } rate = r; return api; }

  const api = { now, next, play, pause, seek, positionAt, secondsAt,
                rate: r => (r === undefined ? rate : setRate(r)),
                seconds, score };
  return api;
}

if (typeof module !== "undefined" && module.exports) module.exports = { Session };
if (typeof window !== "undefined") window.LimelightSession = { Session };
