"use strict";
const H = require("./helpers");

/* drone — a low AMBIENT state for a genuinely sparse passage, but never dead:
   each par breathes on its own phase so the line shimmers as a slow wave, and
   the head roams the whole room in a slow ~14s circle with a flower gobo. Low
   level, calm — but always moving. Rendered per frame off the clock (bx.t), so
   the roam is continuous over any span instead of a short repeating loop. */
module.exports = function drone(params, ctx) {
  const amount = params.amount != null ? params.amount : 0.12;
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const extent = params.extent || "inner";
  const pars = H.parsForExtent(extent);

  function render(bx) {
    const { t, energy } = bx;
    const f = H.emptyFrame();
    for (let i = 0; i < pars.length; i++) {
      const ph = 2 * Math.PI * (t / 3.5) + i * 1.7;       // each lamp offset → a slow shimmer along the line
      const lvl = amount * (0.65 + 0.35 * Math.sin(ph)) * (0.85 + 0.3 * energy);
      H.setPar(f, pars[i], colour, Math.max(0, lvl));
    }
    const ang = 2 * Math.PI * t / 14;                      // slow circle round the whole room
    H.setHead(f, H.HEADS[0], {
      level: amount * 0.5 * (0.7 + 0.3 * Math.sin(2 * Math.PI * t / 3.5)), colour,
      pan: H.clamp(0.498 + 0.40 * Math.sin(ang), 0, 1),
      tilt: H.clamp(0.30 + 0.22 * Math.cos(ang), 0, 1),
      gobo: 80,
    });
    return f;
  }

  return { beat: true, render, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
