"use strict";
const H = require("./helpers");

module.exports = function drone(params, ctx) {
  const amount = params.amount != null ? params.amount : 0.12;
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const extent = params.extent || "inner";
  const pars = H.parsForExtent(extent);

  const frame = H.emptyFrame();
  for (const p of pars) H.setPar(frame, p, colour, amount);
  for (const h of H.HEADS) H.setHead(frame, h, { level: amount * 0.5, colour });

  return {
    frames: [frame],
    loop_beats: 1,
    per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS),
  };
};
