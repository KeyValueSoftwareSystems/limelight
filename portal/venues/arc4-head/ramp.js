"use strict";
const H = require("./helpers");

/* ramp — rising build GESTURE across a span. Pars climb from near-black to `to`,
   the colour warms toward amber as it rises, and the head opens up: pan starts
   narrow at centre and widens into a full sweep, tilt lifts. Tension building.
   Span length is set by the baker; the frames stretch across it. */
module.exports = function ramp(params, ctx) {
  const to = params.to != null ? params.to : 0.3;
  const ease = H.easeCurve(params.curve || "ease");
  const cool = H.parseColour(params.colour, [0.3, 0.4, 0.8]);
  const amber = [1, 0.5, 0.1];
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * 8);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const e = ease(t);
    const level = 0.02 + (to - 0.02) * e;
    const c = [cool[0] + (amber[0] - cool[0]) * e,
               cool[1] + (amber[1] - cool[1]) * e,
               cool[2] + (amber[2] - cool[2]) * e];
    const f = H.emptyFrame();
    for (const par of H.PARS) H.setPar(f, par, c, level);
    H.setHead(f, H.HEADS[0], {
      level: level * 0.8, colour: c,
      pan: 0.662 + 0.20 * e * Math.sin(2 * Math.PI * t * 2),   // narrow -> wide sweep
      tilt: 0.498 + (0.30 - 0.498) * e,                        // lifts toward the room
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
