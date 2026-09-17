"use strict";
const H = require("./helpers");
/* arc4-head's beat.js is a per-rig file (its PARX hardcodes 4 par ids) and was
   not copied. The pure-math pieces this module needs have no rig facts, so
   they are inlined here instead, ported verbatim from beat.js. */
const flash = (p, decay = 0.5) => Math.pow(0.05, p / decay);   // 1 at the beat -> 5% at `decay` beats
const ease  = p => p * p * (3 - 2 * p);
const kick  = (b, hold = 0.45, fall = 0.3) => (b < hold ? 1 : flash(b - hold, fall)); // hold then fall — hits & tilt kicks
const mix   = (rgb, amount) => rgb.map(c => c * (1 - amount) + amount);               // toward white

/* ramp — rising build GESTURE, rendered per frame against the real beat grid.
   Every beat HITS (scaled by its weight) while the floor rises and the colour
   whitens across the span (bx.p is progress over the gesture); a strobe
   accelerates in over the last 30% and the head spirals faster and wider as it
   climbs. Ported from concert.py's build phase. */
module.exports = function ramp(params, ctx) {
  const to = params.to != null ? params.to : 0.9;
  const cool = H.parseColour(params.colour, [0.2, 0.4, 0.9]);

  function render(bx) {
    const { beat, bphase, p, weight } = bx;
    const whiten = ease(p);
    const floor = 0.15 + (to - 0.15) * p;
    const strobe = p > 0.7 ? Math.round(30 + 220 * (p - 0.7) / 0.3) : 0;
    const lvl = floor + (1 - floor) * kick(bphase, 0.08, 0.3) * (0.5 + 0.5 * weight);
    const c = mix(cool, whiten);
    const f = H.emptyFrame();
    for (const par of H.PARS) {
      H.setPar(f, par, c, Math.min(1, lvl));
      if (strobe) H.setParStrobe(f, par, (strobe / 255) * 25);
    }
    const w = 2 * Math.PI * beat * (0.1 + 0.4 * p);
    H.setHead(f, H.HEADS[0], {
      level: (0.5 + 0.5 * p) * (0.6 + 0.4 * flash(bphase, 0.4)), colour: c,
      pan: H.clamp(0.498 + (0.06 + 0.44 * p) * Math.sin(w), 0, 1),
      tilt: H.clamp(0.16 + 0.7 * ease(p) * (0.6 + 0.4 * Math.cos(w)), 0, 1),
      prism: p > 0.85 ? 100 : 0, strobe: p > 0.88 ? 150 : 0,
    });
    return f;
  }

  return { beat: true, render, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
