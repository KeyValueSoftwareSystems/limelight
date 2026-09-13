#!/usr/bin/env node
/* Where the lighting work actually stands.
   ---------------------------------------------------------------------------
   Two halves, checked two different ways.

   The code half is probed by BEHAVIOUR. Each item renders or plans something
   and looks at the answer, because grepping for a variable name passes while
   the variable does nothing -- which is the failure this project has hit
   repeatedly. If a probe cannot decide, it says so rather than guessing.

   The rig half cannot be checked from here at all. It is read out of
   checklists/limelight.rig.md, where a person who watched real lamps ticked a
   box. Nothing in this file can tick one.

       node tools/status.js
*/
"use strict";
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..");
const rd = p => JSON.parse(fs.readFileSync(path.join(R, p), "utf8"));

const { frame } = require(path.join(R, "readers/lights/frame.js"));
const { plan } = require(path.join(R, "readers/lights/arranger.js"));
const { enumerate } = require(path.join(R, "readers/lights/preflight.js"));
const { shape } = require(path.join(R, "readers/lights/fromscore.js"));

const layout = rd("readers/lights/arc4-head.layout.json");
const palette = rd("readers/lights/arc4-head.palette.json");
const score = shape(rd("protocol/levels.score"));

const RIG = { rig: "arc4-head", fixtures: layout.fixtures };
const items = [];
const item = (name, fn, why) => {
  let ok, detail;
  try { const r = fn(); ok = r.ok; detail = r.detail; }
  catch (e) { ok = null; detail = "probe failed: " + e.message; }
  items.push({ name, ok, detail, why });
};

/* ---- 1. does a look develop across a section? -------------------------- */
item("a look develops across a section", () => {
  const LIB = { g: { id: "g", kind: "individual",
    gesture: { group: "all_pars", keys: [{ intent: { colour: [1, 0, 1] } }] } } };
  const P = { grid: { beats_per_bar: 4 }, assignments: [{
    from: { bar: 1, beat: 1 }, to: { bar: 17, beat: 1 }, seq_id: "g",
    layer: "par", priority: 0, params: { floor: 0.1, peak: 1, mode: "hit", intensity: 1 } }] };
  const C = { layout: RIG, library: LIB };
  const lv = b => frame({ bar: b, beat: 1 }, P, C).fixtures.find(f => f.id === "par_1").intent.level;
  const early = lv(2), late = lv(15);
  return { ok: Math.abs(early - late) > 0.02,
           detail: `bar 2 -> ${early.toFixed(2)}, bar 15 -> ${late.toFixed(2)} in one 16-bar section` };
}, "a build cannot grow if the same bar-in produces the same level bar-out");

/* ---- 2. does an unlit lamp fade, or snap to the floor? ----------------- */
item("an off lamp fades rather than snapping", () => {
  const LIB = { alt: { id: "alt", kind: "individual", gesture: {
    pattern: "inner_outer_alternation",
    keys: [{ target: "inner", intent: { colour: [1, 0, 1] } },
           { target: "outer", intent: { colour: [0, 1, 1] } }] } } };
  const P = { grid: { beats_per_bar: 4 }, assignments: [{
    from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "alt",
    layer: "par", priority: 0, params: { floor: 0.08, peak: 0.35, mode: "breathe", intensity: 1 } }] };
  const C = { layout: RIG, library: LIB };
  /* Counting distinct levels is not enough: an alternating look breathes for
     half the bar and then sits flat, which still yields plenty of distinct
     values. What gives it away is the flat RUN, so measure the longest stretch
     of identical output. */
  const vals = [];
  for (let i = 0; i < 32; i++)
    vals.push(frame({ bar: 1, beat: 1 + i * 0.125 }, P, C)
      .fixtures.find(f => f.id === "par_1").intent.level.toFixed(3));
  let run = 1, worst = 1;
  for (let i = 1; i < vals.length; i++) {
    run = vals[i] === vals[i - 1] ? run + 1 : 1;
    if (run > worst) worst = run;
  }
  const share = worst / vals.length;
  return { ok: share < 0.25,
           detail: `held one level for ${worst} of ${vals.length} samples `
                 + `(${Math.round(share * 100)}% of the bar motionless)` };
}, "the smooth curve is computed and then discarded by a yes/no gate");

