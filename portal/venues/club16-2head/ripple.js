"use strict";
const H = require("./helpers");
module.exports = function ripple(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const level = params.level != null ? params.level : 0.85;
  const rest = params.rest != null ? params.rest : 0.15;
  const width = params.width != null ? params.width : 1.2;
  const loop = Math.max(1, Math.round(params.for_beats || 4));
  const N = Math.max(4, H.framesPerBeat(ctx.bpm) * loop);
  const n = H.PARS.length;
  const frames = [];
  for (let i = 0; i < N; i++) {
    const head = (i / N) * (n + width * 2) - width;
    const f = H.emptyFrame();
    H.PARS.forEach((p, k) => {
      const d = Math.abs(k - head);
      const g = Math.max(0, 1 - (d / width) * (d / width));
      H.setPar(f, p, colour, rest + (level - rest) * g);
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.55, colour,
      pan: 0.45 + 0.42 * H.clamp(head / Math.max(1, n - 1), 0, 1), tilt: 0.44,
    });
    frames.push(f);
  }
  return { frames, loop_beats: loop, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
