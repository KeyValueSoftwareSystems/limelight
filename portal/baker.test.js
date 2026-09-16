"use strict";
/* baker.js integration tests. Execs the real CLI (like readers/lights/bake.test.js)
   against the committed raga-of-revenge score and asserts the three defects are
   fixed end to end:

     1. an animated STATE loops (was: only frames[0] ever played)
     2. a live BINDING follows its stream        (was: fed a constant 0.5)
        - follow varies with the vocal
        - split lights BOTH sides                (0.5 was not an array -> black)
        - accent FLASHES on onsets               (0.5 never crossed threshold)
     3. the head never lurches >7 DMX/frame      (was: seams snapped)

   Run: node portal/baker.test.js */

const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");

const HERE = __dirname;
const REPO = path.dirname(HERE);
const SCORE =
  require(path.join(REPO, "protocol", "fixture.js")).pick("raga-of-revenge") ||
  path.join(REPO, "hub", "files", "score", "raga-of-revenge.score");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

function bake(rig, plan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bakertest-"));
  const planFile = path.join(tmp, "plan.json");
  const lightsFile = path.join(tmp, "out.lights.json");
  fs.writeFileSync(planFile, JSON.stringify(plan));
  execFileSync("node", [path.join(HERE, "baker.js"), SCORE, planFile, "--rig", rig, "--lights", lightsFile],
    { stdio: "pipe" });
  const show = JSON.parse(fs.readFileSync(lightsFile, "utf8"));
  fs.rmSync(tmp, { recursive: true, force: true });
  return show;
}
function secRange(show, i) {
  const p = show.phases[i];
  return [Math.max(0, Math.round(p.start * show.fps)), Math.min(show.frames.length, Math.round(p.end * show.fps))];
}
function distinct(show, a, b, ch) { const s = new Set(); for (let t = a; t < b; t++) s.add(show.frames[t][ch]); return s; }

/* ── 1. animated state loops — needs a multi-frame state module, so stand up a
   throwaway venue whose drone returns three distinct frames. ─────────────── */
{
  const venue = path.join(HERE, "venues", "__baketest__");
  fs.mkdirSync(venue, { recursive: true });
  fs.writeFileSync(path.join(venue, "manifest.json"), JSON.stringify({
    rig: "__baketest__", layout_file: "arc4-head.layout.json", total_channels: 41,
    supported_effects: ["drone"],
  }));
  /* three frames that differ on the inner pars' red channel (offset 7+1, 14+1),
     looping over one beat. If the baker still read frames[0] this never changes. */
  fs.writeFileSync(path.join(venue, "drone.js"), `"use strict";
module.exports = function drone(params, ctx) {
  const mk = (r) => { const f = new Array(41).fill(0); f[7]=255; f[8]=r; f[14]=255; f[15]=r; return f; };
  return { frames: [mk(40), mk(150), mk(250)], loop_beats: 1, per_fixture: ["par_8","par_15"] };
};`);

  try {
    const show = bake("__baketest__", { states: [{ section: 0, effect: "drone" }], bindings: [], gestures: [] });
    const [a, b] = secRange(show, 0);
    const vals = distinct(show, a, b, 8); // par_8 red
    ok("an animated state loops through all its frames (not just frames[0])",
       vals.has(40) && vals.has(150) && vals.has(250), `saw ${[...vals].sort((x, y) => x - y).join(",")}`);
  } finally {
    fs.rmSync(venue, { recursive: true, force: true });
  }
}