/* ---- 3. does a returning section get the look it had before? ----------- */
item("a returning section reuses its earlier look", () => {
  const p = plan(score, enumerate(layout, { palette }), 7);
  const secs = score.sections || [];
  const byRepeat = {};
  for (const a of p.assignments.filter(x => x.layer === "par")) {
    const s = secs.find(x => x.from.bar === a.from.bar);
    if (s && s.repeat) (byRepeat[s.repeat] = byRepeat[s.repeat] || []).push(a.seq_id);
  }
  const groups = Object.entries(byRepeat).filter(([, v]) => v.length > 1);
  /* Report how close it is rather than pass/fail only: going from five looks
     for one label to two is most of the distance, and a flat "no" hides that. */
  const same = groups.filter(([, v]) => new Set(v).size === 1);
  const spread = groups.map(([k, v]) => `${k}: ${new Set(v).size} look(s) across ${v.length} sections`);
  return { ok: groups.length > 0 && same.length === groups.length,
           detail: spread.join("   ") || "no repeats in this score" };
}, "the score says these are the same material; an audience learns a show by recognising it");

/* ---- 4. does anything downstream read pace or signals? ----------------- */
item("the rig reads pace and signals", () => {
  const src = ["arranger.js", "frame.js", "bake.js", "fromscore.js"]
    .map(f => fs.readFileSync(path.join(R, "readers/lights", f), "utf8")).join("\n");
  const reads = ["pace", "signals"].filter(k => new RegExp(`\\b${k}\\b`).test(src));
  /* a name appearing is necessary but not sufficient -- say so rather than pass */
  return { ok: reads.length === 2 ? null : false,
           detail: reads.length ? `mentions ${reads.join(", ")} -- check by hand that it is used`
                                : "neither pace nor signals appears anywhere in the chain" };
}, "the build information exists in the score and is currently unread");

/* ---- 5. protocol: are the newest fields askable and clipped? ----------- */
item("signals and melody are askable and windowed", () => {
  const { execFileSync } = require("child_process");
  const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(R, "hub"))})
import score_api as S
raw = json.load(open(${JSON.stringify(path.join(R, "protocol/levels.score"))}))
r = S.handle({"score":"levels","fields":["signals","melody"],
              "window":{"from_bar":25,"bars":9}}, lambda n, p=None: raw)
sig, mel = r.get("signals") or [], r.get("melody") or []
bars = [x.get("bar") for x in mel]
print(json.dumps({"signals": len(sig), "melody": len(mel),
                  "lo": min(bars) if bars else None, "hi": max(bars) if bars else None}))
`;
  const o = JSON.parse(execFileSync("python3", ["-c", py]).toString());
  const clipped = o.lo !== null && o.lo >= 25 && o.hi < 34;
  return { ok: o.signals > 0 && o.melody > 0 && clipped,
           detail: `${o.signals} signals, ${o.melody} melody notes, bars ${o.lo}-${o.hi} (asked 25-33)` };
}, "a window has to clip, or asking for 8 bars hands back the whole song");

/* ---- 6. melody timing resolution -------------------------------------- */
item("melody notes carry their real timing", () => {
  const raw = rd("protocol/levels.score");
  const m = raw.melody || [];
  const frac = m.filter(n => !Number.isInteger(n.beat)).length;
  const short = m.filter(n => (n.held_beats || 0) < 1).length;
  return { ok: frac > 0,
           detail: `${frac} of ${m.length} notes sit off a whole beat; ${short} are shorter than a beat` };
}, "onsets rounded to the beat destroy a melody's rhythm, which is most of its identity");

/* ---- the rig half: read, never decided here --------------------------- */
const listPath = path.join(R, "checklists/limelight.rig.md");
let watched = [];
if (fs.existsSync(listPath)) {
  for (const line of fs.readFileSync(listPath, "utf8").split("\n")) {
    const m = line.match(/^- \[( |x|X)\] \*\*(.+?)\*\*/);
    if (m) watched.push({ done: m[1].toLowerCase() === "x", name: m[2].replace(/\.$/, "") });
  }
}

/* ---- report ------------------------------------------------------------ */
const mark = v => (v === true ? " ok " : v === null ? " ?? " : "    ");
console.log("\nCODE  — probed by behaviour on this machine\n");
for (const it of items) {
  console.log(`  [${mark(it.ok)}] ${it.name}`);
  console.log(`         ${it.detail}`);
  if (it.ok !== true) console.log(`         why it matters: ${it.why}`);
}
console.log("\nRIG   — only a person who watched the lamps can tick these\n");
if (!watched.length) console.log("  (no checklist found at checklists/limelight.rig.md)");
for (const w of watched) console.log(`  [${w.done ? " ok " : "    "}] ${w.name}`);

const codeDone = items.filter(i => i.ok === true).length;
const unsure = items.filter(i => i.ok === null).length;
console.log(`\n${codeDone} of ${items.length} code items pass`
  + (unsure ? `, ${unsure} need a human to look` : "")
  + `; ${watched.filter(w => w.done).length} of ${watched.length} confirmed on the rig.\n`);
