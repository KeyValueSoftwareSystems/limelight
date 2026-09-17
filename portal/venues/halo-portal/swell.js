"use strict";
const H = require("./helpers");

/* swell — bloom GESTURE. The whole rig rises to a peak then falls (swellEnv). The
   head level follows the same envelope, and its tilt sweeps up on the rise and
   back down on the fall. Head colour matches the pars. A soft entrance. */
module.exports = function swell(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.6, 0.25]);
  const forBeats = params.for_beats || 4;
  const rise = params.rise != null ? params.rise : 0.4;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const env = H.swellEnv(i / N, rise);      // 0 -> 1 over `rise`, then 1 -> 0
    const f = H.emptyFrame();
    for (const par of H.PARS) H.setPar(f, par, colour, env);
    H.setHeadsMirror(f, {
      level: env, colour,
      pan: 0.60 + 0.10 * Math.sin(2 * Math.PI * (i / N)),
      tilt: 0.34 + 0.14 * env,                // rides up with the bloom, back down as it fades
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
