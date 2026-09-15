"use strict";
const H = require("./helpers");

/* accent — amount BINDING on drum onsets. render(value, t) gets a live 0..1 onset
   envelope each frame (peaks on hits, near 0 between). Above the threshold the
   extent's pars flash white and the head pops with a strobe; below it the rig
   sits very dim, so the hits read as sharp accents. */
module.exports = function accent(params, ctx) {
  const threshold = params.threshold != null ? params.threshold : 0.4;
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);

  function render(value, t) {
    const v = H.clamp(value || 0, 0, 1);
    const f = H.emptyFrame();
    if (v > threshold) {
      const level = H.clamp(0.6 + 0.4 * v, 0, 1);       // punchy flash, scaled by hit strength
      for (const p of pars) H.setPar(f, p, [1, 1, 1], level);
      H.setHead(f, H.HEADS[0], { level, colour: [1, 1, 1], strobe: 20 });
    } else {
      H.setHead(f, H.HEADS[0], { level: 0 });           // dark between hits so the flashes pop
    }
    return f;
  }

  return {
    binding: true,
    render,
    frames: [render(0, 0)],
    loop_beats: 0,
    per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS),
    threshold,
  };
};
