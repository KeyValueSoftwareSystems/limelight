"use strict";
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const LAYOUTS = path.join(HERE, "..", "readers", "lights");

function layoutFor(rigName) {
  const venueDir = path.join(HERE, "venues", rigName);
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(venueDir, "manifest.json"), "utf8"));
  } catch (e) { }
  const file = manifest.layout_file || (rigName + ".layout.json");
  for (const dir of [venueDir, LAYOUTS]) {
    const at = path.join(dir, file);
    if (fs.existsSync(at)) {
      try { return { manifest, layout: JSON.parse(fs.readFileSync(at, "utf8")) }; } catch (e) { }
    }
  }
  return { manifest, layout: null };
}

function isHead(f) {
  return /head|spot|move|beam/i.test(String(f.type || "") + " " + String(f.id || ""));
}

function fixtures(rigName) {
  const { manifest, layout } = layoutFor(rigName);
  const list = (layout && layout.fixtures) || [];
  const rows = list.map((f) => ({
    id: f.id,
    type: f.type,
    offset: (f.address || 1) - 1,
    x: Array.isArray(f.at) ? f.at[0] : 0,
    head: isHead(f),
  }));
  const lamps = rows.filter((r) => !r.head).sort((a, b) => a.x - b.x);
  const heads = rows.filter((r) => r.head).sort((a, b) => a.x - b.x);
  return {
    rig: rigName,
    channels: (layout && layout.frame && layout.frame.channels) || manifest.total_channels || null,
    lamps, heads,
    lampOffsets: lamps.map((l) => l.offset),
    headOffsets: heads.map((h) => h.offset),
  };
}

function describe(rigName) {
  const r = fixtures(rigName);
  if (!r.lamps.length && !r.heads.length) return [`  (layout for ${rigName} not found)`];
  const out = [];
  out.push(`  ${r.lamps.length} lamp${r.lamps.length === 1 ? "" : "s"}` +
           (r.heads.length ? ` and ${r.heads.length} moving head${r.heads.length === 1 ? "" : "s"}` : "") +
           (r.channels ? `, ${r.channels} channels` : ""));
  if (r.lamps.length) {
    const xs = r.lamps.map((l) => l.x);
    const span = Math.max(...xs) - Math.min(...xs);
    out.push(`  lamps left to right: ${r.lamps.map((l) => l.id).join(", ")}`);
    if (span > 0) out.push(`  they span ${span.toFixed(1)}m, so there is a left, a right and a middle to work with`);
  }
  if (r.heads.length) out.push(`  heads: ${r.heads.map((h) => h.id).join(", ")}`);
  return out;
}

module.exports = { fixtures, describe, layoutFor };

if (require.main === module) {
  const rig = process.argv[2] || "arc4-head";
  console.log(JSON.stringify(fixtures(rig), null, 1));
  console.log(describe(rig).join("\n"));
}
