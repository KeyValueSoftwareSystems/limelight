"use strict";
const H = require("./helpers");

module.exports = function tint(params, ctx) {
  const from = H.parseColour(params.from, ctx.restColour || [1, 0.75, 0.35]);
  const to = H.parseColour(params.to, [0.2, 0.4, 1]);
  const pars = H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : (ctx.restLevel || 0.5), 0, 1);
  const overBeats = params.over_beats || 4;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * overBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = H.easeInOut(i / (N - 1 || 1));
    const c = [0, 1, 2].map(k => from[k] + (to[k] - from[k]) * t);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, c, level);
    H.setHead(f, H.HEADS[0], { level: level * 0.8, colour: c, pan: 0.662, tilt: 0.47 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
