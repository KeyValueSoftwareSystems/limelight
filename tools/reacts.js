#!/usr/bin/env node
/* Does the show actually react to a thing in the score?
   ---------------------------------------------------------------------------
   You cannot answer that by looking at one show. A rig that ignores the build
   information and a rig that uses it both produce a plausible-looking file.

   So this bakes the show twice -- once from the real score, once from a copy
   with exactly one thing taken away -- and compares the frames. If removing the
   double-time markers changes nothing, they are not being used, and no amount
   of reading the source can argue with that.

       node tools/reacts.js                      every check, on the fixture
       node tools/reacts.js a-song.score 7       a real score and a seed

   Each line reports how many of the baked frames moved. Zero means blind.

   What this proves and what it does not: a difference shows the information
   reached the output, not that it was used WELL. A show that reacted to the
   build by going dark would score just as high as one that ramped. This
   separates "never looked" from "looked", which is the question you cannot
   answer by reading code -- judging the reaction still needs eyes.
*/
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const R = path.join(__dirname, "..");

const src = process.argv[2] || path.join(R, "protocol/levels.score");
const seed = process.argv[3] || "7";
const raw = JSON.parse(fs.readFileSync(src, "utf8"));

/* Each mutation removes ONE kind of information and leaves everything else
   exactly as it was, so a difference in the output can only come from that. */
const MUTATIONS = [
  ["pace — how busy each bar is", s => {
    if (!s.bars || !s.bars.pace) return null;
    s.bars.pace = s.bars.pace.map(() => 1.0);          /* flat: every bar ordinary */
  }],
  ["rise — which sections build", s => {
    if (!s.parts) return null;
    for (const p of s.parts) p.rise = 0;
  }],
  ["tempo changes — double and half time", s => {
    if (!s.signals) return null;
    s.signals = s.signals.filter(g => !/time/.test(String(g.what || "")));
  }],
  ["rises — a build announced ahead of time", s => {
    if (!s.signals) return null;
    s.signals = s.signals.filter(g => g.is !== "rise");
  }],
  ["returning riffs — a musical idea coming back", s => {
    if (!s.signals) return null;
    s.signals = s.signals.filter(g => g.again_of === undefined);
  }],
  ["repeats — which sections are the same material", s => {
    if (!s.parts) return null;
    for (const p of s.parts) { delete p.like; p.returns = false; }
  }],
  ["moment weight — how much each moment matters", s => {
    if (!s.moments) return null;
    for (const m of s.moments) m.weight = 0.5;         /* all equally important */
  }],
  ["energy — the loudness curve", s => {
    if (!s.bars || !s.bars.intensity) return null;
    s.bars.intensity = s.bars.intensity.map(() => 0.6);
  }],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reacts-"));
function bake(score, tag) {
  const sp = path.join(tmp, tag + ".score"), op = path.join(tmp, tag + ".lights.json");
  fs.writeFileSync(sp, JSON.stringify(score));
  execFileSync("node", [path.join(R, "readers/lights/bake.js"), sp, seed, "--lights", op],
               { stdio: "pipe" });
  return JSON.parse(fs.readFileSync(op, "utf8")).frames;
}

const base = bake(raw, "base");
console.log(`\nbaked ${base.length} frames from ${path.basename(src)} at seed ${seed}`);
console.log("take one thing away, bake again, and see whether the show notices:\n");

const rows = [];
for (const [name, mutate] of MUTATIONS) {
  const copy = JSON.parse(JSON.stringify(raw));
  if (mutate(copy) === null) { rows.push([name, null, "not in this score"]); continue; }
  let other;
  try { other = bake(copy, "m" + rows.length); }
  catch (e) { rows.push([name, null, "bake failed: " + e.message.split("\n")[0]]); continue; }
  let moved = 0;
  const n = Math.min(base.length, other.length);
  for (let i = 0; i < n; i++) {
    const a = base[i], b = other[i];
    for (let c = 0; c < a.length; c++) if (a[c] !== b[c]) { moved++; break; }
  }
  const pct = n ? (moved / n) * 100 : 0;
  rows.push([name, moved, `${moved} of ${n} frames differ (${pct.toFixed(1)}%)`]);
}

const pad = Math.max(...rows.map(r => r[0].length));
for (const [name, moved, detail] of rows) {
  const mark = moved === null ? " -- " : moved === 0 ? "BLIND" : " uses";
  console.log(`  [${mark}] ${name.padEnd(pad)}   ${detail}`);
}
const blind = rows.filter(r => r[1] === 0).length;
const uses = rows.filter(r => r[1] > 0).length;
console.log(`\n${uses} used, ${blind} ignored.`
  + (blind ? "  An ignored line means the score carries it and the show never looks.\n" : "\n"));
fs.rmSync(tmp, { recursive: true, force: true });
