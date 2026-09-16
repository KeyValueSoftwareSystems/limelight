"use strict";
const H = require("./helpers");

module.exports = function follow(params, ctx) {
  /* head: false -- a binding on the row must not also light the head; the still
     pin over the opening was reading at the binding's level, not its own. */
  const depth = params.depth != null ? params.depth : 0.95;
  const extent = params.extent || "all";
  const smooth = params.smooth != null ? params.smooth : 0.3;
  const pars = H.parsForExtent(extent);
  const driven = pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS);
  const floor = params.floor != null ? params.floor : 0;
  const response = params.response != null ? params.response : 1;
  const spread = params.spread != null ? params.spread : 0.35;
  const lean = params.lean != null ? params.lean : 0;

  function render(lane_value) {
    const v = H.clamp(lane_value, 0, 1);
    const level = H.clamp(floor + (depth - floor) * Math.pow(v, response), 0, 1);
    const frame = H.emptyFrame();
    pars.forEach((p, k) => {
      const across = pars.length > 1 ? k / (pars.length - 1) : 0.5;
      const wave = 1 - spread * 0.5 + spread * (1 - Math.abs(across - 0.5) * 2);
      const tip = 1 + lean * (across - 0.5) * (v - 0.5) * 2;
      H.setPar(frame, p, [0.8, 0.7, 0.5], H.clamp(level * wave * tip, 0, 1));
    });
    for (const h of H.HEADS) H.setHead(frame, h, { level: level * 0.6, colour: [0.8, 0.7, 0.5] });
    return frame;
  }

  return {
    frames: [render(0.5)],
    loop_beats: 0,
    per_fixture: driven,
    binding: true,
    render,
    smooth,
  };
};
