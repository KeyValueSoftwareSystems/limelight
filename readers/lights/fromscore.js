"use strict";
const fs = require("fs");
const path = require("path");

/* The built score when the pipeline has run here, else the committed fixture.
   Scores are built rather than committed, so a bare path into scores/ makes the
   suite unrunnable on a fresh clone -- which is how four suites stopped running
   without anything reporting a fault. */
function scoreFile() {
  const candidates = [
    path.join(__dirname, "..", "..", "scores", "levels.score"),        // built by the pipeline here
    path.join(__dirname, "panel", "scores", "levels.score"),           // imported by the panel
  ];
  return candidates.find(c => fs.existsSync(c)) || candidates[candidates.length - 1];
}


/* The arranger wants sections with bar/beat edges and a per-bar energy curve.
   The pipeline emits parts and bars.intensity. One place converts, so the
   reader and its tests read the same shape from the same committed score. */
function shape(raw) {
  /* Sections that already carry {from, to} in bar/beat form: nothing to do. */
  if (Array.isArray(raw.sections) && raw.sections.length &&
      raw.sections[0].from && typeof raw.sections[0].from.bar === "number") return raw;

  /* Sections in {start, end} seconds — convert to {from, to} bar/beat using
     the grid.  The pipeline's newer scores emit this shape. */
  if (Array.isArray(raw.sections) && raw.sections.length &&
      typeof raw.sections[0].start === "number" && raw.grid && raw.grid.bpm) {
    const g = raw.grid, bpb = g.beats_per_bar || 4;
    const tempo = (g.tempo && g.tempo.length) ? g.tempo
      : [{ from_beat: 0, at_s: g.first_beat_s || 0, bpm: g.bpm }];
    const sorted = tempo.slice().sort((a, b) => a.from_beat - b.from_beat);
    const beatAtSec = t => {
      let seg = sorted[0];
      for (const c of sorted) { if (c.at_s <= t) seg = c; else break; }
      return seg.from_beat + (t - seg.at_s) * (seg.bpm / 60);
    };
    const barBeat = t => {
      const beat = beatAtSec(t);
      const bar = Math.floor(beat / bpb) + 1;
      return { bar, beat: Math.round(((beat % bpb) + bpb) % bpb) + 1 };
    };
    return {
      ...raw,
      sections: raw.sections.map(s => ({
        from: barBeat(s.start),
        to: barBeat(s.end),
        name: s.label || s.name,
        repeat: s.repeat,
      })),
      energy: Array.isArray(raw.energy) ? raw.energy
        : (raw.bars && raw.bars.intensity) || [],
    };
  }

  if (raw.layers && raw.layers.form && Array.isArray(raw.layers.form.spans)) {
    return {
      ...raw,
      sections: raw.layers.form.spans.map(sp => ({
        from: sp.from, to: sp.to, name: sp.name, repeat: sp.repeat,
      })),
    };
  }

  const parts = raw.parts || [];
  return {
    ...raw,   // keep grid (with first_bar), beats, parts (arranger.riseOf reads them), ...
    sections: parts.map(p => ({
      from: { bar: p.from_bar, beat: 1 },
      to: { bar: p.to_bar + 1, beat: 1 },   // to_bar is inclusive; sections are half-open
      name: p.role,
      nth: p.nth,                            // tells repeated drops apart
      repeat: p.returns ? p.like : undefined,
      like: p.like,
      feels: p.feels,
      playing: p.playing,
      fullness: p.fullness,
      rise: p.rise,
      stems: p.stems,                        // the arranger drives drum accents off these
    })),
    energy: Array.isArray(raw.energy) ? raw.energy
      : (raw.bars && raw.bars.intensity) || [],
  };
}

function load(file) {
  /* Default to the live score. A copy kept beside the protocol went stale
     the first time the pipeline changed, and the reader read the stale one.
     Scores are built rather than committed, so a bare path into scores/ made the
     suite unrunnable on a fresh clone. Look, in order, for the built score, the
     panel's imported copy, and the committed fixture beside the protocol. */
  const at = file || scoreFile();
  return shape(JSON.parse(fs.readFileSync(at, "utf8")));
}

module.exports = { shape, load };
