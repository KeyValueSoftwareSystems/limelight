"use strict";
const H = require("./helpers");
const GROUPS = ["outer", "inner", "left", "right"].map((e) => H.parsForExtent(e));

/* anticipation — a pre-show riser GESTURE. Quick white strobes fire in a
   seemingly-random pattern that grows denser and faster as it runs, then breaks
   into a frantic hardware-strobe burst at the very end. Meant to sit right
   before a show/drop to build tension. Dark between pops so each one cuts.

   Deterministic: a seeded PRNG so the same placement bakes the same every time.
   Spans its own length via ctx.duration_s (falls back to for_beats). */
module.exports = function anticipation(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const level = params.intensity != null ? params.intensity : 1;
  const forBeats = params.for_beats || 8;
  const dur = ctx.duration_s > 0 ? ctx.duration_s : forBeats * 60 / ctx.bpm;
  const N = Math.max(2, Math.round(ctx.fps * dur));

  /* seeded PRNG (mulberry32) — reproducible "randomness" */
  let s = (params.seed != null ? params.seed >>> 0 : 0x9e3779b9) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const frames = [];
  let cooldown = 0;
  for (let i = 0; i < N; i++) {
    const p = N > 1 ? i / (N - 1) : 1;
    const f = H.emptyFrame();
    const finale = p > 0.88;                       // the last ~12% goes to a hard hardware strobe

    if (finale) {
      for (const par of H.PARS) { H.setPar(f, par, colour, level); H.setParStrobe(f, par, 24); }
      if (params.head !== false) H.setHeadsMirror(f, { level, colour, pan: 0.5, tilt: 0.45, strobe: 25 });
      frames.push(f);
      continue;
    }

    /* accelerating random pops: sporadic from the start, thickening steadily,
       back-to-back by the end. probability rises and the enforced gap shrinks. */
    const prob = 0.18 + 0.5 * p;
    const minGap = Math.round((1 - p) * 5);        // ~5 frames apart early, back-to-back late
    let pop = false;
    if (cooldown <= 0 && rnd() < prob) { pop = true; cooldown = minGap + 1; } else { cooldown--; }

    if (pop) {
      const hit = rnd() > 0.35 ? H.PARS : GROUPS[Math.floor(rnd() * GROUPS.length) % GROUPS.length];
      for (const par of hit) H.setPar(f, par, colour, level);
      if (params.head !== false) H.setHeadsMirror(f, { level, colour, pan: 0.5, tilt: 0.45 });
    } else {
      const floor = p > 0.85 ? 0.06 : 0;            // a faint glow just before the finale
      if (floor) for (const par of H.PARS) H.setPar(f, par, colour, floor);
      if (params.head !== false) H.setHeadsMirror(f, { level: floor, colour, pan: 0.5, tilt: 0.45 });
    }
    frames.push(f);
  }

  return { frames, loop_beats: 0, per_fixture: H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS) };
};
