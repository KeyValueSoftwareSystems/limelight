/* frame.js tests -- dynamics-driven PAR hits, a lively head, and the contrast
   overrides. Pure in position. Plain node idiom. */
"use strict";
const { frame } = require("./frame.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

const RIG = { rig: "arc4-head", fixtures: [
  { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
  { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
  { id: "head", type: "head13" } ] };
const LIB = {
  hold_x: { id: "hold_x", kind: "individual", gesture: {
    group: "all_pars", keys: [{ intent: { colour: [1, 0, 0] } }] } },
  head_x: { id: "head_x", kind: "individual", gesture: {
    group: "head", keys: [{ intent: { colour: "white", tilt: 0.5 } }] } },
  pair_x: { id: "pair_x", kind: "individual", gesture: {
    pattern: "inner_outer_alternation", group: "all_pars", keys: [
      { at: 0, target: "inner", intent: { level: 0.95, colour: [1, 0, 0] } },
      { at: 0, target: "outer", intent: { level: 0 } },
      { at: 1, target: "inner", intent: { level: 0 } },
      { at: 1, target: "outer", intent: { level: 0.95, colour: [0, 0.25, 1] } } ] } },
};
const CTX = { layout: RIG, library: LIB };
const g = (F, id) => F.fixtures.find(f => f.id === id).intent;
const par = (params) => ({ grid: { beats_per_bar: 4 },
  assignments: [{ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params }] });

/* ---- the hard hit: spike on the beat, floor between -------------------- */
{
  const plan = par({ floor: 0.55, peak: 1, mode: "hit", intensity: 1 });
  const onBeat = g(frame({ bar: 1, beat: 1 }, plan, CTX), "par_1");
  const between = g(frame({ bar: 1, beat: 1.5 }, plan, CTX), "par_1");
  ok("a hit spikes to the peak on the beat", near(onBeat.level, 1.0, 0.02), "on " + onBeat.level);
  ok("and falls to the floor between beats", near(between.level, 0.55, 0.02), "between " + between.level);
  ok("colour comes from the gesture", JSON.stringify(onBeat.colour) === JSON.stringify([1, 0, 0]));
}

/* ---- contrast: a low floor makes the same peak hit harder ------------- */
{
  const hi = g(frame({ bar: 1, beat: 1.5 }, par({ floor: 0.12, peak: 1, mode: "hit", intensity: 1 }), CTX), "par_1");
  ok("a breakdown floor (0.12) sits far below a drop floor (0.55)", near(hi.level, 0.12, 0.02), "floor " + hi.level);
}

/* ---- pair-alt (inner/outer call-and-response): the fixes -------------- */
{
  const planP = { grid: { beats_per_bar: 4 }, assignments: [{
    from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "pair_x", layer: "par",
    priority: 0, params: { floor: 0.12, peak: 1, mode: "hit", intensity: 1 } }] };
  const f0 = frame({ bar: 1, beat: 1 }, planP, CTX);   // globalBeat 0 -> inner active
  const inner0 = g(f0, "par_8"), outer0 = g(f0, "par_1");
  ok("pair-alt: inner takes the inner colour (red)", JSON.stringify(inner0.colour) === JSON.stringify([1, 0, 0]));
  ok("pair-alt: outer takes the OUTER colour (blue), not the fallback red",
     JSON.stringify(outer0.colour) === JSON.stringify([0, 0.25, 1]), JSON.stringify(outer0.colour));
  ok("pair-alt: active pair full up, off pair fully OFF (not floor)",
     near(inner0.level, 1, 1e-3) && outer0.level === 0, `in ${inner0.level} out ${outer0.level}`);
  const f1 = frame({ bar: 1, beat: 2 }, planP, CTX);   // globalBeat 1 -> outer active
  ok("pair-alt: the pairs trade on the next beat",
     g(f1, "par_1").level === 1 && g(f1, "par_8").level === 0,
     `outer ${g(f1, "par_1").level} inner ${g(f1, "par_8").level}`);
  const mid = g(frame({ bar: 1, beat: 1.5 }, planP, CTX), "par_8");  // between beats
  ok("pair-alt: the active pair stays held between beats (no hit-envelope dip)",
     near(mid.level, 1, 1e-3), "held " + mid.level);
}

/* ---- the head is always alive and moving ------------------------------ */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.9, motion: 0.5 } }] };
  const h1 = g(frame({ bar: 1, beat: 1 }, plan, CTX), "head");
  const h2 = g(frame({ bar: 1, beat: 2 }, plan, CTX), "head");
  ok("the head is lit and aimed", h1.level > 0 && h1.pan != null, JSON.stringify(h1));
  ok("the head pan moves over time", h1.pan !== h2.pan, `${h1.pan} vs ${h2.pan}`);
}

/* ---- whole rig alive: par AND head together --------------------------- */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params: { floor: 0.55, peak: 1, mode: "hit", intensity: 1 } },
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.9, motion: 0.8 } }] };
  const F = frame({ bar: 1, beat: 1 }, plan, CTX);
  ok("pars and head are both lit at once", g(F, "par_1").level > 0 && g(F, "head").level > 0);
}

