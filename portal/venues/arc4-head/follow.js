"use strict";
const H = require("./helpers");

module.exports = function follow(params, ctx) {
  const depth = params.depth != null ? params.depth : 0.6;
  const extent = params.extent || "all";
  const smooth = params.smooth != null ? params.smooth : 0.3;
  const pars = H.parsForExtent(extent);
  const driven = pars.map(p => p.id).concat(H.HEAD_IDS);

  function render(lane_value) {
    const v = H.clamp(lane_value, 0, 1);
    const level = v * depth;
    const frame = H.emptyFrame();
    for (const p of pars) H.setPar(frame, p, [0.8, 0.7, 0.5], level);
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
