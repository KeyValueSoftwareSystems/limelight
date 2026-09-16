"use strict";
const H = require("./helpers");

module.exports = function follow(params, ctx) {
  const depth = params.depth != null ? params.depth : 0.95;
  const extent = params.extent || "all";
  const colour = H.parseColour(params.colour, (ctx && ctx.restColour) || [0.9, 0.8, 0.55]);
  const pars = H.parsForExtent(extent);
  const bpm = ctx.bpm;
  const floor = params.floor != null ? params.floor : 0;
  const response = params.response != null ? params.response : 1;

  const spread = params.spread != null ? params.spread : 0.35;
  const lean = params.lean != null ? params.lean : 0;
  const travel = params.travel != null ? params.travel : 0.22;

  function render(value, t) {
    const v = H.clamp(value || 0, 0, 1);
    const level = H.clamp(floor + (depth - floor) * Math.pow(v, response), 0, 1);
    const beat = (t || 0) * bpm / 60;
    const f = H.emptyFrame();
    pars.forEach((p, k) => {
      const across = pars.length > 1 ? k / (pars.length - 1) : 0.5;
      const wave = 1 - spread * 0.5 + spread * (1 - Math.abs(across - 0.5) * 2);
      const tip = 1 + lean * (across - 0.5) * (v - 0.5) * 2;
      H.setPar(f, p, colour, H.clamp(level * wave * tip, 0, 1));
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.85, colour,
      pan: 0.5 + travel * (v - 0.5) * 2,
      tilt: 0.28 + 0.14 * v,
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
