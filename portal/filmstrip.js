"use strict";
const fs = require("fs");
const path = require("path");
const RIG = require("./rig.js");

const HERE = __dirname;
const SHADE = [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"];

function shade(v) {
  const lit = Math.pow(Math.max(0, Math.min(255, v)) / 255, 0.625);
  return SHADE[Math.min(SHADE.length - 1, Math.round(lit * (SHADE.length - 1)))];
}

function hueName(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 20) return "";
  if (mx - mn < 25) return "white";
  let h;
  if (mx === r) h = 60 * (((g - b) / (mx - mn)) % 6);
  else if (mx === g) h = 60 * ((b - r) / (mx - mn) + 2);
  else h = 60 * ((r - g) / (mx - mn) + 4);
  if (h < 0) h += 360;
  const names = [[15, "red"], [45, "amber"], [70, "yellow"], [160, "green"],
                 [200, "cyan"], [255, "blue"], [290, "violet"], [345, "magenta"], [360, "red"]];
  for (const [lim, nm] of names) if (h < lim) return nm;
  return "red";
}

function strip(rigName, width) {
  width = width || 32;
  const venueDir = path.join(HERE, "venues", rigName);
  const manifest = JSON.parse(fs.readFileSync(path.join(venueDir, "manifest.json"), "utf8"));
  const bpm = 120, fps = 40;
  const ctx = { fps, bpm, layout: manifest, restColour: [1, 0.75, 0.35],
                beatAt: (t) => (t || 0) * bpm / 60 };
  const geom = RIG.fixtures(rigName);
  const out = [];
  const catIds = (() => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(HERE, "effects.json"), "utf8"));
      const eff = Array.isArray(c) ? c : c.effects;
      return new Set(eff.map((e) => e.id));
    } catch (e) { return null; }
  })();
  for (const file of fs.readdirSync(venueDir).sort()) {
    if (!file.endsWith(".js") || file === "helpers.js") continue;
    const eid = file.replace(/\.js$/, "");
    if (catIds && !catIds.has(eid)) continue;
    let mod, dmx;
    try { mod = require(path.join(venueDir, file)); } catch (e) { continue; }
    if (typeof mod !== "function") continue;
    try { dmx = mod({}, ctx); } catch (e) { continue; }
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
      for (let i = 0; i < width; i++) {
        const v = 0.5 + 0.5 * Math.sin((i / width) * Math.PI * 2);
        try {
          frames.push(dmx.beat ? dmx.render(beatCtx(i, width)) : dmx.render(v, i / fps));
        } catch (e) { }
      }
    } else if (Array.isArray(dmx.frames) && dmx.frames.length) {
      for (let i = 0; i < width; i++) {
        frames.push(dmx.frames[Math.floor(i / width * dmx.frames.length)]);
      }
    }
    if (!frames.length) continue;

    const rows = [];
    for (const off of geom.lampOffsets) {
      rows.push(frames.map((f) => shade(Math.max(f[off + 1] || 0, f[off + 2] || 0, f[off + 3] || 0))).join(""));
    }
    const headOff = geom.headOffsets.length ? geom.headOffsets[0] : null;
    const head = headOff == null ? "" : frames.map((f) => shade(f[headOff] || 0)).join("");
    const hues = new Set();
    for (const f of frames) {
      for (const off of geom.lampOffsets) {
        const h = hueName(f[off + 1] || 0, f[off + 2] || 0, f[off + 3] || 0);
        if (h) hues.add(h);
      }
    }
    out.push({ eid, rows, head, names: geom.lamps.map((l) => l.id), hues: [...hues], kind: dmx.binding ? "binding" : (typeof dmx.render === "function" ? "binding" : "frames") });
  }
  return out;
}

function render(rigName, width) {
  const lines = [];
  for (const e of strip(rigName, width)) {
    lines.push(`  ${e.eid}${e.hues.length ? "  [" + e.hues.join(" ") + "]" : ""}`);
    const w = Math.max(4, ...e.names.map((n) => n.length));
    e.rows.forEach((r, i) => lines.push(`    ${e.names[i].padEnd(w)} |${r}|`));
    if (e.head) lines.push(`    ${"head".padEnd(w)} |${e.head}|`);
  }
  return lines;
}

module.exports = { strip, render };

if (require.main === module) {
  const rig = process.argv[2] || "arc4-head";
  const w = parseInt(process.argv[3] || "32", 10);
  console.log("Each strip is one beat at 120bpm, left to right. ' ' is off, '@' is full.");
  console.log("");
  for (const line of render(rig, w)) console.log(line);
}
