"use strict";
const H = require("./helpers");

/* gear — rate shift GESTURE. A pulsing pattern at the new rate (to/from times the
   feel): the pars pulse on a sine, the head oscillates its pan faster than the
   pars. This is a rhythm change, so it LOOPS — the frames tile a short window. */
module.exports = function gear(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const from = params.from > 0 ? params.from : 1;
  const to = params.to > 0 ? params.to : 2;
  const rate = to / from;                          // pulses per beat, roughly
  const colour = H.parseColour(params.colour, [0.9, 0.6, 0.3]);

  const loopBeats = 2;
  const pulses = Math.max(1, Math.round(rate * loopBeats));   // whole pulses so it tiles cleanly
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const p = i / N;
    const pulse = 0.5 - 0.5 * Math.cos(2 * Math.PI * p * pulses);   // 0..1 on the beat rate
    const level = 0.25 + 0.6 * pulse;
    const f = H.emptyFrame();
    for (const par of H.PARS) H.setPar(f, par, colour, level);
    if (params.head !== false) H.setHeadsMirror(f, {
      level: 0.3 + 0.4 * pulse, colour,
      pan: 0.60 + 0.20 * Math.sin(2 * Math.PI * p * pulses * 1.5),  // head runs faster than the pars
      tilt: 0.34 + 0.10 * Math.sin(2 * Math.PI * p * pulses),
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: loopBeats,
    per_fixture: H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS),
  };
};
