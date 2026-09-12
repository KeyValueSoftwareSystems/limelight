"use strict";
/* Bake a whole show to per-tick, per-fixture INTENTS, for the Python bridge to play.
   ---------------------------------------------------------------------------
   The reader (enumerate -> plan -> frame) is JS; the rig's drivers (rig.py/artnet.py)
   are Python. So we bake the show here into device-agnostic intents at a fixed frame
   rate, and the bridge maps intents -> DMX via rig.py and streams them. Baking (not a
   live socket) is the safest first-light path: the whole show is inspectable before a
   single packet goes to the fixtures.

     node readers/lights/bake.js [score.json] [seed] [--fps 40] [--from S] [--to S] [--out FILE]

   seconds->position uses the protocol clock (session.js), so it honours the grid. */
const fs = require("fs"), path = require("path");
const { enumerate } = require("./preflight.js");
const { plan } = require("./arranger.js");
const { frame } = require("./frame.js");
const { Session } = require("../../protocol/session.js");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const scoreFile = (args[0] && !args[0].startsWith("--")) ? args[0] : null;
const seed = +((args[1] && !args[1].startsWith("--")) ? args[1] : 1);
const fps = +opt("--fps", 40);

const score = require("./fromscore.js").load(scoreFile);
const layout = require("./arc4-head.layout.json");
const palette = require("./arc4-head.palette.json");
const library = Object.fromEntries(palette.map(s => [s.id, s]));

const en = enumerate(layout, { palette });
const p = plan(score, en, seed);
const S = Session(score, { now: () => 0 });
const dur = S.secondsAt((score.grid.bars || 120) + 1, 1);
const from = +opt("--from", 0), to = +opt("--to", dur);

/* session.js reads grid.first_bar and already numbers bars in the score's own
   scheme, so a score that declares it needs no shift here. Applying one on top
   put every section a bar late -- on levels the first drop moved from 21.735s
   to 23.609s. Scores that predate grid.first_bar still get the old correction. */
const barBase = (score.sections && score.sections.length)
  ? Math.min(...score.sections.map(s => s.from.bar)) : 1;
const told = score.grid && score.grid.first_bar !== undefined
  && score.grid.first_bar !== null;
const shift = (told && score.grid.first_bar === barBase) ? 0 : 1 - barBase;

const ticks = [];
for (let t = from; t < to; t += 1 / fps) {
  const pos = S.positionAt(t);
  const bar = pos.bar - shift;
  const F = frame({ bar, beat: pos.beat }, p, { layout, library });
  ticks.push({ t: +t.toFixed(3), bar, beat: +pos.beat.toFixed(3), fixtures: F.fixtures });
}

/* timeline metadata (seconds), for the control panel's timeline + phase bands */
const bpb = score.grid.beats_per_bar || 4;
const beats = [], downbeats = [];
for (let b = 1; b <= (score.grid.bars || 120); b++) for (let bt = 1; bt <= bpb; bt++) {
  const t = +S.secondsAt(b, bt).toFixed(3); beats.push(t); if (bt === 1) downbeats.push(t);
}
const secOf = sb => +S.secondsAt(sb + shift, 1).toFixed(3);
const phases = (score.sections || []).map((sec, i) =>
  ({ start: secOf(sec.from.bar), end: secOf(sec.to.bar), phase: p.contexts[i] }));
const duration = (score.song && score.song.length_s) || +to.toFixed(3);

/* the moments (seconds, exact bar/beat kept) and the looks (every sequence
   assignment, in seconds), so the panel can show where the show punctuates and
   where a section changes look inside itself */
const beatSec = 60 / score.grid.bpm;
const secAt = q => +S.secondsAt(q.bar + shift, q.beat || 1).toFixed(3);
const moments = require("./musical.js").momentsOf(score).map(m => ({
  t: secAt(m), bar: m.bar, beat: m.beat, kind: m.kind, what: m.what, weight: m.weight,
  ...(m.for_beats ? { end: +(secAt(m) + m.for_beats * beatSec).toFixed(3), for_beats: m.for_beats } : {}),
}));
const looks = p.assignments.filter(a => a.seq_id).map(a => ({
  start: secAt(a.from), end: secAt(a.to), bar: a.from.bar, to_bar: a.to.bar, seq_id: a.seq_id, layer: a.layer,
  section: a.section || null, context: a.context || null,
  ...(a.variation ? { variation: true, doing: a.doing || null } : {}),
}));

/* --lights: emit the other agent's .lights.json (41-ch DMX frames), so their copied
   server/transport/audio_out play OUR show. Mapping goes through OUR drivers (same
   channel truth as rig.py) via wire.js: gamma 1.6 on the intensity channels, the
   head's pose slew-limited as one 16-bit value and held when undriven. */
const lightsOut = opt("--lights", null);
if (lightsOut) {
  /* intents -> 41-ch frames through the drivers, with the display gamma and the
     head's 16-bit slew/hold, all in wire.js (shared with preview.js) */
  const frames = require("./wire.js").toLightsFrames(ticks, layout);
  fs.writeFileSync(lightsOut, JSON.stringify({
    rig: "arc4-head", style: "limelight", fps, duration, tempo: score.grid.bpm,
    source: (score.score || "song") + ".wav", wav: (score.score || "song") + ".wav",
    beats, downbeats, sections: phases.map(x => x.start), phases, moments, looks, frames,
  }));
  console.log(`baked ${frames.length} lights frames (41ch @ ${fps}fps, seed ${seed}) -> ${lightsOut}`);
  process.exit(0);
}

const out = opt("--out", path.join(
  process.env.SCRATCH || "/tmp/claude-1001/-home-alnas-Documents-Code-KeyCode-2026/49a4d46d-ce2c-4667-a443-9aef992651b0/scratchpad",
  (score.score || "song") + ".frames.json"));
fs.writeFileSync(out, JSON.stringify({
  score: score.score, seed, fps, from, to: +to.toFixed(3), count: ticks.length, duration, beats, downbeats, phases, moments, looks,
  fixtures: (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, address: f.address, universe: f.universe })),
  ticks,
}));
console.log(`baked ${ticks.length} ticks  (${from}..${(+to).toFixed(1)}s @ ${fps}fps, seed ${seed})  -> ${out}`);
