"use strict";
const H = require("./helpers");

/* follow — amount BINDING. render(value, t) is called once per frame by the
   baker with the bound stream's live 0..1 level and the show time in seconds.
   The extent's pars ride the level (with a floor so the rig never fully dies),
   the head master follows, and the head pans slowly on its own clock via t. */
module.exports = function follow(params, ctx) {
  const depth = params.depth != null ? params.depth : 0.6;
  const extent = params.extent || "all";
  const colour = H.parseColour(params.colour, [0.9, 0.8, 0.55]);
  const pars = H.parsForExtent(extent);
  const bpm = ctx.bpm;
  const floor = params.floor != null ? params.floor : 0.20;

  function render(value, t) {
    const v = H.clamp(value || 0, 0, 1);
    const level = floor + (depth - floor) * (0.10 + 0.90 * v);        // floor keeps it alive at low values
    const beat = (t || 0) * bpm / 60;
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, colour, level);
    H.setHead(f, H.HEADS[0], {
      level: Math.max(0.18, level * 0.85), colour,
      pan: 0.60 + 0.15 * Math.sin(2 * Math.PI * beat / 8),   // slow sweep, 8-beat period
      tilt: 0.30 + 0.06 * Math.sin(2 * Math.PI * beat / 6),
    });
    return f;
  }

  return {
    binding: true,
    render,
    frames: [render(0.3, 0)],
    loop_beats: 0,
    per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS),
    smooth: params.smooth != null ? params.smooth : 0.3,
  };
};
