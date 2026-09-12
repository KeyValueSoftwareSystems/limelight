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
const scoreFile = (args[0] && !args[0].startsWith("--")) ? args[0] : path.join(__dirname, "levels.score.json");
const seed = +((args[1] && !args[1].startsWith("--")) ? args[1] : 1);
const fps = +opt("--fps", 40);

const score = JSON.parse(fs.readFileSync(scoreFile, "utf8"));
const layout = require("./arc4-head.layout.json");
const palette = require("./arc4-head.palette.json");
const library = Object.fromEntries(palette.map(s => [s.id, s]));

const en = enumerate(layout, { palette });
const p = plan(score, en, seed);
const S = Session(score, { now: () => 0 });
const dur = S.secondsAt((score.grid.bars || 120) + 1, 1);
const from = +opt("--from", 0), to = +opt("--to", dur);

/* session.js numbers the first bar as 1; a score may number it 0 (raga). Shift the
   clock's bar into the score's numbering so section boundaries land at the right
   wall time. */
const barBase = (score.sections && score.sections.length)
  ? Math.min(...score.sections.map(s => s.from.bar)) : 1;
const shift = 1 - barBase;

const ticks = [];
for (let t = from; t < to; t += 1 / fps) {
  const pos = S.positionAt(t);
  const bar = pos.bar - shift;
  const F = frame({ bar, beat: pos.beat }, p, { layout, library });
  ticks.push({ t: +t.toFixed(3), bar, beat: +pos.beat.toFixed(3), fixtures: F.fixtures });
}

const out = opt("--out", path.join(
  process.env.SCRATCH || "/tmp/claude-1001/-home-alnas-Documents-Code-KeyCode-2026/49a4d46d-ce2c-4667-a443-9aef992651b0/scratchpad",
  (score.score || "song") + ".frames.json"));
fs.writeFileSync(out, JSON.stringify({
  score: score.score, seed, fps, from, to: +to.toFixed(3), count: ticks.length,
  fixtures: (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, address: f.address, universe: f.universe })),
  ticks,
}));
console.log(`baked ${ticks.length} ticks  (${from}..${(+to).toFixed(1)}s @ ${fps}fps, seed ${seed})  -> ${out}`);
