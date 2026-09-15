"use strict";
/* bakelib.js tests — the frame selection, head slew, and stream sampling that
   decide what the baker writes. Plain node idiom: run with `node portal/bakelib.test.js`.

   These pin the three defects the baker had:
     - states rendered only frames[0]      -> frameAt loops multi-frame effects
     - bindings were fed a constant 0.5     -> sampler follows the real streams
     - the head could teleport at seams     -> slew clamps per-frame change */

const { frameAt, slew, makeStreamSampler, bindingValueFn } = require("./bakelib.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-9 : e);

/* ── frameAt ────────────────────────────────────────────────────────────── */
{
  const one = { frames: [["A"]], loop_beats: 1 };
  ok("a single-frame effect is a held look", frameAt(one, 0, 4, 120)[0] === "A" && frameAt(one, 3.5, 4, 120)[0] === "A");

  // 4 frames looping over 1 beat at 120bpm => 0.5s per beat, 0.125s per frame
  const four = { frames: [[0], [1], [2], [3]], loop_beats: 1 };
  ok("frame 0 at start", frameAt(four, 0.0, 4, 120)[0] === 0);
  ok("frame 1 a quarter-beat in", frameAt(four, 0.125, 4, 120)[0] === 1);
  ok("frame 3 three-quarters in", frameAt(four, 0.375, 4, 120)[0] === 3);
  ok("loops back to frame 0 after one beat", frameAt(four, 0.5, 4, 120)[0] === 0);
  ok("loops again into the next beat", frameAt(four, 0.625, 4, 120)[0] === 1);

  const nonloop = { frames: [[0], [1], [2], [3]], loop_beats: 0 };
  ok("loop_beats 0 spreads the frames once across the span",
     nonloop && frameAt(nonloop, 0, 2, 120)[0] === 0 && frameAt(nonloop, 1.0, 2, 120)[0] === 2);

  ok("no frames -> null", frameAt({ frames: [], loop_beats: 1 }, 0, 4, 120) === null);
  ok("zero span with multi-frame never divides by zero", frameAt({ frames: [[0], [1]], loop_beats: 0 }, 0, 0, 120)[0] === 0);
}

/* ── slew ───────────────────────────────────────────────────────────────── */
{
  ok("a small move passes through", slew(100, 105, 7) === 105);
  ok("an up jump is clamped to +maxStep", slew(100, 200, 7) === 107);
  ok("a down jump is clamped to -maxStep", slew(200, 100, 7) === 193);
  ok("no move stays put", slew(169, 169, 7) === 169);
  // integrating slew frame by frame reaches the target without ever lurching
  let v = 0; const target = 169; let maxStep = 0, prev = 0;
  for (let i = 0; i < 40; i++) { const nv = slew(v, target, 7); maxStep = Math.max(maxStep, Math.abs(nv - v)); prev = v; v = nv; }
  ok("a park jump glides in <=7 steps and arrives", v === 169 && maxStep <= 7, `arrived ${v}, max step ${maxStep}`);
}

/* ── stream sampler ─────────────────────────────────────────────────────── */
{
  const score = {
    stems_temporal: { window_s: 0.5, stems: {
      "lead-vocal": [0.0, 1.0, 0.0, 0.0],   // centres at 0.25, 0.75, 1.25, 1.75s
      "back-vocal": [0.5, 0.5, 0.5, 0.5],
      "vocal":      [0.2, 0.4, 0.6, 0.8],
      "drums":      [0.0, 0.0, 0.0, 0.0],
    } },
    rhythm: { hits: [ { t: 1.0, intensity: 0.4 }, { t: 2.0, intensity: 0.8 } ] },
  };
  const s = makeStreamSampler(score, { onset_decay_s: 0.1 });

  ok("resolve exact stem name", s.resolveStemName("vocal") === "vocal");
  ok("resolve normalises spaces to hyphen", s.resolveStemName("lead vocal") === "lead-vocal");
  ok("resolve falls back to substring (shortest wins)", s.resolveStemName("voc") === "vocal");
  ok("resolve unknown -> null", s.resolveStemName("theremin") === null);

  ok("sampleStem clamps before the first window centre", near(s.sampleStem("lead-vocal", 0.0), 0.0));
  ok("sampleStem hits a window centre exactly", near(s.sampleStem("lead-vocal", 0.75), 1.0));
  ok("sampleStem interpolates between centres", near(s.sampleStem("lead-vocal", 0.5), 0.5)); // halfway 0.0->1.0
  ok("sampleStem clamps past the last centre", near(s.sampleStem("vocal", 5.0), 0.8));
  ok("unknown stream samples to 0", s.sampleStem("theremin", 1.0) === 0);

  ok("onset rings at the hit (normalised to loudest = 0.8)", near(s.sampleOnset(2.0), 1.0, 1e-9));
  ok("a quieter hit rings proportionally lower", near(s.sampleOnset(1.0), 0.5, 1e-9)); // 0.4/0.8
  ok("onset has decayed to 0 well after the hit", s.sampleOnset(2.5) === 0);
  ok("onset is ~half-way down mid-decay", near(s.sampleOnset(2.05), 0.5, 1e-9)); // (1-0.5)*1.0

  /* bindingValueFn: shape per effect */
  const followVal = bindingValueFn({ eid: "follow", streams: "vocal" }, s);
  ok("follow value is a scalar from its stream", near(followVal(1.25), 0.6));
  const splitVal = bindingValueFn({ eid: "split", streams: ["lead-vocal", "back-vocal"] }, s);
  const pair = splitVal(0.75);
  ok("split value is a [left,right] pair", Array.isArray(pair) && near(pair[0], 1.0) && near(pair[1], 0.5), JSON.stringify(pair));
  const accentVal = bindingValueFn({ eid: "accent", streams: undefined }, s);
  ok("accent value rides onsets, not a stream", near(accentVal(2.0), 1.0));
}

let bad = 0;
for (const [pass, name, detail] of out) {
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
