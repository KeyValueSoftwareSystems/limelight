#!/usr/bin/env node
"use strict";
/* Test harness for per-venue DMX effect functions.
   Usage: node portal/venues/test-effect.js <rig> <effect> [--bpm N] [--beats N] [--json]
   Example: node portal/venues/test-effect.js club16-2head impact --bpm 120 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const rig = args[0];
const effectId = args[1];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const bpm = +(opt("--bpm", 120));
const beats = opt("--beats", null);
const asJson = args.includes("--json");

if (!rig || !effectId) {
  console.error("usage: test-effect.js <rig> <effect> [--bpm N] [--beats N] [--json]");
  process.exit(2);
}

const venueDir = path.join(__dirname, rig);
const manifestPath = path.join(venueDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("no manifest at " + manifestPath);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (!manifest.supported_effects.includes(effectId)) {
  console.error(effectId + " is not supported on " + rig);
  console.error("supported: " + manifest.supported_effects.join(", "));
  process.exit(1);
}

const effectFn = require(path.join(venueDir, effectId + ".js"));
const layoutPath = path.join(__dirname, "..", "..", "readers", "lights", manifest.layout_file);
const layout = JSON.parse(fs.readFileSync(layoutPath, "utf8"));

const params = {};
if (beats) params.for_beats = +beats;

const ctx = { fps: 40, bpm, layout };
const result = effectFn(params, ctx);

console.log("%s on %s @ %d bpm:", effectId, rig, bpm);
console.log("  frames:      %d", result.frames.length);
console.log("  loop_beats:  %s", result.loop_beats);
console.log("  per_fixture: %d fixtures (%s)", result.per_fixture.length,
  result.per_fixture.slice(0, 4).join(", ") + (result.per_fixture.length > 4 ? " ..." : ""));
console.log("  binding:     %s", !!result.binding);
if (result.rate_ratio) console.log("  rate_ratio:  %s", result.rate_ratio);

if (result.frames.length > 0) {
  const f0 = result.frames[0];
  const nonzero = f0.filter(v => v > 0).length;
  console.log("  frame[0]:    %d/%d channels active", nonzero, f0.length);
}

if (asJson) {
  console.log(JSON.stringify(result, null, 1));
}
