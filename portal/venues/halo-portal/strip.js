"use strict";
const H = require("./helpers");

/* strip — controlled pullback GESTURE. The pars fall to `to` on a settle curve,
   the head dims and its tilt drops. Sequential: the OUTER pars begin to fall
   first, the INNER pars a beat later, so the rig empties from the edges in. */
module.exports = function strip(params, ctx) {
  const to = params.to != null ? params.to : 0.15;
  const overBeats = params.over_beats || 4;
  const colour = H.parseColour(params.colour, [0.8, 0.7, 0.5]);
  const start = 0.6;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * overBeats);
  const stagger = 0.35;                    // inner pars start this far into the fade

  const fadeLevel = (t, delay) => {
    const e = H.easeSettle(H.clamp((t - delay) / (1 - delay), 0, 1));
    return start + (to - start) * e;
  };

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const f = H.emptyFrame();
    for (const par of H.OUTER) H.setPar(f, par, colour, fadeLevel(t, 0));
    for (const par of H.INNER) H.setPar(f, par, colour, fadeLevel(t, stagger));
    const headLevel = fadeLevel(t, 0) * 0.6;
    H.setHead(f, H.HEADS[0], {
      level: headLevel, colour,
      pan: 0.60,
      tilt: 0.498 + (0.20 - 0.498) * H.easeSettle(t),   // tilt drops toward the floor
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
