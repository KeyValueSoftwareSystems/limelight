/* A 20-bar raw pipeline score, numbered from bar 0 the way the pipeline writes
   it, carrying every finer field the lights reader listens to: phrases (the
   subsections), weighted moments (an entrance, a hook, a pause), the five
   texture lanes, the four stem lanes and per-bar chords with a key.
   Shared by the musical / arranger / frame tests; `format()` of it is the hub's
   format_v1 view of the same song. */
"use strict";
const stems = (d, b, v, o) => ({
  drums: { is: d ? "full" : "none", level: d }, bass: { is: b ? "full" : "none", level: b },
  vocals: { is: v ? "some" : "none", level: v }, other: { is: o ? "full" : "none", level: o } });
const rep = (v, n) => Array.from({ length: n }, () => v);

const RAW = {
  score: "mini", version: 1,
  grid: { bpm: 120, first_beat_s: 1.0, beats_per_bar: 4, bars: 20, first_bar: 0, last_bar: 19 },
  key: { root: "A", scale: "minor", confidence: 0.8 },
  chords: { root: "A", scale: "minor", confidence: 0.6, changes_per_beat: 0.05 },
  parts: [
    { from_bar: 0, to_bar: 3, role: "intro", nth: 1, like: "A", returns: false, rise: 0.0, stems: stems(0, 0, 0, 0.7), playing: ["other"] },
    { from_bar: 4, to_bar: 15, role: "drop", nth: 1, like: "B", returns: false, rise: 0.05, stems: stems(0.9, 0.9, 0, 0.8), playing: ["drums", "bass", "other"] },
    { from_bar: 16, to_bar: 19, role: "outro", nth: 1, like: "C", returns: false, rise: -0.3, stems: stems(0, 0.3, 0, 0.4), playing: ["bass", "other"] },
  ],
  phrases: [
    { from_bar: 0, to_bar: 3, in: "intro", in_nth: 1, doing: "establishing", also: [], sure: 0.9, says: "chords join", energy: 0.1, rise: 0.0, playing: ["other"], moments: 0, has_break: false },
    { from_bar: 4, to_bar: 7, in: "drop", in_nth: 1, doing: "expanding", also: ["peaking"], sure: 0.9, says: "drums and bass join", energy: 0.9, rise: 0.0, playing: ["drums", "bass", "other"], moments: 1, has_break: false },
    { from_bar: 8, to_bar: 11, in: "drop", in_nth: 1, doing: "easing", also: [], sure: 0.8, says: "a bar out, then back", energy: 0.8, rise: -0.1, playing: ["drums", "bass", "other"], moments: 1, has_break: true },
    { from_bar: 12, to_bar: 15, in: "drop", in_nth: 1, doing: "peaking", also: [], sure: 0.8, says: "drums and bass and chords holding", energy: 0.95, rise: 0.02, playing: ["drums", "bass", "other"], moments: 0, has_break: false },
    { from_bar: 16, to_bar: 19, in: "outro", in_nth: 1, doing: "thinning", also: ["closing"], sure: 0.9, says: "drums drop out", energy: 0.1, rise: -0.2, playing: ["bass"], moments: 0, has_break: false },
  ],
  moments: [
    { bar: 4, beat: 1, is: "entrance", what: "drums", sure: 1.0, weight: 0.97 },
    { bar: 6, beat: 1, is: "hook", what: "the riff", sure: 0.5, for_beats: 8, weight: 0.7 },
    { bar: 8, beat: 3, is: "pause", what: "everything but bass", sure: 0.8, for_beats: 4, back_at: 9, still: ["bass"], weight: 0.5 },
  ],
  bars: {
    intensity: [...rep(0.1, 4), ...rep(0.9, 12), ...rep(0.1, 4)],
    width: [...rep(0.8, 4), ...rep(0.3, 12), ...rep(0.6, 4)],
    air: [...rep(0.5, 4), ...rep(0.7, 12), ...rep(0.4, 4)],
    pump: [...rep(0.3, 4), ...rep(0.6, 12), ...rep(0.3, 4)],
    pace: [...rep(0.2, 4), ...rep(1.5, 12), ...rep(0.1, 4)],
    brightness: [...rep(0.9, 4), ...rep(0.95, 12), ...rep(0.5, 3), null],
    chord: ["Am", "Am", "F", "F", "Am", "C", "Am", "C", "Am", "C", "G", "G", "Am", "C", "Am", "C", "Am", "Am", "F", null],
    chord_sure: [...rep(0.8, 19), 0],
    drums: [...rep(0.05, 4), 0.9, 0.9, 0.9, 0.9, 0.9, 0.1, 0.9, 0.9, ...rep(0.9, 4), ...rep(0.05, 4)],
    bass: [...rep(0.1, 4), ...rep(0.9, 12), ...rep(0.3, 4)],
    vocals: rep(0.0, 20),
    other: [...rep(0.7, 4), ...rep(0.8, 12), ...rep(0.4, 4)],
  },
  phrase_grid: { every_bars: 4, from_bar: 0, boundaries_on_grid: true },
};

module.exports = { RAW: () => JSON.parse(JSON.stringify(RAW)) };
