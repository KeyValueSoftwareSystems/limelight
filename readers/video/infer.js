// What the brief did not say, decided from the music and the footage.
//
// A brief is the words a person says. They will not always say all of them, and
// the ones they leave out must not fall back to a constant: `PACE.measured`
// when nobody wrote a pace is a DEFAULT, and a default is the system declining
// to think. If the writer says nothing about pace, the right pace is a question
// with an answer in the recording, and answering it is the difference between a
// config expander and something worth calling intelligence.
//
// Two rules this file obeys.
//
//   An explicit word always wins. Inference fills silence, it never overrides.
//
//   Every choice is recorded with what it was made from. AGENTS.md rule 2 is
//   about not writing a guess where a measurement should be; this is not the
//   map, but the same logic applies -- an inferred pace that cannot say why it
//   is fast is indistinguishable from one somebody typed at random, and later
//   nobody can tell which happened.
"use strict";

// Nearest preset to a rate the material actually offers. Choosing the NEAREST
// rather than thresholding means the preset table stays the only place taste
// lives: change what "fast" means and this follows, with no numbers to update.
function nearest(table, key, target) {
  let best = null;
  for (const name of Object.keys(table)) {
    const d = Math.abs(table[name][key] - target);
    if (!best || d < best.d) best = { name: name, d: d, at: table[name][key] };
  }
  return best;
}

function pct(xs, q) {
  const v = xs.filter(function (x) { return typeof x === "number" && isFinite(x); })
              .sort(function (a, b) { return a - b; });
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
}

function median(xs) {
  const v = xs.filter(function (x) { return typeof x === "number" && isFinite(x); })
              .sort(function (a, b) { return a - b; });
  return v.length ? v[Math.floor(v.length / 2)] : null;
}

// How often this song offers a bar. One cut per bar is the rate a record hands
// an editor for free -- it is not a taste, it is the grid -- so it is the
// honest thing to compare the pace presets against.
function barsPerMinute(map) {
  const g = map.grid || {};
  if (g.bpm && g.beats_per_bar) return g.bpm / g.beats_per_bar;
  const db = map.downbeats || [];
  if (db.length > 4) {
    const gaps = [];
    for (let i = 1; i < db.length; i++) gaps.push(db[i] - db[i - 1]);
    const m = median(gaps);
    if (m > 0) return 60 / m;
  }
  return null;
}

// How finely this record divides its bar, from the drums alone.
//
// Bar rate by itself is a metronome reading: it says a 126 bpm dance track and
// a 126 bpm ballad want the same cutting, which is false. What separates them
// is how much the kit is doing.
//
// Drums only. Counting every accent made a lofi track read as busier than a
// festival record, because lofi is full of hi-hats and hats are not a reason to
// cut. The `of` labels are the map's own guess at which drum -- it says so --
// so this is a hint taken as a hint: if a map has no drum-labelled accents at
// all, this returns null and the caller falls back to the grid rather than
// reading 0 as "sparse". `synth/maps/model/levels` is exactly that map, and
// treating its silence as sparseness would be inventing a measurement.
const DRUM = { kick: 1, snare: 1, tom: 1 };

function drumsPerBar(map) {
  const db = map.downbeats || [];
  const ev = ((map.accents || {}).events) || [];
  if (db.length < 8 || !ev.length) return null;
  let n = 0, labelled = 0;
  for (const a of ev) {
    if (a.of === undefined || a.of === null) continue;
    labelled += 1;
    if (DRUM[a.of]) n += 1;
  }
  if (!labelled || n < 8) return null;
  return n / (db.length - 1);
}

function momentsPerMinute(map) {
  const mo = map.moments || [];
  // The map says `length`; the IR says `length_s`. Reading only one of them is
  // how this silently returned null and the effects word was never decided.
  const song = map.song || {};
  const len = song.length_s || song.length ||
              (map.beats && map.beats.length ? map.beats[map.beats.length - 1] : null);
  if (!mo.length || !len) return null;
  return mo.length / (len / 60);
}

