"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PLACES = ["scores", "hub/files/score", "work/gpu-scores",
                "readers/lights/panel/scores"];

function scores(root) {
  const base = root || ROOT;
  const found = [];
  for (const rel of PLACES) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(base, rel));
    } catch (e) {
      continue;
    }
    for (const n of names.filter((x) => x.endsWith(".score")).sort())
      found.push(path.join(base, rel, n));
  }
  return found;
}

function pick(want) {
  const all = scores();
  const asked = want || process.env.LIMELIGHT_SCORE;
  if (asked) {
    if (fs.existsSync(asked)) return asked;
    const hit = all.find(
      (p) => path.basename(p) === asked || path.basename(p, ".score") === asked,
    );
    if (hit) return hit;
  }
  return all[0] || null;
}

function need(who) {
  const at = pick();
  if (at) return at;
  console.log(`SKIP ${who}: no .score on disk; build one with listen/gpu/run.sh`);
  process.exit(0);
}

module.exports = { scores, pick, need, ROOT };
