"use strict";
/* Render ONE enumeration sequence to the bridge's tick format, so a single effect
   can be shown on the rig for review (not a whole baked show).

     node readers/lights/preview.js <seq_id> [bpm] [bars] [out.json]

   Reuses frame.js + the palette; the plan is a single assignment covering every
   bar, with bold dynamics so the effect reads clearly. bridge.py plays the output. */
const fs = require("fs"), path = require("path");
const { frame } = require("./frame.js");
const layout = require("./arc4-head.layout.json");
const palette = require("./arc4-head.palette.json");

const seqs = Array.isArray(palette) ? palette : (palette.sequences || palette);
const library = Object.fromEntries(seqs.map(s => [s.id, s]));

const seqId = process.argv[2];
const bpm = +(process.argv[3] || 120);
const bars = +(process.argv[4] || 8);
const fps = 40;
const out = process.argv[5] || path.join(
  process.env.SCRATCH || "/tmp/claude-1001/-home-alnas-Documents-Code-KeyCode-2026/49a4d46d-ce2c-4667-a443-9aef992651b0/scratchpad",
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

/* --lights: emit a 41-ch .lights.json through the DRIVERS (so the head's aim window
   applies) with the same head-hold/slew as bake.js, for the panel to play. This is
   the path that carries limelight-7d's aim fix; the default tick output goes through
   bridge.py/rig.py which does NOT aim-map. Mirrors bake.js --lights. */
const lightsFlag = process.argv.indexOf("--lights");
if (lightsFlag >= 0) {
  const lightsOut = process.argv[lightsFlag + 1];
  const drivers = require("./drivers/index.js");
  const W = 41, addrOf = {};
  for (const f of layout.fixtures) addrOf[f.id] = f.address;
  const gammaIdx = new Set();
  for (const f of layout.fixtures) {
    if (f.type === "par7") { const a = f.address; gammaIdx.add(a); gammaIdx.add(a + 1); gammaIdx.add(a + 2); }
    if (f.type === "head13") gammaIdx.add(f.address + 4);
  }
  const gamma = v => Math.round(255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, 1.6));
  const head = layout.fixtures.find(f => f.type === "head13");
  const driven = [];
  const frames = ticks.map(tk => {
    const f = new Array(W).fill(0);
    for (const fx of tk.fixtures) {
      const slice = drivers.forType(fx.type).render(fx.intent || {});
      const base = addrOf[fx.id] - 1;
      for (let k = 0; k < slice.length && base + k < W; k++) f[base + k] = slice[k];
      if (head && fx.id === head.id) driven.push({ pan: fx.intent && fx.intent.pan != null, tilt: fx.intent && fx.intent.tilt != null });
    }
    for (const idx of gammaIdx) f[idx] = gamma(f[idx] || 0);
    return f;
  });
  if (head) {
    const pi = head.address - 1, ti = head.address + 1; let lp = 169, lpf = 0, lt = 127, ltf = 0;
    frames.forEach((f, i) => {
      const d = driven[i] || { pan: false, tilt: false };
      if (d.pan) { lp += Math.max(-7, Math.min(7, f[pi] - lp)); lpf = f[pi + 1]; }
      f[pi] = lp; f[pi + 1] = lpf;
      if (d.tilt) { lt += Math.max(-7, Math.min(7, f[ti] - lt)); ltf = f[ti + 1]; }
      f[ti] = lt; f[ti + 1] = ltf;
    });
  }
  fs.writeFileSync(lightsOut, JSON.stringify({
    rig: "arc4-head", style: "limelight", fps, duration: +dur.toFixed(3), tempo: bpm,
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
