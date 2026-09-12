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

/* --lights: emit the other agent's .lights.json (41-ch DMX frames), so their copied
   server/transport/audio_out play OUR show. Mapping goes through OUR drivers (same
   channel truth as rig.py); gamma 1.6 on the intensity channels; pan/tilt slew-limited. */
const lightsOut = opt("--lights", null);
if (lightsOut) {
  const drivers = require("./drivers/index.js");
  const W = 41, addrOf = {};
  for (const f of layout.fixtures) addrOf[f.id] = f.address;
  const gammaIdx = new Set();
  for (const f of layout.fixtures) {
    if (f.type === "par7") { const a = f.address; gammaIdx.add(a); gammaIdx.add(a + 1); gammaIdx.add(a + 2); }
    if (f.type === "head13") gammaIdx.add(f.address + 4);   // head dimmer channel
  }
  const gamma = v => Math.round(255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, 1.6));
  const frames = ticks.map(tk => {
    const f = new Array(W).fill(0);
    for (const fx of tk.fixtures) {
      const slice = drivers.forType(fx.type).render(fx.intent || {});
      const base = addrOf[fx.id] - 1;
      for (let k = 0; k < slice.length && base + k < W; k++) f[base + k] = slice[k];
    }
    for (const idx of gammaIdx) f[idx] = gamma(f[idx] || 0);
    return f;
  });
  const head = layout.fixtures.find(f => f.type === "head13");
  if (head) { const pi = head.address - 1, ti = head.address + 1; let lp = 169, lt = 127;
    for (const f of frames) {
      lp += Math.max(-7, Math.min(7, f[pi] - lp)); f[pi] = lp;
      lt += Math.max(-7, Math.min(7, f[ti] - lt)); f[ti] = lt;
    } }
  fs.writeFileSync(lightsOut, JSON.stringify({
    rig: "arc4-head", style: "limelight", fps, duration, tempo: score.grid.bpm,
    source: (score.score || "song") + ".wav", wav: (score.score || "song") + ".wav",
    beats, downbeats, sections: phases.map(x => x.start), phases, frames,
  }));
  console.log(`baked ${frames.length} lights frames (41ch @ ${fps}fps, seed ${seed}) -> ${lightsOut}`);
  process.exit(0);
}

/* Default beside the repo, not into one person's scratchpad. The previous
   default was an absolute path that existed on exactly one laptop, so anybody
   else who ran this wrote into a directory that was not there. */
const out = opt("--out", path.join(
  process.env.SCRATCH || path.join(__dirname, "..", "..", "work", "shows"),
  (score.score || "song") + ".frames.json"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  score: score.score, seed, fps, from, to: +to.toFixed(3), count: ticks.length, duration, beats, downbeats, phases,
  fixtures: (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, address: f.address, universe: f.universe })),
  ticks,
}));
console.log(`baked ${ticks.length} ticks  (${from}..${(+to).toFixed(1)}s @ ${fps}fps, seed ${seed})  -> ${out}`);