/* ---- contrast overrides: blackout and white blast --------------------- */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params: { floor: 0.6, peak: 1, mode: "hit", intensity: 1 } },
    { from: { bar: 2, beat: 1 }, to: { bar: 2, beat: 2 }, type: "blackout", priority: 9 },
    { from: { bar: 3, beat: 1 }, to: { bar: 3, beat: 2 }, type: "white_blast", priority: 9 }] };
  const blk = frame({ bar: 2, beat: 1 }, plan, CTX);
  ok("blackout takes the whole rig dark", blk.fixtures.every(f => f.intent.level === 0));
  const blast = frame({ bar: 3, beat: 1 }, plan, CTX);
  ok("white blast fires every fixture full", blast.fixtures.every(f => f.intent.level === 1));
  ok("blast pars are white", JSON.stringify(g(blast, "par_1").colour) === JSON.stringify([1, 1, 1]));
  ok("frame stays deterministic",
     JSON.stringify(frame({ bar: 2, beat: 1 }, plan, CTX)) === JSON.stringify(blk));
}


/* =========================================================================
   The finer structure at render time: weighted hits, pauses, hooks, subsection
   modulation, per-bar texture lanes and harmony-tinted colour.
   ========================================================================= */
const base = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0,
  params: { floor: 0.5, peak: 1, mode: "hit", intensity: 1 } });
const headA = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1,
  params: { headDim: 0.8, motion: 0.5 } });
const P = (extra, more) => ({ grid: { beats_per_bar: 4 }, assignments: [base(), headA(), ...(extra || [])], ...(more || {}) });

/* ---- a hit's strength scales the blast; a full-weight blast is the old one ---- */
{
  const strong = frame({ bar: 2, beat: 1 }, P([{ from: { bar: 2, beat: 1 }, to: { bar: 2, beat: 2 }, type: "white_blast", priority: 9, params: { strength: 1 } }]), CTX);
  ok("a full-strength blast fires every fixture full", strong.fixtures.every(f => f.intent.level === 1));
  const light = frame({ bar: 2, beat: 1 }, P([{ from: { bar: 2, beat: 1 }, to: { bar: 2, beat: 2 }, type: "white_blast", priority: 9, params: { strength: 0.4 } }]), CTX);
  ok("a light blast is dimmer than a full one but still white",
     g(light, "par_1").level < 1 && g(light, "par_1").level >= 0.6 && JSON.stringify(g(light, "par_1").colour) === "[1,1,1]", `${g(light, "par_1").level}`);
  ok("a light blast leaves the head's prism alone", !g(light, "head").prism && g(strong, "head").prism === true);
}

/* ---- a pause sits the rig down for its beats, scaled by weight ---------------- */
{
  const plain = frame({ bar: 3, beat: 1 }, P(), CTX);
  const paused = frame({ bar: 3, beat: 1 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 4, beat: 1 }, type: "pause", priority: 8, params: { strength: 0.5, still: ["bass"] } }]), CTX);
  ok("a pause dims the pars well below the base hit", g(paused, "par_1").level < 0.6 * g(plain, "par_1").level, `${g(paused, "par_1").level} vs ${g(plain, "par_1").level}`);
  ok("a pause dims the head too", g(paused, "head").level < g(plain, "head").level);
  ok("a pause keeps the colour (it is a hush, not a blackout)", JSON.stringify(g(paused, "par_1").colour) === JSON.stringify(g(plain, "par_1").colour) && g(paused, "par_1").level > 0);
  const hard = frame({ bar: 3, beat: 1 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 4, beat: 1 }, type: "pause", priority: 8, params: { strength: 1, still: [] } }]), CTX);
  ok("a heavier pause hushes harder", g(hard, "par_1").level < g(paused, "par_1").level);
  const after = frame({ bar: 4, beat: 1 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 4, beat: 1 }, type: "pause", priority: 8, params: { strength: 0.5 } }]), CTX);
  ok("the beat after the pause is back to the base", after.fixtures[0].intent.level === plain.fixtures[0].intent.level);
}

/* ---- a hook lifts the look and puts the prism in ----------------------------- */
{
  const plain = frame({ bar: 3, beat: 1.5 }, P(), CTX);
  const hooked = frame({ bar: 3, beat: 1.5 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 5, beat: 1 }, type: "hook", priority: 7, params: { strength: 0.8 } }]), CTX);
  ok("a hook lifts the PAR level between hits", g(hooked, "par_1").level > g(plain, "par_1").level, `${g(hooked, "par_1").level} vs ${g(plain, "par_1").level}`);
  ok("a strong hook turns the head's prism on", g(hooked, "head").prism === true && !g(plain, "head").prism);
}

/* ---- subsection modulation: gain on the pars, motion on the head --------------- */
{
  const plain = frame({ bar: 3, beat: 1.5 }, P(), CTX);
  const quieter = frame({ bar: 3, beat: 1.5 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 5, beat: 1 }, type: "modulate", priority: 4, params: { gain: 0.8, motion: 0 } }]), CTX);
  ok("a modulation gain of .8 scales the PAR level by .8", near(g(quieter, "par_1").level, 0.8 * g(plain, "par_1").level, 0.01), `${g(quieter, "par_1").level}`);
  const faster = frame({ bar: 3, beat: 2.3 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 5, beat: 1 }, type: "modulate", priority: 4, params: { gain: 1, motion: 0.4 } }]), CTX);
  const still = frame({ bar: 3, beat: 2.3 }, P(), CTX);
  ok("a motion lift changes the head's sweep", g(faster, "head").pan !== g(still, "head").pan, `${g(faster, "head").pan} vs ${g(still, "head").pan}`);
}

