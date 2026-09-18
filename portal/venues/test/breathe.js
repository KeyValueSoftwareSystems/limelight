"use strict";
const H = require("./helpers");
module.exports = function breathe(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const pars = H.parsForExtent(params.extent || "all");
  const mid = params.level != null ? params.level : 0.45;
  const depth = params.depth != null ? params.depth : 0.3;
  const bars = params.over_bars != null ? params.over_bars : 2;
  const loop = Math.max(1, Math.round(bars * 4));
  const N = Math.max(4, H.framesPerBeat(ctx.bpm) * loop);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const k = H.clamp(mid + depth * Math.sin(2 * Math.PI * (i / N)), 0, 1);
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, colour, k);
    H.setHead(f, H.HEADS[0], {
      level: k * 0.8, colour,
      pan: 0.662 + 0.05 * Math.sin(2 * Math.PI * (i / N)),
      tilt: 0.46 + 0.03 * Math.cos(2 * Math.PI * (i / N)),
    });
    frames.push(f);
  }
  return { frames, loop_beats: loop, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
