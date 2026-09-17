"use strict";
const H = require("./helpers");
const GROUPS = ["outer", "inner", "left", "right"].map((e) => H.parsForExtent(e));

/* anticipation — a pre-show riser GESTURE: quick white strobes in a seeded,
   accelerating pattern that breaks into a frantic hardware-strobe finale. Ported
   from the desk rig; drives all four movers. Deterministic via a seeded PRNG. */
module.exports = function anticipation(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const level = params.intensity != null ? params.intensity : 1;
  const forBeats = params.for_beats || 8;
  const dur = ctx.duration_s > 0 ? ctx.duration_s : forBeats * 60 / ctx.bpm;
  const N = Math.max(2, Math.round(ctx.fps * dur));

  let s = (params.seed != null ? params.seed >>> 0 : 0x9e3779b9) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const heads = (f, lvl, strobe) => {
    if (params.head === false) return;
    for (const head of H.HEADS) H.setHead(f, head, { level: lvl, colour, pan: 0.5, tilt: 0.42, strobe: strobe || 0 });
  };

  const frames = [];
  let cooldown = 0;
  for (let i = 0; i < N; i++) {
    const p = N > 1 ? i / (N - 1) : 1;
    const f = H.emptyFrame();
    const finale = p > 0.88;

    if (finale) {
      for (const par of H.PARS) { H.setPar(f, par, colour, level); H.setParStrobe(f, par, 24); }
      heads(f, level, 25);
      frames.push(f);
      continue;
    }

    const prob = 0.18 + 0.5 * p;
    const minGap = Math.round((1 - p) * 5);
    let pop = false;
    if (cooldown <= 0 && rnd() < prob) { pop = true; cooldown = minGap + 1; } else { cooldown--; }

    if (pop) {
      const hit = rnd() > 0.35 ? H.PARS : GROUPS[Math.floor(rnd() * GROUPS.length) % GROUPS.length];
      for (const par of hit) H.setPar(f, par, colour, level);
      heads(f, level, 0);
    } else {
      const floor = p > 0.85 ? 0.06 : 0;
      if (floor) for (const par of H.PARS) H.setPar(f, par, colour, floor);
      heads(f, floor, 0);
    }
    frames.push(f);
  }

  return { frames, loop_beats: 0, per_fixture: H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS) };
};