/* ---- texture lanes: per bar, width closes the arc, pace drives the head --------- */
{
  const lanes = { from_bar: 1, width: [0, 1, 0.5, 0.5, null, 0.5, 0.5, 0.5], pace: [0.5, 0.5, 0, 1, 0.5, 0.5, 0.5, 0.5],
    pump: [0.5, 0.5, 0.5, 0.5, 0, 1, 0.5, 0.5], brightness: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 1], air: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    drums: [1, 1, 1, 1, 1, 1, 1, 0.1], vocals: [0, 0, 0, 0, 0, 0, 0, 0.9] };
  const plan = P([{ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, type: "accent_strobe", priority: 2, params: { strength: 0.8 } }], { lanes });
  const narrow = frame({ bar: 1, beat: 1 }, plan, CTX), wide = frame({ bar: 2, beat: 1 }, plan, CTX);
  ok("a narrow bar dims the outer pars against the inner", g(narrow, "par_1").level < g(narrow, "par_8").level, `${g(narrow, "par_1").level} vs ${g(narrow, "par_8").level}`);
  ok("a wide bar lights the outer pars as full as the inner", near(g(wide, "par_1").level, g(wide, "par_8").level, 0.01));
  const slow = frame({ bar: 3, beat: 2.3 }, plan, CTX), fast = frame({ bar: 4, beat: 2.3 }, plan, CTX);
  ok("pace moves the head's sweep", slow.fixtures.find(f => f.id === "head").intent.pan !== fast.fixtures.find(f => f.id === "head").intent.pan);
  const soft = frame({ bar: 5, beat: 1.5 }, plan, CTX), pumped = frame({ bar: 6, beat: 1.5 }, plan, CTX);
  ok("a deeper pump drops the floor between hits (a harder hit)", g(pumped, "par_8").level < g(soft, "par_8").level, `${g(pumped, "par_8").level} vs ${g(soft, "par_8").level}`);
  const dull = frame({ bar: 7, beat: 1 }, plan, CTX), bright = frame({ bar: 8, beat: 1 }, plan, CTX);
  ok("a bright bar whitens the colour", g(bright, "par_8").colour[1] > g(dull, "par_8").colour[1], `${g(bright, "par_8").colour} vs ${g(dull, "par_8").colour}`);
  ok("the strobe accent fires while the drums are in", g(dull, "par_8").strobe > 0);
  ok("the strobe accent stays quiet on a bar where the drums are out", !g(bright, "par_8").strobe);
  ok("a vocal bar lifts the head", g(bright, "head").level > g(dull, "head").level, `${g(bright, "head").level} vs ${g(dull, "head").level}`);
  ok("a null lane bar renders like the neutral middle", near(g(frame({ bar: 5, beat: 1 }, plan, CTX), "par_1").level, g(frame({ bar: 3, beat: 1 }, plan, CTX), "par_1").level, 0.01));
}

/* ---- harmony tints the colour bar by bar -------------------------------------- */
{
  const harmony = { from_bar: 1, hue: [0.0, 0.5, 0.5, null], minor: [false, false, true, null], sure: [0.9, 0.9, 0.9, 0.9], key: { hue: 0, minor: false } };
  const plan = P([], { harmony });
  const c1 = g(frame({ bar: 1, beat: 1 }, plan, CTX), "par_1").colour, c2 = g(frame({ bar: 2, beat: 1 }, plan, CTX), "par_1").colour;
  ok("bars with different chords get different PAR colours", JSON.stringify(c1) !== JSON.stringify(c2), `${c1} vs ${c2}`);
  ok("the colour stays a saturated [r,g,b]", c2.length === 3 && Math.max(...c2) > 0.9 && Math.min(...c2) < 0.3, `${c2}`);
  const c4 = g(frame({ bar: 4, beat: 1 }, plan, CTX), "par_1").colour;
  ok("a bar with no chord keeps the gesture's own colour", JSON.stringify(c4) === JSON.stringify([1, 0, 0]));
  const unsure = P([], { harmony: { ...harmony, sure: [0, 0, 0, 0] } });
  ok("an unconfident chord does not tint", JSON.stringify(g(frame({ bar: 2, beat: 1 }, unsure, CTX), "par_1").colour) === JSON.stringify([1, 0, 0]));
  const c3 = g(frame({ bar: 3, beat: 1 }, plan, CTX), "par_1").colour;
  ok("a minor chord is a shade darker than the same major", Math.max(...c3) < Math.max(...c2), `${c3} vs ${c2}`);
  ok("without harmony the colour is the gesture's (today's behaviour)", JSON.stringify(g(frame({ bar: 2, beat: 1 }, P(), CTX), "par_1").colour) === JSON.stringify([1, 0, 0]));
}


