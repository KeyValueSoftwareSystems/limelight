"use strict";
const H = require("./helpers");
const { PARX, flash, bump, kick } = require("./beat");

/* breakdown — the come-down STATE, rendered per frame against the real beat
   grid. A hard hit on each beat (scaled by its weight) from a very low floor, so
   the same peak feels twice as hard as in a verse; the pairs swap blue/pink each
   bar; the head finds a new spot each bar and kicks its tilt on the beat. Ported
   from concert.py's breakdown ("where are you now"). */
module.exports = function breakdown(params, ctx) {
  const cols = H.parseColours(params.colours, [[0, 0, 1], [1, 0, 0.55]]);
  const floorDial = params.floor != null ? params.floor : 0.10;

  const stagger = params.stagger != null ? Math.max(0, Math.min(0.9, Number(params.stagger))) : 0;

  function render(bx) {
    const { bar, weight, energy } = bx;
    const bphase0 = bx.bphase;
    const swap = bar % 2;
    const floorNow = H.clamp(floorDial * (0.5 + energy), 0.04, 0.4);
    /* bphase0, not bphase: the per-lamp `bphase` is declared inside the loop
       below, so naming it here reached a variable that does not exist yet and
       threw on the first frame -- every show using breakdown failed to bake. */
    const hitAmp = kick(bphase0, 0.08, 0.3) * (0.4 + 0.6 * weight);
    const f = H.emptyFrame();
    for (const par of H.PARS) {
      const isInner = H.INNER.some(p => p.id === par.id) ? 1 : 0;
      const c = (isInner ^ swap) ? cols[0] : cols[1];
      const across = (PARX[par.id] + 1) / 2;
      const bphase = stagger === 0 ? bphase0
                   : ((bphase0 - stagger * across) % 1 + 1) % 1;
      const hitAmpL = stagger === 0 ? hitAmp
                    : kick(bphase, 0.08, 0.3) * (0.4 + 0.6 * weight);
      let lvl = floorNow + (1 - floorNow) * hitAmpL;
      if (energy > 0.5) lvl += 0.25 * weight * bump(bphase, 0.5, 0.05);
      H.setPar(f, par, c, Math.min(1, lvl));
    }
    H.setHead(f, H.HEADS[0], {
      level: 0.3 + 0.7 * flash(bphase0, 0.4), colour: swap ? cols[0] : cols[1],
      pan: H.clamp(0.498 + 0.45 * Math.sin(bar * 2.4), 0, 1),
      tilt: H.clamp(0.27 + 0.47 * (Math.floor(bar / 2) % 2) + 0.16 * kick(bphase0, 0.3, 0.3), 0, 1),
    });
    return f;
  }

  return { beat: true, render, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
