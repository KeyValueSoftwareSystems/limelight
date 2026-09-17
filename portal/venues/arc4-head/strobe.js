"use strict";
const H = require("./helpers");

/* strobe — a placed hardware-strobe burst GESTURE. Unlike `accent` (onset-driven)
   this is a strobe you drop on a span: the extent's PARs hold white and run the
   fixture's own strobe at `hz`, the head strobes too. Hardware strobe is faster
   and cleaner than anything a 40 fps stream can fake, so it cuts through as an
   accent. A single held frame; the hardware does the flashing across the span. */
module.exports = function strobe(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const hz = params.hz != null ? params.hz : 20;
  const level = params.intensity != null ? params.intensity : 1;
  const pars = H.parsForExtent(params.extent || "all");

  const f = H.emptyFrame();
  for (const par of pars) { H.setPar(f, par, colour, level); H.setParStrobe(f, par, hz); }
  if (params.head !== false) H.setHead(f, H.HEADS[0], { level, colour, pan: 0.5, tilt: 0.45, strobe: Math.min(25, hz) });

  return { frames: [f], loop_beats: 0, per_fixture: params.head === false ? pars.map(p => p.id) : pars.map(p => p.id).concat(H.HEAD_IDS) };
};
