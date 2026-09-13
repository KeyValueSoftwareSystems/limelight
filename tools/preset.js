#!/usr/bin/env node
/* Build a preset: a short clip, its protocol response, and what it proves.
   ---------------------------------------------------------------------------
       node tools/preset.js build presets/<recipe>.json
       node tools/preset.js find  presets/<recipe>.json     just say where it is

   A recipe names what to look for rather than hard bar numbers, so a preset
   survives the pipeline renumbering a song. The built folder is for the hub;
   nothing here writes audio into the repo.

   The cut does not have to be tidy. Every preset records `starts_at_s`, the
   song-second its first sample corresponds to, so a player adds that to its own
   position and the response -- which is in bars -- lines up regardless of where
   the knife fell.
*/
"use strict";
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const R = path.join(__dirname, "..");

const [cmd, recipePath] = process.argv.slice(2);
if (!cmd || !recipePath) {
  console.error("usage: node tools/preset.js build|find presets/<recipe>.json");
  process.exit(2);
}
const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));

/* ---- the score, wherever it lives on this machine ---------------------- */
const scorePath = [path.join(R, "scores", recipe.song + ".score"),
                   path.join(R, "hub", "files", "score", recipe.song + ".score"),
                   path.join(R, "protocol", recipe.song + ".score")]
  .find(p => fs.existsSync(p));
if (!scorePath) {
  console.error(`no score for ${recipe.song} on this machine.`);
  console.error(`Pull it first: limelight pull ${recipe.song}.score`);
  process.exit(3);
}
const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
const g = score.grid;
const bpb = g.beats_per_bar || 4;
const beatSec = 60 / g.bpm, barSec = beatSec * bpb;
/* bar 1 begins on the first downbeat, whatever the score numbers its first bar */
const secondsAtBar = bar => g.first_beat_s + (bar - 1) * barSec;

/* ---- find the passage the recipe asks for ------------------------------ */
const FINDERS = {
  /* the longest announced rise; ties broken by how much it matters */
  "strongest-build": () => {
    const rises = (score.signals || []).filter(s => s.is === "rise" && s.for_beats);
    if (rises.length) {
      rises.sort((a, b) => (b.for_beats - a.for_beats) || ((b.weight || 0) - (a.weight || 0)));
      const r = rises[0];
      return { from: r.bar, bars: Math.ceil(r.for_beats / bpb),
               why: `the longest announced rise: bar ${r.bar}, ${r.for_beats} beats` };
    }
    /* no announced rise: fall back to the section that climbs the most */
    const parts = (score.parts || []).filter(p => typeof p.rise === "number");
    if (!parts.length) return null;
    const p = parts.slice().sort((a, b) => b.rise - a.rise)[0];
    return { from: p.from_bar, bars: p.to_bar - p.from_bar + 1,
             why: `no rise signal; the section that climbs most is ${p.role} at bar ${p.from_bar} (rise ${p.rise})` };
  },
  /* the heaviest single moment, with a couple of bars either side */
  "biggest-moment": () => {
    const all = (score.moments || []).concat(score.signals || [])
      .filter(m => typeof m.weight === "number");
    if (!all.length) return null;
    const m = all.slice().sort((a, b) => b.weight - a.weight)[0];
    return { from: Math.max(1, m.bar - 2), bars: 5,
             why: `heaviest moment: ${m.is || "?"} ${m.what || ""} at bar ${m.bar}, weight ${m.weight}` };
  },
  /* the second time a returning section appears */
  "a-return": () => {
    const parts = score.parts || [];
    const seen = {};
    for (const p of parts) {
      if (!p.like) continue;
      if (seen[p.like]) return { from: p.from_bar, bars: p.to_bar - p.from_bar + 1,
        why: `${p.role} at bar ${p.from_bar} is material "${p.like}" returning (first seen bar ${seen[p.like]})` };
      seen[p.like] = p.from_bar;
    }
    return null;
  },
  /* the whole track. Some questions cannot be asked of a fragment -- whether the
     second drop is bigger than the first needs both drops in view -- and how
     much of a song a test needs is the test's business, not the cutter's. */
  "whole-song": () => {
    const fb = g.first_bar === undefined || g.first_bar === null ? 1 : g.first_bar;
    const last = g.last_bar !== undefined && g.last_bar !== null
      ? g.last_bar : fb + (g.bars || 0) - 1;
    return { from: 1, bars: Math.max(1, last), why: "the whole song" };
  },

  /* the quietest stretch of at least four bars */
  "quietest": () => {
    const v = (score.bars || {}).intensity || [];
    if (v.length < 8) return null;
    const fb = g.first_bar === undefined || g.first_bar === null ? 1 : g.first_bar;
    let best = null;
    for (let i = 0; i + 4 <= v.length; i++) {
      const w = v.slice(i, i + 4).filter(x => x !== null);
      if (!w.length) continue;
      const m = w.reduce((s, x) => s + x, 0) / w.length;
      if (!best || m < best.m) best = { m, i };
    }
    return best && { from: fb + best.i, bars: 4,
                     why: `quietest four bars, mean loudness ${best.m.toFixed(2)}` };
  },
};

