"use strict";
const fs = require("fs");
const path = require("path");
const R = require("./render.js");
const E = require("./engine.js");

const ROOT = path.join(__dirname, "..", "..");
const args = process.argv.slice(2);
const song = args[0];
if (!song) {
  console.error("usage: bake.js <song> [--cues <file>] [--rig <rig>] [--out <lights.json>]");
  process.exit(2);
}
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const cuesPath = opt("--cues", path.join(__dirname, "shows", song + ".cues.json"));
const scorePath = require(path.join(ROOT, "protocol", "fixture.js")).pick(song);
const cueFile = JSON.parse(fs.readFileSync(cuesPath, "utf8"));
const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
const rigName = opt("--rig", cueFile.rig || "arc4-head");
const out = opt("--out", path.join(require("os").tmpdir(), song + ".cuelights.json"));

const res = R.render(cueFile, score, rigName, { fps: +opt("--fps", 40) });
const grid = res.grid;
const perBar = grid.perBar;
const dur = (score.song && score.song.length_s) || res.frames.length / res.fps;
const bars = Math.max(1, Math.ceil((dur - (grid.beats[0] || 0)) / grid.barSeconds));

const beats = [], downbeats = [];
for (let b = 1; b <= bars; b++) {
  for (let bt = 1; bt <= perBar; bt++) {
    const s = +grid.secondsAt(b, bt).toFixed(3);
    beats.push(s);
    if (bt === 1) downbeats.push(s);
  }
}
const phases = (score.sections || []).map((s) => ({
  start: +(+s.start).toFixed(3), end: +(+s.end).toFixed(3), phase: s.label || null,
}));

const show = {
  rig: rigName,
  layout: res.rig.layoutFile,
  channels: res.rig.channels,
  fixtures: res.rig.fixtures.map((f) => ({ id: f.id, type: f.type, address: f.address, at: f.at })),
  style: "limelight-cuelist",
  fps: res.fps,
  duration: +dur.toFixed(3),
  tempo: (score.grid && score.grid.bpm) || 120,
  grid: {
    bpm: (score.grid && score.grid.bpm) || 120,
    beats_per_bar: perBar,
    first_beat_s: score.grid && score.grid.first_beat_s,
    first_bar: score.grid && score.grid.first_bar,
    bars,
    tempo: score.grid && score.grid.tempo,
  },
  source: (score.score || song) + ".wav",
  wav: (score.score || song) + ".wav",
  beats, downbeats,
  sections: phases.map((p) => p.start),
  phases,
  moments: (score.moments || []).map((m) => ({
    t: m.time_s || m.at_s || 0, bar: (m.at || {}).bar || 0,
    kind: m.type || "unknown", what: m.description || "", weight: m.intensity || 0,
  })),
  frames: res.frames,
  palette: cueFile.palette || {},
  accents: cueFile.accents || [],
  cuelist: res.cues.map((c) => ({
    id: c.id, at: c.at, t: +c._t.toFixed(3), fade: c.fade || 0,
    look: c.look, chase: c.chase || null, why: c.why || "",
  })),
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(show));
console.log(`baked ${res.frames.length} frames on ${rigName} from ${res.cues.length} cues -> ${out}`);
