"use strict";
const H = require("./helpers");
const { flash, bump, PARX } = require("./beat");

/* pulse — the verse / moving-instrumental STATE, rendered per frame against the
   real beat grid. A bump travels across the lamps once per beat (bigger when the
   beat carries more weight), direction flipping each bar; the head runs a slow
   room-wide figure on its own continuous clock. floor breathes with energy. */
module.exports = function pulse(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const colour = H.parseColour(params.colour, [0.15, 0.5, 1]);
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);
  const floorDial = params.floor != null ? params.floor : 0.24;
  const every = params.every_beats != null ? Math.max(0.25, Number(params.every_beats)) : 1;

  function render(bx) {
    const { beat, bar, weight, energy } = bx;
    const bphase = every === 1 ? bx.bphase : ((beat / every) % 1 + 1) % 1;
    const dir = bar % 2 === 0 ? 1 : -1;
    const floorNow = H.clamp(floorDial * (0.6 + 0.9 * energy), 0.05, 0.7);
    const f = H.emptyFrame();
    for (const par of pars) {
      const pos = ((PARX[par.id] || 0) * dir + 1) / 2;
      const delay = 0.08 + 0.55 * pos;
      const lvl = floorNow
        + (0.72 * (0.5 + 0.5 * weight)) * bump(bphase, delay, 0.08)
        + 0.15 * bump(bphase, 0.5 + 0.25 * (1 - pos), 0.06);
      H.setPar(f, par, colour, Math.min(1, lvl));
    }
    if (params.head !== false) H.setHead(f, H.HEADS[0], {
      level: 0.5 + 0.35 * energy + 0.15 * flash(bphase, 0.5), colour,
      pan: 0.498 + 0.45 * Math.sin(2 * Math.PI * beat / 10.5),
      tilt: 0.42 + 0.33 * Math.sin(2 * Math.PI * beat / 7.3),
    });
    return f;
  }

  return { beat: true, render, per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS) };
};
