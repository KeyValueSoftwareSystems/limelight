"use strict";
const H = require("./helpers");

/* stab — partial hit GESTURE. Only the extent's pars flash (hitEnv), and the
   head does a quick snap to an off-centre pose and back. Not the whole rig. */
module.exports = function stab(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.7, 0.3]);
  const extent = params.extent || "inner";
  const pars = H.parsForExtent(extent);
  const forBeats = params.for_beats || 1;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  /* deterministic "snap" target, nudged by the colour so repeated stabs vary */
  const j = (colour[0] * 0.3 + colour[2] * 0.7) % 1;
  const panTo = 0.30 + 0.40 * j;
  const tiltTo = 0.20 + 0.30 * ((colour[1] * 0.6 + 0.2) % 1);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const env = H.hitEnv(i / N);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, colour, env);
    H.setHead(f, H.HEADS[0], {
      level: env, colour,
      pan: 0.662 + (panTo - 0.662) * env,     // snap out on the attack, ease back
      tilt: 0.498 + (tiltTo - 0.498) * env,
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS),
  };
};
