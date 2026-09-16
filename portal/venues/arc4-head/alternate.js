"use strict";
const H = require("./helpers");

module.exports = function alternate(params, ctx) {
  const fallback = (ctx && ctx.restColour) ? [ctx.restColour, [0.25, 0.45, 1]]
                                           : [[1, 0.75, 0.35], [0.25, 0.45, 1]];
  const cols = H.parseColours(params.colours, fallback);
  const level = params.level != null ? params.level : 0.8;
  const rest = params.rest != null ? params.rest : 0;
  const per = params.per_beat != null ? params.per_beat : 1;
  const loop = Math.max(1, Math.round(params.for_beats || 4));

  function at(step, gain) {
    const odd = Math.floor(step) % 2 === 1;
    const f = H.emptyFrame();
    H.PARS.forEach((p, k) => {
      const mine = (k % 2 === 0) !== odd;
      H.setPar(f, p, cols[k % 2 === 0 ? 0 : 1], (mine ? level : rest) * gain);
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.6 * gain, colour: cols[odd ? 1 : 0],
      pan: odd ? 0.58 : 0.74, tilt: 0.44,
    });
    return f;
  }

  function beatOf(t) {
    if (ctx && typeof ctx.beatAt === "function") {
      const b = ctx.beatAt(t);
      if (typeof b === "number" && isFinite(b)) return b;
    }
    return (t || 0) * ctx.bpm / 60;
  }

  function render(value, t) {
    const v = H.clamp(value == null ? 1 : value, 0, 1);
    return at(beatOf(t) * per, v);
  }

  const fpb = H.framesPerBeat(ctx.bpm);
  const N = Math.max(2, fpb * loop);
  const frames = [];
  for (let i = 0; i < N; i++) frames.push(at((i / fpb) * per, 1));

  return {
    binding: true, render, frames, loop_beats: loop,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
