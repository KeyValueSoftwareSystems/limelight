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
  /* adapt() may replace this with our shape, so it is not const */
  const g = (score && score.grid) || {};
  const bpm = g.bpm, bpb = g.beats_per_bar || 4, first = g.first_beat_s || 0;
  if (!bpm) throw new Error("a score needs grid.bpm");

  const beatSec = 60 / bpm;              /* song seconds per beat -- never scaled */
  const barSec = beatSec * bpb;
  /* Which number the first bar carries. Some songs open on a pickup and start
     at 0; others start at 1. Nothing used to say which, so this library assumed
     1 and shifted anything that said otherwise -- which is a one-bar error on
     four songs in seventeen, and a one-bar error is a show that lights a beat
     early all night without explaining itself. The score states it now, so we
     read it and renumber nothing: bar 33 here is bar 33 in the score, in the
     pipeline, and in any conversation about the song. */
  const firstBar = (g.first_bar !== undefined && g.first_bar !== null) ? g.first_bar : 1;

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

  /* Snap a beat count that is a hair off a boundary back onto it. Bar 61 of a
     127.999 bpm song comes back out of `secondsAt` as 60.99999999999999, and a
     bare Math.floor then answers bar 60 -- a whole bar early, for a song that
     was never wrong. The tolerance is 1e-9 of a beat, under a microsecond, so
     it can only ever absorb arithmetic error and never a real measurement. */
  const snap = x => Math.abs(x - Math.round(x)) < 1e-9 ? Math.round(x) : x;

  function positionAt(t) {
    const i = snap((t - first) / beatSec);
    return {
      bar: firstBar + Math.floor(i / bpb),
      beat: +(mod(i, bpb) + 1).toFixed(4),
      before_first_beat: t < first,
    };
  }
  /* the song second a given bar and beat lands on */
  function secondsAt(bar, beat) {
    return first + (bar - firstBar) * barSec + ((beat || 1) - 1) * beatSec;
  }
  /* beats laid on one line, so "which beat is this" is one division */
  const index = t => snap((t - first) / beatSec);
  const fromIndex = i => ({ bar: firstBar + Math.floor(i / bpb), beat: (mod(i, bpb)) + 1 });

  /* ---- sections, in layers ------------------------------------------------
     A song is several structures at once, and flattening them into one list
     loses the part that matters. `form` is a partition, so exactly one span
     covers any bar. `energy` and `presence` are sparse and freely overlap it
     and each other -- a build crosses a section boundary because that is what
     a build does, and the drums and the voice are both present for most of a
     record. `phrase` is a rule rather than a list, for the same reason beats
     are a rule. */
  /* Two score shapes exist in this repo and a reader should not care which it
     was handed. The pipeline writes `parts`, `bars.intensity` and 0-based bar
     numbers; this file was written against `layers`, `energy` and 1-based ones.
     Rather than keep two formats in step -- which is how the two scores for
     Levels ended up 9.89 beats apart without anything failing -- the pipeline's
     shape is read directly and adapted here, once, at the edge.
     Bar numbering is the dangerous half: theirs starts at 0, ours at 1, and an
     off-by-one bar is a show that lights a beat early all night. */
  function adapt(sc) {
    if (!sc || sc.layers || !sc.parts) return sc;          /* already our shape */
    const out = Object.assign({}, sc);
    out.layers = {
      form: { kind: "partition",
        note: "from `parts`. Bars are not renumbered -- grid.first_bar says where "
              + "they start. `to_bar` is inclusive, so the half-open end is +1.",
        spans: sc.parts.map(p => ({
          from: { bar: p.from_bar, beat: 1 },
          to:   { bar: p.to_bar + 1, beat: 1 },
          /* role is the bare word now and `nth` carries the occurrence. Matching
             on the role string used to miss every drop after the first, because
             the string was "drop 2". Keep them apart. */
          name: p.role, nth: p.nth, like: p.like, returns: p.returns,
          feels: p.feels, fullness: p.fullness })) },
    };
    const inten = (sc.bars && sc.bars.intensity) || null;
    if (inten) out.energy = { per: "bar",
                              from_bar: (sc.grid && sc.grid.first_bar !== undefined)
                                        ? sc.grid.first_bar : 1,
                              values: inten, note: "from `bars.intensity`" };
    if (sc.releases) out.moments = sc.releases.map(r => ({
      at: positionOf(sc, r.at_s), kind: "drop", size: r.size }));
    return out;
  }
  function positionOf(sc, t) {
    const g = sc.grid, n = g.beats_per_bar || 4, barS = (60 / g.bpm) * n;
    const fb = (g.first_bar !== undefined && g.first_bar !== null) ? g.first_bar : 1;
    const b = (t - g.first_beat_s) / barS;
    return { bar: fb + Math.floor(b), beat: +(((b % 1) + 1) % 1 * n + 1).toFixed(3) };
  }
  score = adapt(score);
  const layers = (score && score.layers) || {};
  const at_ = q => (q.bar - firstBar) * bpb + ((q.beat || 1) - 1);  /* beats, one line */
  const covers = (sp, x) => x >= at_(sp.from) && x < at_(sp.to);

  function sectionsAt(pos) {
    const x = at_(pos), found = {};
    for (const name of Object.keys(layers)) {
      const L = layers[name];
      if (L.kind === "rule") {
        const n = L.every_bars || 8, from = L.from_bar || 1;
        /* Before the anchor there is no phrase to be in -- the intro is a
           pickup, not phrase zero. Say nothing rather than a number. */
        if (pos.bar < from) { found[name] = null; continue; }
        const i = Math.floor((pos.bar - from) / n);
        found[name] = { index: i + 1,
          from: { bar: from + i * n, beat: 1 },
          to: { bar: from + (i + 1) * n, beat: 1 },
          through: +((((pos.bar - from) % n) + (pos.beat - 1) / bpb) / n).toFixed(4) };
        continue;
      }
      const hit = (L.spans || []).filter(sp => covers(sp, x));
      /* a partition can only be in one place at a time; everything else is a
         list, because overlap is the point of having layers at all */
      found[name] = L.kind === "partition" ? (hit[0] || null) : hit;
    }
    return found;
  }

  /* How long the thing you are inside has left, in the caller's milliseconds.
     This is what lets an application build toward a change rather than react
     to one, which is the whole reason any of this is worth doing. */
  function until(layer, pos) {
    const q = pos || positionAt(seconds());
    const f = sectionsAt(q)[layer];
    const sp = Array.isArray(f) ? f[0] : f;
    if (!sp || !sp.to) return null;
    const leftBeats = at_(sp.to) - at_(q);
    return { name: sp.name || null, ends_at: sp.to,
             bars: +(leftBeats / bpb).toFixed(3),
             in_ms: Math.round(leftBeats * beatSec / rate * 1000) };
  }

  /* ---- energy: one number per bar, interpolated here ---------------------- */
  const EN = score && score.energy;
  function energyAt(pos) {
    if (!EN || !EN.values || !EN.values.length) return null;
    const x = (pos.bar - (EN.from_bar || 1)) + (pos.beat - 1) / bpb;
    if (x <= 0) return EN.values[0];
    if (x >= EN.values.length - 1) return EN.values[EN.values.length - 1];
    const i = Math.floor(x), u = x - i;
    return +(EN.values[i] + (EN.values[i + 1] - EN.values[i]) * u).toFixed(4);
  }

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
      energy: energyAt(positionAt(t)),
      sections: sectionsAt(positionAt(t)),
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

    const p0 = positionAt(t), p1 = positionAt(t + songAhead);
    const ms = q => Math.round((secondsAt(q.bar, q.beat) - t) / rate * 1000);
    const inside = q => at_(q) >= at_(p0) && at_(q) < at_(p1);

    /* Boundaries matter as much as beats. Anything with lead time needs to know
       a section ends in 900 ms, not to discover it once it already has. */
    for (const name of Object.keys(layers)) {
      const L = layers[name];
      if (L.kind === "rule") continue;
      for (const sp of (L.spans || [])) {
        if (inside(sp.from)) out.push({ what: name + " starts", layer: name,
          name: sp.name || null, bar: sp.from.bar, beat: sp.from.beat, in_ms: ms(sp.from) });
        if (inside(sp.to)) out.push({ what: name + " ends", layer: name,
          name: sp.name || null, bar: sp.to.bar, beat: sp.to.beat, in_ms: ms(sp.to) });
      }
    }
    for (const mo of (score.moments || [])) {
      if (inside(mo.at)) out.push({ what: mo.kind, layer: "moment",
        name: mo.kind, bar: mo.at.bar, beat: mo.at.beat, in_ms: ms(mo.at) });
    }
    return out.sort((x, y) => x.in_ms - y.in_ms);
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
                sectionsAt, until, layers, energyAt,
                rate: r => (r === undefined ? rate : setRate(r)),
                seconds, score };
  return api;
}

if (typeof module !== "undefined" && module.exports) module.exports = { Session };
if (typeof window !== "undefined") window.LimelightSession = { Session };
