"use strict";
const H = require("./helpers");
const { PARX, flash, bump, kick } = require("./beat");

/* drive — the energetic-section STATE (chorus / drop / anthem), rendered per
   frame against the REAL beat grid. Ported from the desk rig so a show authored
   there renders here too; the PAR logic is rig-agnostic (position via PARX, the
   inner/outer split via H.INNER), and the head figure is fanned across this
   rig's four movers instead of driving one. */
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
    const biLead = (bphase + (params.lean != null ? Math.max(0, Math.min(0.4, Number(params.lean))) : 0)) >= 1 ? beatIndex + 1 : beatIndex;
    const step = every === 1 ? biLead : Math.floor(biLead / every);
    const innerActive = (step + flip) % 2 === 0;
    const col = cols[bar % cols.length], col2 = cols[(bar + 1) % cols.length];
    const pop = params.pop !== false && downbeat && bphase < 0.2 && weight > 0.35;
    const flashEvery = params.flash_every != null ? Math.max(1, Math.round(params.flash_every)) : 1;
    const anchor = params.flash_bar != null ? Math.round(params.flash_bar) : 0;
    const flashLen = params.flash_len != null ? Math.max(0.05, Math.min(1, Number(params.flash_len))) : 0.15;
    const flashBar = flashEvery === 1 || (((bar - anchor) % flashEvery) + flashEvery) % flashEvery === 0;
    const leadB = params.lean != null ? Math.max(0, Math.min(0.4, Number(params.lean))) : 0;
    const decay = params.decay != null ? Math.max(0.15, Math.min(0.9, Number(params.decay))) : 0.55;
    const pumpShape = ph => (leadB > 0 && ph >= 1 - leadB) ? (ph - (1 - leadB)) / leadB : flash(ph, decay);
    const punch = params.punch != null ? Math.max(0, Math.min(1, Number(params.punch))) : 0.45;
    const hitAmp = pumpShape(bphase) * (punch + (1 - punch) * weight);

    for (const par of H.PARS) {
      const isInner = H.INNER.some(p => p.id === par.id);
      const isLeft = (PARX[par.id] || 0) < 0;
      const mine = params.split === "sides" ? isLeft : isInner;
      const onPair = params.pairs === false ? true : mine === innerActive;
      const hit = (onPair || downbeat) ? 1 : 0;
      const across = ((PARX[par.id] || 0) + 1) / 2;
      const bph = stagger === 0 ? bphase : ((bphase - stagger * across) % 1 + 1) % 1;
      const hitAmpL = stagger === 0 ? hitAmp : pumpShape(bph) * (punch + (1 - punch) * weight);
      const ghost = onPair ? 0 : 0.3 * weight * bump(bph, 0.5, 0.05);
      let lvl = floorNow + (peakDial - floorNow) * hit * hitAmpL + ghost;
      let c = onPair ? col : col2;
      if (flashBar && downbeat && bphase < flashLen) { c = [1, 1, 1]; lvl = peakDial; }
      H.setPar(f, par, c, Math.min(1, lvl));
      if (pop) H.setParStrobe(f, par, 20);
    }

    // head: the room-wide figure, fanned across this rig's movers
    if (params.head !== false) {
      const beatInBar = (((beatIndex % 4) + 4) % 4) + bphase;
      const pat = bar % 3;
      let pan, tilt;
      if (pat === 0) { const sweep = 1 - Math.abs(2 * (beatInBar / 4) - 1); pan = 0.06 + 0.88 * sweep; tilt = 0.18 + 0.34 * kick(bphase); }
      else if (pat === 1) { pan = (beatIndex % 2 === 0) ? 0.15 : 0.85; tilt = 0.22 + 0.26 * (Math.floor(beatIndex / 2) % 2) + 0.1 * kick(bphase); }
      else { const w = 2 * Math.PI * (beatInBar / 4); pan = 0.5 + 0.42 * Math.sin(w); tilt = 0.34 + 0.16 * Math.sin(2 * w); }
      const lvl = (0.7 + 0.3 * energy) * (0.72 + 0.28 * flash(bphase, 0.5));
      H.HEADS.forEach((head, hi) => {
        const spread = (hi - (H.HEADS.length - 1) / 2) * 0.1;
        H.setHead(f, head, {
          level: lvl, colour: col,
          pan: H.clamp(pan + spread, 0, 1), tilt: H.clamp(tilt, 0.12, 0.58),
          gobo: (bar % 2) * 80, prism: 100, strobe: pop ? 200 : 0,
        });
      });
    }
    return f;
  }

  return { beat: true, render, per_fixture: params.head === false ? H.PAR_IDS : H.PAR_IDS.concat(H.HEAD_IDS) };
};