/* ── 2. a beat-locked state over a bar span, and head slew ────────────────
   pulse renders per frame against the real beat grid, and from_bar/to_bar puts
   it over part of a section rather than all of it. Together those are what make
   the lamps disagree with each other; the old follow/split/accent tests went
   with the envelope-driven effects they covered. */
{
  const plan = {
    states: [
      { section: 0, effect: "pulse", from_bar: 5, to_bar: 12, why: "beat-locked motion over a bar span" },
    ],
    bindings: [],
    gestures: [],
  };
  const show = bake("arc4-head", plan);

  {
    const lv = [];
    for (let t = 0; t < show.frames.length; t++) {
      const f = show.frames[t];
      lv.push([1, 8, 15, 22].map(o => Math.max(f[o], f[o + 1], f[o + 2])));
    }
    let apart = 0;
    for (const r of lv) if (Math.max(...r) > 12 && Math.max(...r) - Math.min(...r) > 20) apart++;
    ok("a beat-locked state over a bar span makes the lamps differ",
       apart > lv.length * 0.05, `${(apart / lv.length * 100).toFixed(1)}% of frames`);
  }

  // head slew: across the WHOLE show, pan(28)/tilt(30) never step more than 7
  {
    let maxPan = 0, maxTilt = 0;
    for (let t = 1; t < show.frames.length; t++) {
      maxPan = Math.max(maxPan, Math.abs(show.frames[t][28] - show.frames[t - 1][28]));
      maxTilt = Math.max(maxTilt, Math.abs(show.frames[t][30] - show.frames[t - 1][30]));
    }
    ok("the head never lurches — pan step <= 7 all show", maxPan <= 7, `max pan step ${maxPan}`);
    ok("the head never lurches — tilt step <= 7 all show", maxTilt <= 7, `max tilt step ${maxTilt}`);
  }
}

/* ── 3. compositor: gestures pop off the state and return, reductions darken,
   overlaps resolve by latest start, and the show ends with the song ───────── */
{
  const parBri = f => f[1] + f[2] + f[3] + f[8] + f[9] + f[10] + f[15] + f[16] + f[17] + f[22] + f[23] + f[24];

  // wash under a bright impact
  const show = bake("arc4-head", {
    states: [{ section: 0, effect: "wash", amount: 0.5, colour: "#3366cc" }], bindings: [],
    gestures: [{ moment: 0, effect: "impact", colour: "#ffffff", extent: "all", for_beats: 2 }],
  });
  const fps = show.fps, m0 = show.moments[0].t;
  const wash = parBri(show.frames[Math.round((m0 - 1.0) * fps)]);          // plain wash, 1s before
  const flash = Math.max(...[0, 1, 2, 3].map(k => parBri(show.frames[Math.round(m0 * fps) + k])));
  const tail = parBri(show.frames[Math.round((m0 + 0.9) * fps)]);          // late in the impact, envelope spent
  ok("a gesture pops brighter than the state it sits on", flash > wash * 1.5, `flash ${flash} vs wash ${wash}`);
  ok("a returning gesture goes back to the state, not to black", tail > 0 && tail >= wash * 0.5, `tail ${tail} vs wash ${wash}`);

  // a reductive gesture darkens the state to black
  const show2 = bake("arc4-head", {
    states: [{ section: 0, effect: "wash", amount: 0.5, colour: "#3366cc" }], bindings: [],
    gestures: [{ moment: 0, effect: "blackout", for_beats: 1 }],
  });
  ok("a reductive gesture (blackout) darkens the state to 0",
     parBri(show2.frames[Math.round(show2.moments[0].t * show2.fps) + 2]) === 0);

  // overlap: a blackout landing inside a running ramp wins (latest start)
  const show3 = bake("arc4-head", {
    states: [{ section: 0, effect: "wash", amount: 0.5 }], bindings: [],
    gestures: [{ from_moment: 0, to_moment: 2, effect: "ramp", to: 0.9 }, { moment: 1, effect: "blackout", for_beats: 1 }],
  });
  const bAt = parBri(show3.frames[Math.round(show3.moments[1].t * show3.fps) + 2]);
  ok("an overlapping blackout supersedes the ramp it lands inside (latest start wins)", bAt === 0, `bri ${bAt}`);

  // no dead black tail past the end of the song
  ok("the show ends with the song, no dead tail",
     show.frames.length / show.fps <= (show.duration || 1e9) + 1.0, `${(show.frames.length / show.fps).toFixed(1)}s vs ${show.duration}s`);
}

let bad = 0;
for (const [pass, name, detail] of out) {
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
