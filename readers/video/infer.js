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
      const p = nearest(tables.PACE, "cuts_per_minute", bpm);
      brief.pace = p.name;
      notes.pace = {
        chose: p.name,
        because: "this song offers " + bpm.toFixed(1) + " bars a minute and a " +
                 "cut a bar is the rate the grid hands over for nothing; " +
                 p.name + " asks for " + p.at + " a minute, the nearest of the " +
                 Object.keys(tables.PACE).length + " the vocabulary has",
        from: ["grid.bpm", "grid.beats_per_bar"]
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
    const m = median(shots.map(function (s) { return s.camera_motion_px_s; }));
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
        because: "the footage moves at a median of " + m.toFixed(0) +
                 " px/s of camera motion",
        from: ["assets INDEX camera_motion_px_s"]
      };
    }
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