/* ---- pace: the PAR patterns run at half, normal or double time per bar --------
   plan.lanes.subdiv is events-per-beat (0.5 / 1 / 2). It scales only the PAR
   pattern clocks (hits, trades, chases, breath); the head keeps its own motion
   knob and the strobe accent stays on the real downbeat. Absent -> 1 -> today. */
{
  const LIB2 = { ...LIB,
    trade_x: { id: "trade_x", kind: "individual", gesture: { pattern: "inner_outer_alternation", group: "all_pars",
      keys: [{ at: 0, target: "inner", intent: { level: 0.9, colour: [1, 0, 0] } }, { at: 0, target: "outer", intent: { level: 0 } },
             { at: 1, target: "inner", intent: { level: 0 } }, { at: 1, target: "outer", intent: { level: 0.9, colour: [0, 0, 1] } }] } },
    chase_x: { id: "chase_x", kind: "individual", gesture: { group: "arc", direction: "L2R", keys: [{ intent: { colour: [0, 1, 0], level: 0.9 } }] } },
  };
  const C2 = { layout: RIG, library: LIB2 };
  const sub = (k, seq) => ({ grid: { beats_per_bar: 4 }, lanes: { from_bar: 1, subdiv: [k, k, k, k] },
    assignments: [{ from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, seq_id: seq || "hold_x", layer: "par", priority: 0,
                    params: { floor: 0.2, peak: 1, mode: "hit", intensity: 1 } }, headA(),
                  { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, type: "accent_strobe", priority: 2, params: { strength: 0.8 } }] });
  /* double time: a hit lands on the half-beat too */
  ok("at double time a hit spikes on the half-beat", near(g(frame({ bar: 1, beat: 1.5 }, sub(2), C2), "par_1").level, 1, 0.02), `${g(frame({ bar: 1, beat: 1.5 }, sub(2), C2), "par_1").level}`);
  ok("at normal time the half-beat sits at the floor", near(g(frame({ bar: 1, beat: 1.5 }, sub(1), C2), "par_1").level, 0.2, 0.02));
  /* half time: only every other beat hits */
  ok("at half time beat 2 is not a hit", near(g(frame({ bar: 1, beat: 2 }, sub(0.5), C2), "par_1").level, 0.2, 0.02), `${g(frame({ bar: 1, beat: 2 }, sub(0.5), C2), "par_1").level}`);
  ok("at half time beat 3 is a hit", near(g(frame({ bar: 1, beat: 3 }, sub(0.5), C2), "par_1").level, 1, 0.02));
  /* the trade flips sides per step */
  const t1 = frame({ bar: 1, beat: 1 }, sub(2, "trade_x"), C2), t15 = frame({ bar: 1, beat: 1.5 }, sub(2, "trade_x"), C2);
  ok("at double time the pair trades sides on the half-beat",
     g(t1, "par_8").level > 0 && g(t1, "par_1").level === 0 && g(t15, "par_1").level > 0 && g(t15, "par_8").level === 0,
     `${g(t1, "par_8").level}/${g(t1, "par_1").level} -> ${g(t15, "par_1").level}/${g(t15, "par_8").level}`);
  const h1 = frame({ bar: 1, beat: 1 }, sub(0.5, "trade_x"), C2), h2 = frame({ bar: 1, beat: 2 }, sub(0.5, "trade_x"), C2), h3 = frame({ bar: 1, beat: 3 }, sub(0.5, "trade_x"), C2);
  ok("at half time the pair holds a side for two beats", g(h1, "par_8").level > 0 && g(h2, "par_8").level > 0 && g(h3, "par_8").level === 0);
  /* the chase steps a seat per step */
  const lit = F => RIG.fixtures.filter(f => f.type === "par7").findIndex(f => g(F, f.id).level > 0.5);
  ok("at double time the chase moves a seat every half-beat",
     lit(frame({ bar: 1, beat: 1 }, sub(2, "chase_x"), C2)) !== lit(frame({ bar: 1, beat: 1.5 }, sub(2, "chase_x"), C2)));
  ok("at normal time the chase holds its seat through the beat",
     lit(frame({ bar: 1, beat: 1 }, sub(1, "chase_x"), C2)) === lit(frame({ bar: 1, beat: 1.5 }, sub(1, "chase_x"), C2)));
  /* breath slows with the pace */
  const br = k => ({ ...sub(k), assignments: [{ from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0,
    params: { floor: 0.2, peak: 1, mode: "breathe", intensity: 1 } }] });
  ok("at normal time the breath repeats every bar",
     near(g(frame({ bar: 1, beat: 3 }, br(1), C2), "par_1").level, g(frame({ bar: 2, beat: 3 }, br(1), C2), "par_1").level, 0.01));
  ok("at half time the breath takes two bars",
     !near(g(frame({ bar: 1, beat: 3 }, br(0.5), C2), "par_1").level, g(frame({ bar: 2, beat: 3 }, br(0.5), C2), "par_1").level, 0.05),
     `${g(frame({ bar: 1, beat: 3 }, br(0.5), C2), "par_1").level} vs ${g(frame({ bar: 2, beat: 3 }, br(0.5), C2), "par_1").level}`);
  /* what the subdivision leaves alone */
  ok("the head's sweep does not change with the PAR subdivision",
     g(frame({ bar: 1, beat: 2.3 }, sub(2), C2), "head").pan === g(frame({ bar: 1, beat: 2.3 }, sub(1), C2), "head").pan);
  ok("the strobe accent still fires only on the real downbeat",
     g(frame({ bar: 1, beat: 1 }, sub(2), C2), "par_1").strobe > 0 && !g(frame({ bar: 1, beat: 1.5 }, sub(2), C2), "par_1").strobe && !g(frame({ bar: 1, beat: 2 }, sub(2), C2), "par_1").strobe);
  ok("a null subdiv bar runs at normal time",
     JSON.stringify(frame({ bar: 1, beat: 1.5 }, { ...sub(1), lanes: { from_bar: 1, subdiv: [null] } }, C2)) === JSON.stringify(frame({ bar: 1, beat: 1.5 }, sub(1), C2)));
}


