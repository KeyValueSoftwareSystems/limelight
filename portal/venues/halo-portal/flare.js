"use strict";
const H = require("./helpers");

module.exports = function flare(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.25, 0.1]);
  const under = H.parseColour(params.under, ctx.restColour || [1, 0.75, 0.35]);
  const pars = H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : 0.9, 0, 1);
  const rest = H.clamp(params.rest != null ? params.rest : (ctx.restLevel || 0.3), 0, 1);
  const forBeats = params.for_beats || 2;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const env = H.hitEnv(i / N);
    const c = [0, 1, 2].map(k => under[k] + (colour[k] - under[k]) * env);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, c, rest + (level - rest) * env);
    H.setHeadsMirror(f, {
      level: rest + (level - rest) * env, colour: c,
      pan: 0.55, tilt: 0.45, prism: env > 0.5 ? 100 : 0,
    });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
