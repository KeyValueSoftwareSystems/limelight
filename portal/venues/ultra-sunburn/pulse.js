"use strict";
const H = require("./helpers");

module.exports = function pulse(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const pars = H.parsForExtent(params.extent || "all");
  const depth = H.clamp(params.depth != null ? params.depth : 0.55, 0, 1);
  const top = H.clamp(params.top != null ? params.top : 0.8, 0, 1);
  const perBeat = params.per_beat != null ? params.per_beat : 1;
  const loopBeats = Math.max(1, Math.round(params.for_beats || 4));
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const phase = ((i / H.framesPerBeat(ctx.bpm)) * perBeat) % 1;
    const env = Math.pow(1 - phase, 1.8);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, colour, top * (1 - depth + depth * env));
    if (params.head !== false) H.setHead(f, H.HEADS[0], {
      level: top * (1 - depth + depth * env) * 0.7, colour,
      pan: 0.662, tilt: 0.47,
    });
    frames.push(f);
  }
  return { frames, loop_beats: loopBeats, per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS) };
};