/* ---- the head follows its gesture's keyframes -----------------------------------
   Keys carry pan/tilt (and colour/gobo/prism) at `at` beats; the head eases through
   them, looping, at 0.5 + motion path beats per musical beat (as long as the path
   stays under the wire cap of half the travel per beat). At motion 0.3 this path is
   followed exactly as written: its spans exceed the extent and its slope is under
   the cap. Tilt moves. A one-position gesture is never still. */
{
  const LIB3 = { ...LIB,
    path_x: { id: "path_x", kind: "individual", gesture: { group: "head", repeat: "loop", keys: [
      { at: 0, intent: { pan: 0.3, tilt: 0.4, colour: "red", level: 0.9 } },
      { at: 2, intent: { pan: 0.7, tilt: 0.6, colour: "blue" } },
      { at: 4, intent: { pan: 0.3, tilt: 0.4 } } ] } },
  };
  const C3 = { layout: RIG, library: LIB3 };
  const headP = (motion) => ({ grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "path_x", layer: "head", priority: 1, params: { headDim: 0.8, motion } }] });
  const H = (bar, beat, motion) => g(frame({ bar, beat }, headP(motion == null ? 0.3 : motion), C3), "head");
  const atBeat = pathBeats => 1 + pathBeats / 0.8;          // bar-1 beat for a path time at motion 0.3
  ok("at the first key the head is at the first pose", near(H(1, 1).pan, 0.3, 0.02) && near(H(1, 1).tilt, 0.4, 0.02), `${H(1, 1).pan}/${H(1, 1).tilt}`);
  ok("at the second key it has reached the second pose (tilt moved too)",
     near(H(1, atBeat(2)).pan, 0.7, 0.02) && near(H(1, atBeat(2)).tilt, 0.6, 0.02), `${H(1, atBeat(2)).pan}/${H(1, atBeat(2)).tilt}`);
  ok("halfway between keys it is between the poses",
     H(1, atBeat(1)).pan > 0.35 && H(1, atBeat(1)).pan < 0.65 && H(1, atBeat(1)).tilt > 0.42 && H(1, atBeat(1)).tilt < 0.58, `${H(1, atBeat(1)).pan}/${H(1, atBeat(1)).tilt}`);
  ok("the path loops: a loop later it is back at the first pose", near(H(2, 2).pan, 0.3, 0.02) && near(H(2, 2).tilt, 0.4, 0.02), `${H(2, 2).pan}/${H(2, 2).tilt}`);
  /* the blue key falls at path time 2 = beat 3.5; the wheel waits for the next beat */
  ok("a discrete attribute steps at its key, on the beat: red then blue",
     H(1, 1).colour === "red" && H(1, 3.5).colour === "red" && H(1, 4).colour === "blue", `${H(1, 1).colour} ${H(1, 3.5).colour} ${H(1, 4).colour}`);
  /* more motion: a faster head, up to the wire cap */
  const maxStep = motion => { let mx = 0; for (let b = 1; b <= 8; b++) for (let q = 1; q <= 4; q++) {
    const a = H(b, q, motion), z = H(b, q + 0.999, motion); mx = Math.max(mx, Math.abs(z.pan - a.pan) + Math.abs(z.tilt - a.tilt)); } return mx; };
  ok("more motion moves the head further within a beat", maxStep(1.0) > maxStep(0.3), `${maxStep(1.0).toFixed(3)} vs ${maxStep(0.3).toFixed(3)}`);
  ok("a tilt kick on the beat lifts the tilt above the path a half-beat later (lively only)",
     H(1, 1, 1.0).tilt > H(1, 1.5, 1.0).tilt && !(H(1, 1, 0.3).tilt > H(1, 1.5, 0.3).tilt + 0.05), `${H(1, 1, 1.0).tilt} vs ${H(1, 1.5, 1.0).tilt}`);
  /* a single-position gesture keeps a default figure so the head is never still */
  const one = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.8, motion: 0.5 } }] };
  ok("a one-key gesture still sweeps", g(frame({ bar: 1, beat: 1 }, one, CTX), "head").pan !== g(frame({ bar: 1, beat: 2 }, one, CTX), "head").pan);
  ok("the head path is deterministic", JSON.stringify(H(3, 2.5)) === JSON.stringify(H(3, 2.5)));
}

