"use strict";
/* Render ONE enumeration sequence to the bridge's tick format, so a single effect
   can be shown on the rig for review (not a whole baked show).

     node readers/lights/preview.js <seq_id> [bpm] [bars] [out.json]
                                   [--layout FILE] [--palette FILE] [--lights FILE]

   Reuses frame.js + the palette; the plan is a single assignment covering every
   bar, with bold dynamics so the effect reads clearly. bridge.py plays the output. */
const fs = require("fs"), path = require("path");
const { frame } = require("./frame.js");
const argv = process.argv.slice(2);
const rig = require("./layouts.js").fromArgs(argv);
const layout = rig.layout, palette = rig.palette;

const seqs = Array.isArray(palette) ? palette : (palette.sequences || palette);
const library = Object.fromEntries(seqs.map(s => [s.id, s]));

const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const seqId = pos[0];
const bpm = +(pos[1] || 120);
const bars = +(pos[2] || 8);
const fps = 40;
/* beside the repo, like bake.js: the old default was an absolute path that
   existed on exactly one laptop. */
const out = pos[3] || path.join(
  process.env.SCRATCH || path.join(__dirname, "..", "..", "work", "shows"),
  "preview.frames.json");

const seq = library[seqId];
if (!seq) { console.error("no such sequence: " + seqId); process.exit(2); }

const occ = seq.occupies || (seq.gesture && seq.gesture.group === "head" ? ["head:move"] : []);
const isHead = occ.some(o => String(o).startsWith("head:")) ||
               (seq.gesture && seq.gesture.group === "head");
const bpb = 4, barSec = bpb * 60 / bpm, dur = bars * barSec;

/* Render each sequence in its intended character, not a forced hard hit:
   a hold is steady (floor == peak, so parLevel does not move); other ambient
   looks breathe gently; accents/heroes/hits punch on the beat. */
const boldness = seq.boldness || "accent";
let params;
if (/^hold_/.test(seqId)) {
  params = { floor: 0.6, peak: 0.6, mode: "breathe", motion: 0.35 };   // steady wash
} else if (boldness === "ambient") {
  params = { floor: 0.25, peak: 0.7, mode: "breathe", motion: 0.4 };   // gentle swell
} else {
  params = { floor: 0.12, peak: 1.0, mode: "hit", motion: 0.85 };      // punchy accent
}
Object.assign(params, { rate: 1, hue: 0.5, headDim: 0.9, intensity: 1.0 });

const plan = {
  grid: { beats_per_bar: bpb },
  contexts: ["drop"],
  assignments: [{
    from: { bar: 1, beat: 1 }, to: { bar: bars + 1, beat: 1 },
    seq_id: seqId, layer: isHead ? "head" : "par", priority: 0,
    params, occupies: occ,
  }],
};

const ticks = [];
for (let t = 0; t < dur; t += 1 / fps) {
  const B = t / barSec * bpb;
  const bar = Math.floor(B / bpb) + 1, beat = (B % bpb) + 1;
  const F = frame({ bar, beat }, plan, { layout, library });
  ticks.push({ t: +t.toFixed(3), bar, beat: +beat.toFixed(3), fixtures: F.fixtures });
}

/* --lights: emit a .lights.json through the DRIVERS (so the head's aim window
   applies) with the same head-hold/slew as bake.js, for the panel to play. This is
   the path that carries limelight-7d's aim fix; the default tick output goes through
   bridge.py/rig.py which does NOT aim-map. wire.js is that rule set, shared with
   bake.js -- this file used to keep its own copy of it, hardcoded to 41 channels
   and to the first head, which truncated any rig bigger than arc4-head. */
const lightsFlag = argv.indexOf("--lights");
if (lightsFlag >= 0) {
  const lightsOut = argv[lightsFlag + 1];
  const frames = require("./wire.js").toLightsFrames(ticks, layout);
  fs.writeFileSync(lightsOut, JSON.stringify({
    rig: rig.rig, style: "limelight", fps, duration: +dur.toFixed(3), tempo: bpm,
    source: "preview.wav", wav: "preview.wav",
    beats: [], downbeats: [], sections: [], phases: [], frames,
  }));
  console.log(`preview ${seqId} -> ${lightsOut} (${frames.length} lights frames via drivers/aim, ${isHead ? "head" : "par"})`);
  process.exit(0);
}

fs.writeFileSync(out, JSON.stringify({
  score: "preview:" + seqId, seed: 0, fps, from: 0, to: +dur.toFixed(3),
  duration: +dur.toFixed(3), beats: [], downbeats: [], phases: [],
  fixtures: (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, address: f.address, universe: f.universe })),
  ticks,
}));
console.log(`preview ${seqId}: ${ticks.length} ticks (${bars} bars @ ${bpm} bpm, ${isHead ? "head" : "par"}) -> ${out}`);
