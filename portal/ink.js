"use strict";
const fs = require("fs");
const path = require("path");

const HERE = __dirname;

function measure(rigName) {
  const venueDir = path.join(HERE, "venues", rigName);
  const manifest = JSON.parse(fs.readFileSync(path.join(venueDir, "manifest.json"), "utf8"));
  const bpm = 120;
  const fps = 40;
  const ctx = {
    fps, bpm,
    layout: manifest,
    restColour: [1, 0.75, 0.35],
    beatAt: (t) => (t || 0) * bpm / 60,
  };
  const rows = [];
  const catIds = (() => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(HERE, "effects.json"), "utf8"));
      const eff = Array.isArray(c) ? c : c.effects;
      return new Set(eff.map((e) => e.id));
    } catch (e) { return null; }
  })();
  for (const file of fs.readdirSync(venueDir)) {
    if (!file.endsWith(".js") || file === "helpers.js") continue;
    const eid = file.replace(/\.js$/, "");
    if (catIds && !catIds.has(eid)) continue;
    let mod;
    try {
      mod = require(path.join(venueDir, file));
    } catch (e) {
      continue;
    }
    if (typeof mod !== "function") continue;
    let dmx;
    try {
      dmx = mod({}, ctx);
    } catch (e) {
      continue;
    }
    if (!dmx) continue;
    const frames = [];
    const beatCtx = (i, n) => {
      const beat = (i / n) * 4;
      const bi = Math.floor(beat);
      return { t: i / fps, beat, beatIndex: bi, bphase: beat - bi,
               bar: Math.floor(bi / 4), downbeat: bi % 4 === 0,
               weight: 0.5 + 0.5 * Math.cos((bi % 4) * Math.PI / 2),
               energy: 0.7, p: i / n };
    };
    if (typeof dmx.render === "function") {
      for (let i = 0; i < 80; i++) {
        const t = i / fps;
        const v = 0.5 + 0.5 * Math.sin((i / 80) * Math.PI * 2);
        try {
          frames.push(dmx.beat ? dmx.render(beatCtx(i, 80)) : dmx.render(v, t));
        } catch (e) { }
      }
    } else if (Array.isArray(dmx.frames)) {
      for (const f of dmx.frames) frames.push(f);
    }
    if (!frames.length) continue;
    const lampsOf = (f) => {
      const out = [];
      for (let i = 0; i < 4; i++) {
        const b = i * 7;
        out.push(Math.max(f[b + 1] || 0, f[b + 2] || 0, f[b + 3] || 0));
      }
      return out;
    };
    let ink = 0, differ = 0, sum = 0, peak = 0, dark = 0;
    for (const f of frames) {
      const L = lampsOf(f);
      const lit = L.filter((x) => x > 12).length;
      ink += lit / 4;
      if (Math.max(...L) > 12 && Math.max(...L) - Math.min(...L) > 20) differ++;
      sum += L.reduce((a, b) => a + b, 0) / 4 / 255;
      peak = Math.max(peak, Math.max(...L) / 255);
      if (Math.max(...L) <= 12) dark++;
    }
    const n = frames.length;
    rows.push({
      eid,
      kind: typeof dmx.render === "function" ? (dmx.binding ? "binding" : "render") : "frames",
      ink: ink / n,
      differ: differ / n,
      mean: sum / n,
      peak,
      dark: dark / n,
    });
  }
  rows.sort((a, b) => b.ink - a.ink || b.differ - a.differ);
  return rows;
}

function table(rigName) {
  const rows = measure(rigName);
  const out = [];
  for (const r of rows) {
    out.push(
      "  " + r.eid.padEnd(12) +
      " ink " + r.ink.toFixed(2) +
      "  differ " + (r.differ * 100).toFixed(0).padStart(3) + "%" +
      "  mean " + r.mean.toFixed(2) +
      "  peak " + r.peak.toFixed(2) +
      "  dark " + (r.dark * 100).toFixed(0).padStart(3) + "%"
    );
  }
  return out;
}

module.exports = { measure, table };

if (require.main === module) {
  const rig = process.argv[2] || "arc4-head";
  console.log("effect        ink   differ  mean  peak  dark");
  for (const line of table(rig)) console.log(line);
}
