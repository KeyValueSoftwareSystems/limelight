"use strict";
const H = require("./helpers");

/* wash — mid-level fill STATE. Alive, not static: the colour drifts ±10% and the
   head sweeps its pan slowly across the whole rig, once per 8-beat loop. */
module.exports = function wash(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const amount = params.amount != null ? params.amount : 0.55;
  const colour = H.parseColour(params.colour, [0.2, 0.4, 1]);
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);

  const loopBeats = 8;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const p = i / N;
    const drift = 1 + 0.10 * Math.sin(2 * Math.PI * p);
    const c = [colour[0] * drift, colour[1], colour[2] * (2 - drift)]; // warm/cool sway
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, c, amount);
    if (params.head !== false) H.setHead(f, H.HEADS[0], {
      level: amount * 0.7, colour: c,
      pan: 0.60 + 0.20 * Math.sin(2 * Math.PI * p),          // full pan sweep
      tilt: 0.30 + 0.14 * Math.sin(4 * Math.PI * p),          // gentle tilt weave
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: loopBeats,
    per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS),
  };
};