const finder = FINDERS[recipe.find];
if (!finder) {
  console.error(`no finder called "${recipe.find}". have: ${Object.keys(FINDERS).join(", ")}`);
  process.exit(2);
}
const found = finder();
if (!found) {
  console.error(`could not find "${recipe.find}" in ${recipe.song} -- the score does not carry what it needs`);
  process.exit(3);
}

const pad = recipe.pad_bars || 0;
const from = Math.max(1, found.from - pad);
const bars = found.bars + pad * 2;
const startS = secondsAtBar(from), endS = secondsAtBar(from + bars);

console.log(`${recipe.name}`);
console.log(`  ${found.why}`);
console.log(`  with ${pad} bar(s) either side: bars ${from}-${from + bars - 1}`);
console.log(`  = ${startS.toFixed(2)}s to ${endS.toFixed(2)}s  (${(endS - startS).toFixed(1)}s of audio)`);
if (cmd === "find") process.exit(0);

/* ---- the clip ---------------------------------------------------------- */
const audio = [".wav", ".mp3"].map(ext =>
  [path.join(R, "synth", "out", recipe.song + ext),
   path.join(R, "synth", "incoming", recipe.song + ext),
   path.join(R, "hub", "files", "audio", recipe.song + ext)]).flat()
  .find(p => fs.existsSync(p));

const out = path.join(R, "work", "presets", recipe.name);
fs.mkdirSync(out, { recursive: true });

let clip = null;
if (audio && audio.endsWith(".wav")) {
  const py = `
import wave, sys
src, dst, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
w = wave.open(src); sr = w.getframerate()
w.setpos(min(int(a*sr), w.getnframes()))
data = w.readframes(max(0, int((b-a)*sr)))
o = wave.open(dst, "wb"); o.setnchannels(w.getnchannels())
o.setsampwidth(w.getsampwidth()); o.setframerate(sr); o.writeframes(data); o.close()
print(sr)
`;
  const dst = path.join(out, "clip.wav");
  execFileSync("python3", ["-c", py, audio, dst, String(startS), String(endS)], { stdio: "pipe" });
  clip = "clip.wav";
  console.log(`  cut ${path.basename(audio)} -> ${path.relative(R, dst)}`);
} else {
  console.log(`  no wav for ${recipe.song} here -- recipe and response written, clip not cut`);
}

/* ---- the response for exactly that window ------------------------------ */
const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(R, "hub"))})
import score_api as S
raw = json.load(open(${JSON.stringify(scorePath)}))
body = {"score": ${JSON.stringify(recipe.song)},
        "fields": ["grid","sections","curves","signals","moments","tension","layers","stems"],
        "curves": ["energy","pace","brightness","air","pump"],
        "window": {"from_bar": ${from}, "bars": ${bars}}}
json.dump({"request": body, "response": S.handle(body, lambda n, p=None: raw)}, sys.stdout, indent=1)
`;
fs.writeFileSync(path.join(out, "response.json"),
  execFileSync("python3", ["-c", py], { maxBuffer: 64 << 20 }).toString());

fs.writeFileSync(path.join(out, "preset.json"), JSON.stringify({
  name: recipe.name, song: recipe.song, tests: recipe.tests, effect: recipe.effect,
  from_bar: from, bars, starts_at_s: +startS.toFixed(4), ends_at_s: +endS.toFixed(4),
  found: found.why, clip, score_version: score.version,
  note: "starts_at_s is the song-second of this clip's first sample. Add it to the "
      + "player's position to get song time; the response is in bars and will line up.",
}, null, 1));

console.log(`  wrote ${path.relative(R, out)}/  (preset.json, response.json${clip ? ", clip.wav" : ""})`);
console.log(`  upload with: limelight push ${path.relative(R, out)}/*`);
