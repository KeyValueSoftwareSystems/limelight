"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const rig = require("./rig.js");

const args = process.argv.slice(2);
const song = args[0];
if (!song) {
  console.error("usage: look.js <song> [--rig <rig>] [--plan <plan.json>]");
  process.exit(2);
}
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const ROOT = path.join(__dirname, "..");
const rigName = opt("--rig", "arc4-head");
const draft = path.resolve("plan.json");
const planPath = opt("--plan", fs.existsSync(draft) ? draft : path.join(ROOT, "portal", "work", song + ".plan.json"));
const scorePath = require(path.join(ROOT, "protocol", "fixture.js")).pick(song);
const out = path.join(require("os").tmpdir(), "look-" + process.pid + ".json");

const planDoc = JSON.parse(fs.readFileSync(planPath, "utf8"));
const isCues = Array.isArray(planDoc.cues);
try {
  execFileSync(process.execPath,
    isCues
      ? [path.join(ROOT, "portal", "cue", "bake.js"), song, "--cues", planPath, "--rig", rigName, "--out", out]
      : [path.join(ROOT, "portal", "baker.js"), scorePath, planPath, "--rig", rigName, "--lights", out],
    { stdio: ["ignore", "ignore", "pipe"] });
} catch (e) {
  console.error("the baker could not render " + planPath + ":");
  console.error(String((e.stderr || "") || e.message).trim().split("\n").slice(-12).join("\n"));
  process.exit(1);
}

const show = JSON.parse(fs.readFileSync(out, "utf8"));
fs.unlinkSync(out);
const frames = show.frames || show;
const fps = show.fps || 40;
const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
const R = rig.fixtures(rigName);
const OFF = R.lampOffsets;
const dur = frames.length / fps;

const lum = (f, o) =>
  Math.pow(Math.max((f[o + 1] * 0.299 + f[o + 2] * 0.587 + f[o + 3] * 0.114) * (f[o] / 255), 0) / 255, 0.625) * 255;
const L = frames.map((f) => OFF.map((o) => lum(f, o)));
const rigL = L.map((r) => r.reduce((a, b) => a + b, 0) / r.length);

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const nCue = Array.isArray(plan.cues) ? plan.cues.length
  : (plan.states || []).length + (plan.bindings || []).length + (plan.gestures || []).length;

const out_ = [];
const say = (s) => out_.push(s);

say(`LOOK AT THE SHOW  ${song}  ${dur.toFixed(0)}s  ${R.lamps.length} lamps + ${R.heads.length} head`);
say("");
say(Array.isArray(plan.cues)
  ? `  ${nCue} cues, one every ${(dur / nCue).toFixed(1)}s, ${plan.cues.filter((c) => c.chase).length} carrying a chase`
  : `  ${(plan.states || []).length} states, ${(plan.bindings || []).length} bindings, ` +
    `${(plan.gestures || []).length} gestures = ${nCue} cues, one every ${(dur / nCue).toFixed(1)}s`);

const secs = score.sections || [];
say(`  the song has ${secs.length} sections, so a section carries ${(nCue / Math.max(1, secs.length)).toFixed(1)} cues`);
say("");

let big = 0;
for (let i = 1; i < frames.length; i++) {
  let d = 0;
  for (const o of OFF) for (const c of [1, 2, 3]) d += Math.abs(frames[i][o + c] - frames[i - 1][o + c]);
  if (d > 200) big++;
}
say(`  the whole rig changes at once every ${(frames.length / Math.max(1, big) / fps).toFixed(2)}s`);

const ev = [];
for (let i = 0; i < rigL.length; ) {
  if (rigL[i] < 5) {
    let j = i;
    while (j < rigL.length && rigL[j] < 5) j++;
    if (j - i >= 6) ev.push([i / fps, (j - i) / fps]);
    i = j;
  } else i++;
}
say(`  ${ev.length} full blackouts of 150ms or more, ${ev.reduce((a, b) => a + b[1], 0).toFixed(1)}s in total`);
if (ev.length) say("    at " + ev.map((e) => `${e[0].toFixed(0)}s/${e[1].toFixed(1)}s`).join("  "));
say("");

say("  THE ARC - mean brightness of the rig, section by section (0-255)");
const bars = " .:-=+*#%@";
for (const s of secs) {
  const a = Math.max(0, Math.floor(s.start * fps)), b = Math.min(rigL.length, Math.floor(s.end * fps));
  if (b <= a) continue;
  let m = 0, pk = 0;
  for (let i = a; i < b; i++) { m += rigL[i]; if (rigL[i] > pk) pk = rigL[i]; }
  m /= b - a;
  const n = Math.min(9, Math.floor((m / 255) * 10));
  say(`    ${String(s.label || "?").padEnd(14)} ${String(Math.round(s.start)).padStart(4)}s  ` +
      `mean ${m.toFixed(0).padStart(3)}  peak ${pk.toFixed(0).padStart(3)}  ${bars[n].repeat(Math.max(1, Math.round(m / 8)))}`);
}
say("");

const beats = (score.beats || []).map((b) => b.t);
const lifts = [];
for (let i = 1; i < rigL.length; i++) if (rigL[i] - rigL[i - 1] > 30) lifts.push(i);
let on = 0;
for (const i of lifts) {
  const t = i / fps;
  let best = 9;
  for (const b of beats) { const d = Math.abs(t - b); if (d < best) best = d; if (b > t + 1) break; }
  if (best <= 0.07) on++;
}
say(`  ${lifts.length} times the rig lifts hard; ${lifts.length ? Math.round((on / lifts.length) * 100) : 0}% land within 70ms of a beat`);

let flash = 0;
for (let k = 0; k < OFF.length; k++)
  for (let i = 1; i < L.length - 1; i++)
    if (L[i][k] > 100 && L[i - 1][k] < 20 && L[i + 1][k] < 20) flash++;
say(`  ${flash} one-frame flashes (a lamp full for 25ms between two dark frames)`);

let alone = 0;
for (const r of L) {
  const lit = r.map((x) => x > 12);
  const n = lit.filter(Boolean).length;
  if (n === 1 || n === r.length - 1) alone++;
}
say(`  ${(alone / fps).toFixed(1)}s of the show has exactly one lamp doing its own thing`);
say("");
say("  per lamp, left to right:  " + L[0].map((_, k) => {
  let m = 0; for (const r of L) m += r[k];
  return (m / L.length).toFixed(0);
}).join("  ") + "   (mean brightness; a lamp far from its mirror is a lamp that looks broken)");

console.log(out_.join("\n"));
