"use strict";
const H = require("./helpers");

/* accent — amount BINDING on drum onsets. render(value, t) gets a live 0..1 onset
   envelope each frame (peaks on hits, near 0 between). Above the threshold the
   extent's pars flash white and the head pops with a strobe; below it the rig
   sits very dim, so the hits read as sharp accents. */
module.exports = function accent(params, ctx) {
  const threshold = params.threshold != null ? params.threshold : 0.10;
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);
  const rest = params.rest != null ? params.rest : 0.22;

  function render(value, t) {
    const v = H.clamp(value || 0, 0, 1);
    const bedC = H.parseColour(params.bed_colour,
      (ctx && ctx.restColour) || [1, 0.75, 0.35]);
    const colour = H.parseColour(params.colour, bedC);
    const bed = bedC;
    const raw = v > threshold ? (v - threshold) / Math.max(1e-6, 1 - threshold) : 0;
    const over = raw * raw * (3 - 2 * raw);
    const f = H.emptyFrame();
    for (const p of pars) {
      if (over > 0) H.setPar(f, p, colour, H.clamp(rest + (0.98 - rest) * over, 0, 1));
      else H.setPar(f, p, bed, rest);
    }
    H.setHead(f, H.HEADS[0], {
      level: H.clamp(rest * 0.9 + (0.9 - rest) * over, 0, 1),
      colour: over > 0 ? colour : bed,
      pan: 0.662, tilt: 0.45,
      strobe: over > 0.6 ? 18 : 0,
    });
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
