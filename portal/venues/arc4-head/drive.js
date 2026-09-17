"use strict";
const H = require("./helpers");
const { PARX, flash, bump, kick } = require("./beat");

/* drive — the energetic-section STATE (chorus / drop / anthem), rendered per
   frame against the REAL beat grid. Every beat hits, scaled by that beat's
   measured weight (so it follows the drums, not a metronome); the floor breathes
   with the energy curve; the two pairs call and respond; the downbeat flashes
   white with a strobe pop; the head sweeps the room. Ported from concert.py's
   drop/anthem looks. floor/peak are the contrast lever ("brightness is an
   effect"): a drop sits high, a lull sits low, same peak. */
module.exports = function drive(params, ctx) {
  const cols = H.parseColours(params.colours, [[0.1, 0.55, 1], [1, 0.3, 0.55]]);
  const amount = params.amount != null ? params.amount : 0.85;
  const floorDial = params.floor != null ? params.floor : 0.42 + 0.14 * amount;
  const peakDial = params.peak != null ? params.peak : 1.0;

  const stagger = params.stagger != null ? Math.max(0, Math.min(0.9, Number(params.stagger))) : 0;
  const every = params.every_beats != null ? Math.max(0.25, Number(params.every_beats)) : 1;

  function render(bx) {
    const { beatIndex, bar, downbeat, weight, energy } = bx;
    const bphase = every === 1 ? bx.bphase
                 : ((((beatIndex + bx.bphase) / every) % 1) + 1) % 1;
    const f = H.emptyFrame();
    const floorNow = H.clamp(floorDial * (0.55 + 0.75 * energy), 0.08, peakDial);
    const flip = Math.floor(bar / 2) % 2;
    const step = every === 1 ? beatIndex : Math.floor(beatIndex / every);
    const innerActive = (step + flip) % 2 === 0;
    const col = cols[bar % cols.length], col2 = cols[(bar + 1) % cols.length];
    const pop = downbeat && bphase < 0.2 && weight > 0.35;
    const hitAmp = flash(bphase, 0.55) * (0.45 + 0.55 * weight);

    for (const par of H.PARS) {
      const isInner = H.INNER.some(p => p.id === par.id);
      const onPair = isInner === innerActive;
      const hit = (onPair || downbeat) ? 1 : 0;
      const across = (PARX[par.id] + 1) / 2;
      const bph = stagger === 0 ? bphase : ((bphase - stagger * across) % 1 + 1) % 1;
      const hitAmpL = stagger === 0 ? hitAmp : flash(bph, 0.55) * (0.45 + 0.55 * weight);
      const ghost = onPair ? 0 : 0.3 * weight * bump(bph, 0.5, 0.05);
      const lvl = floorNow + (peakDial - floorNow) * hit * hitAmpL + ghost;
      let c = onPair ? col : col2;
      if (downbeat && bphase < 0.15) c = [1, 1, 1];
      H.setPar(f, par, c, Math.min(1, lvl));
      if (pop) H.setParStrobe(f, par, 20);
    }

    // head: motion IS energy — a different room-wide pattern each bar
    const beatInBar = (((beatIndex % 4) + 4) % 4) + bphase;
    let pan, tilt;
    const pat = bar % 3;
    if (pat === 0) { const sweep = 1 - Math.abs(2 * (beatInBar / 4) - 1); pan = 0.02 + 0.96 * sweep; tilt = 0.16 + 0.72 * kick(bphase); }
    else if (pat === 1) { pan = (beatIndex % 2 === 0) ? 0.12 : 0.88; tilt = 0.24 + 0.5 * (Math.floor(beatIndex / 2) % 2) + 0.12 * kick(bphase); }
    else { const w = 2 * Math.PI * (beatInBar / 4); pan = 0.498 + 0.47 * Math.sin(w); tilt = 0.498 + 0.37 * Math.sin(2 * w); }
    if (params.head !== false) H.setHead(f, H.HEADS[0], {
      level: (0.7 + 0.3 * energy) * (0.72 + 0.28 * flash(bphase, 0.5)), colour: col,
      pan: H.clamp(pan, 0, 1), tilt: H.clamp(tilt, 0, 1),
      gobo: (bar % 2) * 80, prism: 100, strobe: pop ? 200 : 0,
    });
    return f;
  }

  return { beat: true, render, per_fixture: params.head === false ? H.PAR_IDS : H.PAR_IDS.concat(H.HEAD_IDS) };
};
