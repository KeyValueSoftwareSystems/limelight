"use strict";
const H = require("./helpers");

/* drone — low ambient STATE. Not a still frame: the pars breathe ±15% over four
   beats and the head nods its tilt gently at a low level. Loops every 4 beats. */
module.exports = function drone(params, ctx) {
  const amount = params.amount != null ? params.amount : 0.12;
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const extent = params.extent || "inner";
  const pars = H.parsForExtent(extent);

  const loopBeats = 4;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const p = i / N;                              // 0..1 over the loop
    const breath = 1 + 0.15 * Math.sin(2 * Math.PI * p);
    const f = H.emptyFrame();
    for (const par of H.PARS) {
      const inside = pars.some(q => q.id === par.id);
      H.setPar(f, par, colour, amount * breath * (inside ? 1 : 0.42));
    }
    // a slow tilt nod around centre (~±5 DMX), pan essentially parked
    H.setHead(f, H.HEADS[0], {
      level: amount * 0.5 * breath, colour,
      pan: 0.662,
      tilt: 0.498 + 0.02 * Math.sin(2 * Math.PI * p),
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: loopBeats,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
