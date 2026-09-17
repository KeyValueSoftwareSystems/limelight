"use strict";
const H = require("./helpers");

module.exports = function wash(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const amount = params.amount != null ? params.amount : 0.55;
  const colour = H.parseColour(params.colour, [0.2, 0.4, 1]);
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);

  const frame = H.emptyFrame();
  for (const p of pars) H.setPar(frame, p, colour, amount);
  for (const h of H.HEADS) H.setHead(frame, h, { level: amount * 0.7, colour });

  return {
    frames: [frame],
    loop_beats: 1,
    per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS),
  };
};
