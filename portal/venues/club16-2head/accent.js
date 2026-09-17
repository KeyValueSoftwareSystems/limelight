"use strict";
const H = require("./helpers");

/* Binding: amount follows drum onsets above a threshold. The baker calls render()
   with the onset intensity (0 when no onset, 0..1 when an onset fires). */
module.exports = function accent(params, ctx) {
  /* head: false -- a binding on the row must not also light the head; the still
     pin over the opening was reading at the binding's level, not its own. */
  const threshold = params.threshold != null ? params.threshold : 0.5;
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);
  const driven = pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS);

  const rest = params.rest != null ? params.rest : 0.22;
  const bedC = H.parseColour(params.bed_colour,
      (ctx && ctx.restColour) || [1, 0.75, 0.35]);
    const colour = H.parseColour(params.colour, bedC);
  const bed = bedC;

  function render(onset_value) {
    const v = H.clamp(onset_value || 0, 0, 1);
    const raw = v > threshold ? (v - threshold) / Math.max(1e-6, 1 - threshold) : 0;
    const over = raw * raw * (3 - 2 * raw);
    const frame = H.emptyFrame();
    for (const p of pars) {
      if (over > 0) H.setPar(frame, p, colour, H.clamp(rest + (0.98 - rest) * over, 0, 1));
      else H.setPar(frame, p, bed, rest);
    }
    for (const h of H.HEADS) {
      if (params.head !== false) H.setHead(frame, h, {
        level: H.clamp(rest * 0.9 + (0.9 - rest) * over, 0, 1),
        colour: over > 0 ? colour : bed,
        strobe: over > 0.6 ? 18 : 0,
      });
    }
    return frame;
  }

  return {
    frames: [render(0)],
    loop_beats: 0,
    per_fixture: driven,
    binding: true,
    render,
    threshold,
  };
};