/* ---- the PAR layer never drives the head; overrides never re-aim it -----------
   `strobers` is every fixture that can strobe, head included, so a PAR-layer
   strobe gesture used to put strobe AND level on the head. A par-layer look owns
   pars only. And a blackout or blast is about light, not aim: the head keeps the
   pose its own look gave it, so the wire never lurches to pan 0 / tilt 0. */
{
  const LIB4 = { ...LIB,
    strobe_x: { id: "strobe_x", kind: "individual", gesture: { group: "strobers", keys: [{ at: 0, intent: { strobe: 1, level: 1 } }] } },
    path_y: { id: "path_y", kind: "individual", gesture: { group: "head", repeat: "loop", keys: [
      { at: 0, intent: { pan: 0.2, tilt: 0.3, colour: "red" } }, { at: 2, intent: { pan: 0.8, tilt: 0.7 } }, { at: 4, intent: { pan: 0.2, tilt: 0.3 } } ] } },
  };
  const C4 = { layout: RIG, library: LIB4 };
  const plan = (extra) => ({ grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "strobe_x", layer: "par", priority: 0, params: { floor: 0.2, peak: 1, mode: "hit", intensity: 1 } },
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "path_y", layer: "head", priority: 1, params: { headDim: 0.8, motion: 0.5 } },
    ...(extra || []) ] });
  const F = frame({ bar: 1, beat: 1 }, plan(), C4);
  ok("a PAR-layer strobe gesture does not strobe the head", g(F, "head").strobe == null, JSON.stringify(g(F, "head")));
  ok("a PAR-layer gesture does not set the head's level (the head layer does)", near(g(F, "head").level, 0.8, 0.01), `${g(F, "head").level}`);
  ok("the pars still get the strobe gesture", g(F, "par_1").strobe > 0);
  const pose = frame({ bar: 1, beat: 3 }, plan(), C4);
  const black = frame({ bar: 1, beat: 3 }, plan([{ from: { bar: 1, beat: 3 }, to: { bar: 1, beat: 4 }, type: "blackout", priority: 9 }]), C4);
  ok("a blackout keeps the head's pose while darkening it",
     g(black, "head").level === 0 && g(black, "head").pan === g(pose, "head").pan && g(black, "head").tilt === g(pose, "head").tilt, JSON.stringify(g(black, "head")));
  ok("a blackout still takes every fixture dark", black.fixtures.every(f => f.intent.level === 0));
  const blast = frame({ bar: 1, beat: 3 }, plan([{ from: { bar: 1, beat: 3 }, to: { bar: 1, beat: 4 }, type: "white_blast", priority: 9, params: { strength: 0.8 } }]), C4);
  ok("a blast keeps the head's pose while firing it white",
     g(blast, "head").level === 0.9 && g(blast, "head").colour === "white" && g(blast, "head").pan === g(pose, "head").pan && g(blast, "head").tilt === g(pose, "head").tilt, JSON.stringify(g(blast, "head")));
  /* item 5: a HEAVY hit (an entrance, weight .9+) snaps the head to centre with the
     prism open -- a deliberate move of at most a few frames inside the aim window */
  const heavy = frame({ bar: 1, beat: 3 }, plan([{ from: { bar: 1, beat: 3 }, to: { bar: 1, beat: 4 }, type: "white_blast", priority: 9, params: { strength: 0.97 } }]), C4);
  ok("a heavy entrance snaps the head to centre with the prism open",
     g(heavy, "head").pan === 0.5 && g(heavy, "head").tilt === 0.5 && g(heavy, "head").prism === true && g(heavy, "head").level > 0.98, JSON.stringify(g(heavy, "head")));
  /* item 5: a pause parks the head low and dim */
  const paused = frame({ bar: 1, beat: 3 }, plan([{ from: { bar: 1, beat: 3 }, to: { bar: 2, beat: 3 }, type: "pause", priority: 8, params: { strength: 0.6, still: ["bass"] } }]), C4);
  ok("a pause parks the head low (tilt toward the wall spot)", g(paused, "head").tilt <= 0.1 && g(pose, "head").tilt > 0.3, `${g(paused, "head").tilt} vs ${g(pose, "head").tilt}`);
  ok("a pause dims the head", g(paused, "head").level < g(pose, "head").level);
}

/* ---- item 4: the colour wheel steps on the musical beat, never mid-beat -----------
   The wheel is mechanical; a change is hidden by the hit on the beat, so a key that
   falls between beats (motion != 0.5 stretches the path) waits for the next beat.
   And a head with no colour of its own asks for white, not wheel position 0. */
{
  const LIB5 = { ...LIB,
    step_x: { id: "step_x", kind: "individual", gesture: { group: "head", repeat: "loop", keys: [
      { at: 0, intent: { pan: 0.3, tilt: 0.4, colour: "red" } }, { at: 1, intent: { pan: 0.7, colour: "blue" } }, { at: 2, intent: { pan: 0.3, colour: "red" } } ] } },
    bare_x: { id: "bare_x", kind: "individual", gesture: { group: "head", keys: [{ at: 0, intent: { pan: 0.4, tilt: 0.4 } }, { at: 2, intent: { pan: 0.6 } }] } },
  };
  const C5 = { layout: RIG, library: LIB5 };
  const hp = (seq, motion) => ({ grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: seq, layer: "head", priority: 1, params: { headDim: 0.8, motion } }] });
  /* the path clock is stretched by motion and by the wire's travel cap, so the blue
     key generally falls between beats; the wheel must still only change ON a beat */
  const c = (bar, beat) => g(frame({ bar, beat }, hp("step_x", 1.0), C5), "head").colour;
  const beats = []; for (let b = 1; b <= 8; b++) for (let k = 1; k <= 4; k++) beats.push([b, k]);
  ok("the wheel never changes inside a beat", beats.every(([b, k]) => c(b, k + 0.01) === c(b, k + 0.99)),
     beats.filter(([b, k]) => c(b, k + 0.01) !== c(b, k + 0.99)).map(([b, k]) => `${b}.${k}`).join(","));
  const seen = new Set(beats.map(([b, k]) => c(b, k)));
  ok("and it does step through the gesture's colours over the phrase", seen.has("red") && seen.has("blue"), [...seen].join(","));
  ok("the first beat wears the first key's colour", c(1, 1) === "red");
  ok("the pan still eases continuously between keys (only discrete attributes wait)",
     g(frame({ bar: 1, beat: 1.7 }, hp("step_x", 1.0), C5), "head").pan !== g(frame({ bar: 1, beat: 1 }, hp("step_x", 1.0), C5), "head").pan);
  ok("a head gesture with no colour asks for white", g(frame({ bar: 1, beat: 1 }, hp("bare_x", 0.5), C5), "head").colour === "white");
}




