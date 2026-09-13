#!/usr/bin/env node
/* The board: every brief we have asked for, and which of them the rig is doing.
   ---------------------------------------------------------------------------
   Briefs are data in briefs/ -- one small file each, saying where in a song to
   look and which effect we want there. Effects are measurements in measure.js.
   Renjith adds briefs; effects grow slowly and on purpose.

       node tools/briefs.js            the board
       node tools/briefs.js --json     the same, for the panel to show

   Each line is judged from the baked frames, so it says what the rig does, not
   what anyone intended. A brief with no score on this machine is skipped and
   says so rather than counting as a pass.
*/
"use strict";
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..");
const M = require(path.join(R, "tools", "measure.js"));

const EFFECTS = {
  "speed-rises": { check: "rising", measure: "hits per bar" },
  "ripple":      { check: "below-half", measure: "lamps identical" },
  "glides":      { check: "never-still", measure: "longest still stretch" },
  "lands":       { check: "hits", measure: "change on the marked beat" },
};

const dir = path.join(R, "briefs");
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort() : [];

const findScore = song => [path.join(R, "scores", song + ".score"),
                           path.join(R, "protocol", song + ".score")]
  .find(p => fs.existsSync(p));

const results = [];
for (const f of files) {
  const b = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const e = EFFECTS[b.effect];
  const row = { file: f, ...b };
  if (!e) { row.state = "unknown-effect"; row.detail = `no effect called ${b.effect}`; results.push(row); continue; }
  const sp = findScore(b.song);
  if (!sp) { row.state = "no-score"; row.detail = `${b.song} is not built on this machine`; results.push(row); continue; }
  const r = M.judge({ score: sp, song: b.song, from: b.from_bar, bars: b.bars,
                      effect: b.effect, check: e.check, measure: e.measure, seed: b.seed || 7 });
  row.state = r.ok ? "doing" : "not-yet";
  row.detail = r.verdict;
  results.push(row);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ generated: new Date().toISOString(), briefs: results }, null, 1));
  process.exit(0);
}

const mark = s => s === "doing" ? " doing " : s === "not-yet" ? "not yet" : "  --   ";
console.log("");
for (const r of results) {
  const where = `${r.song} ${r.from_bar}-${r.from_bar + (r.bars || 1) - 1}`;
  console.log(`  [${mark(r.state)}] ${where.padEnd(16)} ${String(r.effect).padEnd(12)} ${r.detail}`);
  if (r.want) console.log(`            want: ${r.want}`);
  if (r.seen) console.log(`            seen: ${r.seen}`);
}
const doing = results.filter(r => r.state === "doing").length;
const judged = results.filter(r => r.state === "doing" || r.state === "not-yet").length;
const skipped = results.length - judged;
console.log(`\n  ${doing} of ${judged} landing`
  + (skipped ? `, ${skipped} skipped (score not built here)` : "") + "\n");