function infer(brief, map, index, tables) {
  const notes = {};

  if (brief.pace === undefined) {
    const bpm = barsPerMinute(map);
    if (bpm) {
      // The grid says how often a bar comes round. The drums say whether this
      // record supports cutting faster than that. Anchored at 8 hits a bar --
      // two to a beat, the eighth-note texture most produced music sits on --
      // so the number means something musical rather than something fitted to
      // whatever songs happened to be on this disk. Square root because the
      // difference between 4 and 8 hits a bar matters far more than between 16
      // and 20.
      const dpb = drumsPerBar(map);
      const sub = dpb === null ? 1
        : Math.max(0.6, Math.min(1.5, Math.sqrt(dpb / 8)));
      const target = bpm * sub;
      const p = nearest(tables.PACE, "cuts_per_minute", target);
      brief.pace = p.name;
      notes.pace = {
        chose: p.name,
        because: dpb === null
          ? "this song offers " + bpm.toFixed(1) + " bars a minute and its " +
            "accents carry no drum labels, so the grid decides alone; " +
            p.name + " asks for " + p.at
          : "this song offers " + bpm.toFixed(1) + " bars a minute and its kit " +
            "plays " + dpb.toFixed(1) + " hits a bar against the eighth-note " +
            "anchor of 8, so it supports " + target.toFixed(1) + " cuts a " +
            "minute; " + p.name + " asks for " + p.at,
        from: dpb === null ? ["grid.bpm"] : ["grid.bpm", "accents.events"]
      };
    }
  }

  if (brief.effects === undefined) {
    const mpm = momentsPerMinute(map);
    if (mpm !== null) {
      const e = nearest(tables.EFFECTS, "effects_per_minute", mpm);
      brief.effects = e.name;
      notes.effects = {
        chose: e.name,
        because: "an effect attaches to a moment, so the song cannot carry more " +
                 "of them than it has moments. This one has " + mpm.toFixed(1) +
                 " a minute; " + e.name + " spends " + e.at,
        from: ["moments"]
      };
    }
  }

  const shots = ((index || {}).clips || []).reduce(function (acc, c) {
    return acc.concat(c.shots || []); }, []);

  if (brief.look === undefined && shots.length) {
    const b = median(shots.map(function (s) { return s.brightness; }));
    if (b !== null) {
      let pick = null;
      for (const name of Object.keys(tables.LOOK)) {
        const r = tables.LOOK[name].brightness;
        const mid = (r[0] + r[1]) / 2;
        const inside = b >= r[0] && b <= r[1];
        const d = Math.abs(mid - b) - (inside ? 1 : 0);
        if (!pick || d < pick.d) pick = { name: name, d: d };
      }
      brief.look = pick.name;
      notes.look = {
        chose: pick.name,
        because: "the footage has a median brightness of " + b.toFixed(2) +
                 "; asking for a look this pile cannot supply would just make " +
                 "the chooser reject everything it has",
        from: ["assets INDEX brightness"]
      };
    }
  }

  if (brief.motion === undefined && shots.length) {
    // The 75th percentile, not the median.
    //
    // A pool is mostly ordinary shots with a tail of moving ones, so its median
    // sits near the bottom of its own range and EVERY pool answered `still` --
    // a thermometer in a room that is always the same temperature. The question
    // is not "what does a typical shot do", it is "what movement can this pile
    // supply", and that is a property of the tail.
    const m = pct(shots.map(function (s) { return s.camera_motion_px_s; }), 0.75);
    if (m !== null) {
      let pick = null;
      for (const name of Object.keys(tables.MOTION)) {
        const r = tables.MOTION[name].camera_motion_px_s;
        const inside = m >= r[0] && m <= r[1];
        const d = Math.abs((r[0] + r[1]) / 2 - m) - (inside ? 1e6 : 0);
        if (!pick || d < pick.d) pick = { name: name, d: d };
      }
      brief.motion = pick.name;
      notes.motion = {
        chose: pick.name,
        because: "a quarter of this footage moves at " + m.toFixed(0) +
                 " px/s of camera motion or more, which is what the pile can " +
                 "supply when the edit asks for movement",
        from: ["assets INDEX camera_motion_px_s"]
      };
    }
  }

  // The shape of the piece. An ad decelerates into its payoff -- the 5C spot
  // runs its first half at 391 px/s of subject motion and its last at 177 --
  // and nothing in this system knew that, so every output was a montage that
  // landed on the beat. `settles` is the measured default. It is only a default
  // in the sense that every other inference here is: the writer can say
  // `builds` or `swells` or `flat` and be obeyed.
  if (brief.story === undefined) {
    brief.story = "settles";
    notes.story = {
      chose: "settles",
      because: "a film decelerates into the thing it was for. Measured on the " +
               "reference this lane is judged against: first half 1.96 s shots " +
               "at 391 px/s, last half 2.88 s at 177 -- 47% longer, 55% stiller",
      from: ["assets/stock/apple5c/INDEX.json"]
    };
  }

  // Where the subject shows up. A film about a thing ends on that thing; that
  // is not a style, it is what makes it a film about a thing rather than a
  // montage that happens to contain one.
  if (brief.arrival === undefined && brief.subject_word) {
    brief.arrival = "late";
    notes.arrival = {
      chose: "late",
      because: "the film is about " + JSON.stringify(brief.subject_word) +
               ", so it opens elsewhere, arrives at it, and ends on it",
      from: ["assets/match.py", "SEMANTIC.json"]
    };
  }

  // Shape. Not a taste at all: delivering a 9:16 reel cut from 16:9 footage
  // means throwing away two thirds of every frame, and the writer of a one-line
  // brief never said they wanted that. The footage's own shape is the answer
  // until somebody asks for a different one.
  if (brief.format === undefined) {
    const clips = (index || {}).clips || [];
    const ar = median(clips.map(function (c) {
      return (c.width && c.height) ? c.width / c.height : null; }));
    if (ar) {
      let pick = null;
      for (const name of Object.keys(tables.FORMAT)) {
        const f = tables.FORMAT[name];
        const d = Math.abs(f.width / f.height - ar);
        if (!pick || d < pick.d) pick = { name: name, d: d };
      }
      brief.format = pick.name;
      notes.format = {
        chose: pick.name,
        because: "the footage is " + ar.toFixed(2) + ":1, and cropping it to a " +
                 "shape nobody asked for throws away picture the editor paid for",
        from: ["assets INDEX width/height"]
      };
    }
  }

  return notes;
}

module.exports = { infer: infer, barsPerMinute: barsPerMinute,
                   momentsPerMinute: momentsPerMinute };