/* ---- the head uses the whole room, scaled by musical energy -----------------------
   The palette's head gestures are timid (pan .3-.7, tilt .42-.55). Motion sets the
   EXTENT a path is stretched to about its own centre: a drift near the wall in an
   intro, the full 540/180-degree travel in a drop. Beat-scale moves are capped at
   what the wire can follow (half the travel per beat), by slowing the path clock
   rather than letting the head lag. A one-position gesture roams the room too. */
{
  const LIB6 = { ...LIB,
    timid: { id: "timid", kind: "individual", gesture: { group: "head", repeat: "loop", keys: [
      { at: 0, intent: { pan: 0.45, tilt: 0.48, colour: "blue" } }, { at: 8, intent: { pan: 0.55, tilt: 0.52 } }, { at: 16, intent: { pan: 0.45, tilt: 0.48 } } ] } },
    fast: { id: "fast", kind: "individual", gesture: { group: "head", repeat: "loop", keys: [
      { at: 0, intent: { pan: 0.2, tilt: 0.3 } }, { at: 1, intent: { pan: 0.8, tilt: 0.7 } }, { at: 2, intent: { pan: 0.4, tilt: 0.2 } }, { at: 3, intent: { pan: 0.6, tilt: 0.8 } } ] } },
    one: { id: "one", kind: "individual", gesture: { group: "head", keys: [{ at: 0, intent: { pan: 0.5, tilt: 0.5, colour: "white" } }] } },
  };
  const C6 = { layout: RIG, library: LIB6 };
  const hp = (seq, motion) => ({ grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 33, beat: 1 }, seq_id: seq, layer: "head", priority: 1, params: { headDim: 0.8, motion } }] });
  const sweep = (seq, motion, bars) => {
    const pans = [], tilts = [];
    for (let b = 1; b <= bars; b++) for (let q = 1; q < 5; q += 0.25) { const h = g(frame({ bar: b, beat: q }, hp(seq, motion), C6), "head"); pans.push(h.pan); tilts.push(h.tilt); }
    return { pan: Math.max(...pans) - Math.min(...pans), tilt: Math.max(...tilts) - Math.min(...tilts), pans, tilts };
  };
  const calm = sweep("timid", 0.3, 16), wild = sweep("timid", 1.0, 16);
  ok("at low motion a timid roam stays a drift near the wall", calm.pan < 0.5 && calm.tilt < 0.5, `pan ${calm.pan.toFixed(2)} tilt ${calm.tilt.toFixed(2)}`);
  ok("at full motion the same roam becomes room-wide", wild.pan >= 0.7 && wild.tilt >= 0.7, `pan ${wild.pan.toFixed(2)} tilt ${wild.tilt.toFixed(2)}`);
  ok("the roam still passes through the wall (0.5) on its way", wild.pans.some(v => Math.abs(v - 0.5) < 0.08));
  /* the wire cap: never more than half the travel per beat, whatever the gesture asks */
  const perBeat = (seq, motion) => { let mx = 0; for (let b = 1; b <= 8; b++) for (let q = 1; q <= 4; q++) {
    const a = g(frame({ bar: b, beat: q }, hp(seq, motion), C6), "head"), z = g(frame({ bar: b, beat: q + 0.999 }, hp(seq, motion), C6), "head");
    mx = Math.max(mx, Math.abs(z.pan - a.pan) + Math.abs(z.tilt - a.tilt)); } return mx; };
  ok("a beat-scale gesture at full motion never asks for more than half the travel per beat", perBeat("fast", 1.0) <= 0.5 + 0.13, `${perBeat("fast", 1.0).toFixed(3)} (tilt kick allowed)`);
  ok("the fast gesture still reaches most of the room", sweep("fast", 1.0, 16).pan >= 0.7);
  /* an axis the gesture holds still (a pan-only sweep) still takes the room figure,
     scaled by motion, so tilt is never dead in a drop */
  const LIB7 = { ...LIB6, panonly: { id: "panonly", kind: "individual", gesture: { group: "head", repeat: "loop", keys: [
    { at: 0, intent: { pan: 0.1, tilt: 0.5, colour: "white" } }, { at: 4, intent: { pan: 0.9 } }, { at: 8, intent: { pan: 0.1 } } ] } } };
  const sweep7 = (motion) => { const tilts = []; for (let b = 1; b <= 12; b++) for (let q = 1; q < 5; q += 0.5)
    tilts.push(g(frame({ bar: b, beat: q }, hp("panonly", motion), { layout: RIG, library: LIB7 }), "head").tilt); return Math.max(...tilts) - Math.min(...tilts); };
  ok("a pan-only sweep at full motion still moves its tilt through the room", sweep7(1.0) >= 0.5, `${sweep7(1.0).toFixed(2)}`);
  ok("and at low motion its tilt only drifts", sweep7(0.3) < 0.25, `${sweep7(0.3).toFixed(2)}`);
  /* a single pose is not a parked head */
  const solo = sweep("one", 0.8, 12);
  ok("a one-position gesture roams the room over bars (pan and tilt)", solo.pan >= 0.5 && solo.tilt >= 0.3, `pan ${solo.pan.toFixed(2)} tilt ${solo.tilt.toFixed(2)}`);
  ok("and at low motion it only drifts", sweep("one", 0.3, 12).pan < 0.5);
}


