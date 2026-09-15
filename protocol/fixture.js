"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PLACES = ["hub/files/score", "work/gpu-scores",
                "readers/lights/panel/scores"];

/* A score in the hub lives in .versions/<name>.score/<n>.score and nowhere
   else - there is no copy beside the store, so reading the folder finds
   nothing. Resolve the newest version instead, or the tests quietly fall
   through to work/gpu-scores and grade the formatters against a stale song. */
function latestVersion(dir, name) {
  const store = path.join(dir, ".versions", name);
  let ns = [];
  try {
    ns = fs
      .readdirSync(store)
      .filter((f) => /^\d+\.score$/.test(f))
      .map((f) => parseInt(f, 10))
      .sort((a, b) => a - b);
  } catch (e) {
    return null;
  }
  return ns.length ? path.join(store, ns[ns.length - 1] + ".score") : null;
}

function scores(root) {
  const base = root || ROOT;
  const found = [];
  const seen = new Set();
  for (const rel of PLACES) {
    const dir = path.join(base, rel);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }
    for (const n of names.filter((x) => x.endsWith(".score")).sort()) {
      if (seen.has(n)) continue;
      seen.add(n);
      found.push(path.join(dir, n));
    }
    let stored = [];
    try {
      stored = fs.readdirSync(path.join(dir, ".versions"));
    } catch (e) {
      stored = [];
    }
    for (const n of stored.filter((x) => x.endsWith(".score")).sort()) {
      if (seen.has(n)) continue;
      const at = latestVersion(dir, n);
      if (at) {
        seen.add(n);
        found.push(at);
      }
    }
  }
  return found;
}

function pick(want) {
  const all = scores();
  const asked = want || process.env.LIMELIGHT_SCORE;
  if (asked) {
    if (fs.existsSync(asked)) return asked;
    const nameOf = (p) =>
      p.includes(`${path.sep}.versions${path.sep}`)
        ? path.basename(path.dirname(p))
        : path.basename(p);
    const hit = all.find(
      (p) => nameOf(p) === asked || nameOf(p).replace(/\.score$/, "") === asked,
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

module.exports = { scores, pick, need, latestVersion, ROOT };
