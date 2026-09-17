"use strict";
const H = require("./helpers");

module.exports = function strobe(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = H.parsForExtent(params.extent || "all");
  const hz = H.clamp(params.hz != null ? params.hz : 12, 1, 25);
  const forBeats = params.for_beats || 2;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);
  const period = Math.max(2, Math.round(H.FPS / hz));
  const duty = Math.max(1, Math.round(period * 0.45));

  const frames = [];
  for (let i = 0; i < N; i++) {
    const f = H.emptyFrame();
    const on = (i % period) < duty;
    const fade = 1 - 0.35 * (i / N);
    for (const par of pars) H.setPar(f, par, colour, on ? fade : 0);
    if (params.head !== false) H.setHead(f, H.HEADS[0], {
      level: on ? fade : 0, colour,
      pan: 0.55, tilt: 0.42,
      strobe: hz,
    });
    if (params.head !== false) H.setHead(f, H.HEADS[1], {
      level: on ? fade : 0, colour,
      pan: 0.77, tilt: 0.42,
      strobe: hz,
    });
    if (params.head !== false) H.setHead(f, H.HEADS[2], {
      level: on ? fade * 0.7 : 0, colour,
      pan: 0.62, tilt: 0.46,
      strobe: hz,
    });
    if (params.head !== false) H.setHead(f, H.HEADS[3], {
      level: on ? fade * 0.7 : 0, colour,
      pan: 0.70, tilt: 0.46,
      strobe: hz,
    });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: params.head === false ? pars.map(p => p.id) : pars.map(p => p.id).concat(H.HEAD_IDS) };
};