/* ---- the level curve passes through every PAR path -------------------------------
   In breathe mode an alternating or chasing look must breathe like a wash: the
   active lamps follow the curve and the resting ones sit at the floor. In hit mode
   the trade stays crisp (active held, off dark) -- the rig review asked for that. */
{
  const LIB8 = { ...LIB,
    trade_y: { id: "trade_y", kind: "individual", gesture: { pattern: "inner_outer_alternation", group: "all_pars",
      keys: [{ at: 0, target: "inner", intent: { level: 0.9, colour: [1, 0, 0] } }, { at: 0, target: "outer", intent: { level: 0 } },
             { at: 1, target: "inner", intent: { level: 0 } }, { at: 1, target: "outer", intent: { level: 0.9, colour: [0, 0, 1] } }] } },
    chase_y: { id: "chase_y", kind: "individual", gesture: { group: "arc", direction: "L2R", keys: [{ intent: { colour: [0, 1, 0], level: 0.9 } }] } },
  };
  const C8 = { layout: RIG, library: LIB8 };
  const pl = (seq, mode) => ({ grid: { beats_per_bar: 4 }, assignments: [{ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: seq, layer: "par", priority: 0,
    params: { floor: 0.08, peak: 0.35, mode, intensity: 1 } }] });
  const lit = (F) => Math.max(...RIG.fixtures.filter(f => f.type === "par7").map(f => g(F, f.id).level));
  const trace = (seq, mode) => [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5].map(b => lit(frame({ bar: 1, beat: b }, pl(seq, mode), C8)));
  const wash = trace("hold_x", "breathe"), trade = trace("trade_y", "breathe"), chase = trace("chase_y", "breathe");
  const near2 = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.02);
  ok("a breathing trade follows the same curve as a breathing wash", near2(trade, wash), `${trade} vs ${wash}`);
  ok("a breathing chase follows it too", near2(chase, wash), `${chase} vs ${wash}`);
  ok("the breathing trade's resting pair sits at the floor, not dark",
     g(frame({ bar: 1, beat: 1.5 }, pl("trade_y", "breathe"), C8), "par_1").level >= 0.07 && g(frame({ bar: 1, beat: 1.5 }, pl("trade_y", "breathe"), C8), "par_1").level <= 0.09);
  const hitTrade = frame({ bar: 1, beat: 1.6 }, pl("trade_y", "hit"), C8);
  ok("a hit-mode trade stays crisp: active pair held, off pair dark", g(hitTrade, "par_8").level === 0.35 && g(hitTrade, "par_1").level === 0);
}

/* ---- growth and tension ride on the level and the head ------------------------- */
{
  const base = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params: { floor: 0.3, peak: 1, mode: "hit", intensity: 1 } });
  const head = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.8, motion: 0.5 } });
  const P = (more) => ({ grid: { beats_per_bar: 4 }, assignments: [base(), head()], ...more });
  const low = frame({ bar: 1, beat: 1.5 }, P({ lanes: { from_bar: 1, grow: [0, 1] } }), CTX), high = frame({ bar: 2, beat: 1.5 }, P({ lanes: { from_bar: 1, grow: [0, 1] } }), CTX);
  ok("a growing section is brighter at its end than its start", g(high, "par_1").level > g(low, "par_1").level, `${g(low, "par_1").level} -> ${g(high, "par_1").level}`);
  const tLow = frame({ bar: 1, beat: 1.5 }, P({ tension: { from_bar: 1, values: [0, 0, 0, 0, 1, 1, 1, 1] } }), CTX), tHigh = frame({ bar: 2, beat: 1.5 }, P({ tension: { from_bar: 1, values: [0, 0, 0, 0, 1, 1, 1, 1] } }), CTX);
  ok("high tension lifts the level between hits", g(tHigh, "par_1").level > g(tLow, "par_1").level, `${g(tLow, "par_1").level} -> ${g(tHigh, "par_1").level}`);
  ok("high tension moves the head faster", g(frame({ bar: 2, beat: 2.3 }, P({ tension: { from_bar: 1, values: [0, 0, 0, 0, 1, 1, 1, 1] } }), CTX), "head").pan !== g(frame({ bar: 2, beat: 2.3 }, P(), CTX), "head").pan);
  ok("no tension, no change", JSON.stringify(frame({ bar: 1, beat: 1.5 }, P(), CTX)) === JSON.stringify(frame({ bar: 1, beat: 1.5 }, P({ tension: null }), CTX)));
}


/* ---- a ramp grows to full over its span ----------------------------------------- */
{
  const base = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params: { floor: 0.3, peak: 1, mode: "hit", intensity: 1 } });
  const head = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.8, motion: 0.5 } });
  const P = (extra) => ({ grid: { beats_per_bar: 4 }, assignments: [base(), head(), ...(extra || [])] });
  const ramp = { from: { bar: 2, beat: 1 }, to: { bar: 3, beat: 1 }, type: "ramp", layer: "modulate", priority: 4, params: { weight: 1 } };
  const plain = g(frame({ bar: 2, beat: 1.5 }, P(), CTX), "par_1").level;
  ok("at the start of a ramp nothing has grown yet", near(g(frame({ bar: 2, beat: 1.5 }, P([ramp]), CTX), "par_1").level, plain * (1 + 0.35 * 0.125), 0.01));
  ok("near the end of the ramp the level has grown by a third", near(g(frame({ bar: 2, beat: 4.9 }, P([ramp]), CTX), "par_1").level, plain * (1 + 0.35 * 0.975), 0.01), `${g(frame({ bar: 2, beat: 4.9 }, P([ramp]), CTX), "par_1").level} vs ${plain}`);
  ok("the head moves faster at the end of a ramp", g(frame({ bar: 2, beat: 4.3 }, P([ramp]), CTX), "head").pan !== g(frame({ bar: 2, beat: 4.3 }, P(), CTX), "head").pan);
  ok("after the ramp the base is back", g(frame({ bar: 3, beat: 1.5 }, P([ramp]), CTX), "par_1").level === plain);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
