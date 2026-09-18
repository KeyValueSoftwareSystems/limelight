"use strict";
const H = require("./helpers");

module.exports = function sweep(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const level = H.clamp(params.level != null ? params.level : 0.85, 0, 1);
  const from = params.from_pan != null ? params.from_pan : 0.35;
  const to = params.to_pan != null ? params.to_pan : 0.9;
  const tilt = params.tilt != null ? params.tilt : 0.4;
  const back = params.bounce !== false;
  const overBeats = params.for_beats || 4;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * overBeats);
  const pars = H.parsForExtent(params.extent || "all");
  const keep = H.clamp(params.rest != null ? params.rest : 0.30, 0, 1);

  const frames = [];
  for (let i = 0; i < N; i++) {
    let t = i / (N - 1 || 1);
    if (back) t = t < 0.5 ? t * 2 : (1 - t) * 2;
    const pan = from + (to - from) * H.easeInOut(t);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, colour, keep);
    H.setHead(f, H.HEADS[0], { level, colour, pan, tilt, gobo: params.gobo });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
