"use strict";
const H = require("./helpers");

/* impact — full-rig flash GESTURE. Sharp attack, hard decay (hitEnv). Every par
   to max, head to max, a burst of strobe and prism on the front of the hit, head
   heading for centre. */
module.exports = function impact(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);
  const forBeats = params.for_beats || 2;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const env = H.hitEnv(i / N);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, colour, env);
    for (const b of H.BLINDS) H.setBlinder(f, b, env);
    if (params.head !== false) H.setHeadsMirror(f, {
      level: env, colour,
      pan: 0.662, tilt: 0.498,                 // snap toward the wall centre
      strobe: i < 2 ? 15 : 0,                  // strobe burst on the very front
      prism: i < 4 ? 100 : 0,                  // six-facet prism kicks then off
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: (params.head === false ? pars.map(p => p.id) : pars.map(p => p.id).concat(H.HEAD_IDS))
      .concat(H.BLINDS.map(b => b.id)),
  };
};
