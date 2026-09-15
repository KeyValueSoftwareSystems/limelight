"use strict";
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const rig = process.argv[2] || "arc4-head";
const dir = path.join(HERE, rig);
const H = require(path.join(dir, "helpers.js"));
const manifest = JSON.parse(
  fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
);
const catalog = JSON.parse(
  fs.readFileSync(path.join(HERE, "..", "effects.json"), "utf8"),
).effects;
const byId = Object.fromEntries(catalog.map((e) => [e.id, e]));

const ctx = {
  bpm: 120,
  fps: H.FPS,
  beats: 4,
  restColour: [0.2, 0.4, 1],
  restLevel: 0.35,
  stream: () => 0.5,
  sample: () => 0.5,
};

function defaults(e) {
  const out = {};
  for (const [k, v] of Object.entries(e.dials || {})) {
    out[k] = v && typeof v === "object" && "default" in v ? v.default : v;
  }
  return out;
}

function look(frames) {
  if (!frames || !frames.length) return null;
  const lv = [];
  const hues = new Set();
  let panMove = 0,
    tiltMove = 0,
    strobeOn = 0;
  let prevPan = null,
    prevTilt = null;
  const perFixture = [];
  for (const f of frames) {
    let lit = 0,
      sum = 0;
    for (const p of H.PARS) {
      const r = f[p.offset + H.PAR.r],
        g = f[p.offset + H.PAR.g],
        b = f[p.offset + H.PAR.b];
      const m = f[p.offset + H.PAR.master] > 0 ? Math.max(r, g, b) / 255 : 0;
      sum += m;
      if (m > 0.02) {
        lit++;
        hues.add(
          `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`,
        );
      }
    }
    perFixture.push(lit);
    lv.push(sum / Math.max(1, H.PARS.length));
    for (const h of H.HEADS) {
      const pan = f[h.offset + H.HEAD.pan],
        tilt = f[h.offset + H.HEAD.tilt];
      const st = f[h.offset + H.HEAD.strobe];
      if (prevPan != null) panMove = Math.max(panMove, Math.abs(pan - prevPan));
      if (prevTilt != null)
        tiltMove = Math.max(tiltMove, Math.abs(tilt - prevTilt));
      if (st > 0) strobeOn++;
      prevPan = pan;
      prevTilt = tilt;
    }
  }
  let parStrobe = 0;
  for (const f of frames)
    for (const p of H.PARS) if (f[p.offset + H.PAR.strobe] > 0) parStrobe++;
  return {
    n: frames.length,
    peak: Math.max(...lv),
    floor: Math.min(...lv),
    swing: Math.max(...lv) - Math.min(...lv),
    litMax: Math.max(...perFixture),
    litMin: Math.min(...perFixture),
    hues: hues.size,
    panMove,
    tiltMove,
    strobe: strobeOn + parStrobe,
  };
}

const rows = [];
for (const eid of manifest.supported_effects) {
  const f = path.join(dir, eid + ".js");
  const e = byId[eid];
  if (!fs.existsSync(f) || !e) {
    rows.push([eid, "MISSING MODULE"]);
    continue;
  }
  let out;
  try {
    out = require(f)(defaults(e), ctx);
  } catch (err) {
    rows.push([eid, "THREW: " + err.message]);
    continue;
  }
  const L = look(out && out.frames);
  if (!L) {
    rows.push([eid, "NO FRAMES"]);
    continue;
  }
  rows.push([eid, L, e]);
}

console.log(
  `${rig}: ${H.PARS.length} pars, ${H.HEADS.length} head(s), ${H.TOTAL_CH} ch\n`,
);
console.log(
  "id".padEnd(10),
  "dim".padEnd(7),
  "frames".padStart(6),
  "peak".padStart(6),
  "floor".padStart(6),
  "swing".padStart(6),
  "lit".padStart(7),
  "hues".padStart(5),
  "pan".padStart(4),
  "tilt".padStart(5),
  "strb".padStart(5),
);
for (const [eid, L, e] of rows) {
  if (typeof L === "string") {
    console.log(eid.padEnd(10), L);
    continue;
  }
  console.log(
    eid.padEnd(10),
    (e.dimension || "?").padEnd(7),
    String(L.n).padStart(6),
    L.peak.toFixed(2).padStart(6),
    L.floor.toFixed(2).padStart(6),
    L.swing.toFixed(2).padStart(6),
    `${L.litMin}-${L.litMax}`.padStart(7),
    String(L.hues).padStart(5),
    String(L.panMove).padStart(4),
    String(L.tiltMove).padStart(5),
    String(L.strobe).padStart(5),
  );
}
