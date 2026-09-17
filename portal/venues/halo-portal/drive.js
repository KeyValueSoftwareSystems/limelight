"use strict";
const H = require("./helpers");
/* arc4-head's beat.js is a per-rig file (its PARX hardcodes 4 par ids: par_1,
   par_8, par_15, par_22) and was not copied. The pure-math pieces are inlined
   verbatim below; PARX is rebuilt from each par's real x (already on every
   fixture object in H.PARS) so it holds for this rig's 24 pars across three
   arches instead of arc4-head's single row of 4. */
const flash = (p, decay = 0.5) => Math.pow(0.05, p / decay);   // 1 at the beat -> 5% at `decay` beats
const bump  = (x, c, w) => Math.exp(-0.5 * ((x - c) / w) ** 2); // a Gaussian spot at c
const kick  = (b, hold = 0.45, fall = 0.3) => (b < hold ? 1 : flash(b - hold, fall)); // hold then fall — hits & tilt kicks
const parXs = H.PARS.map(p => p.x);
const parXMin = Math.min(...parXs), parXMax = Math.max(...parXs);
const PARX = {};
for (const p of H.PARS) PARX[p.id] = parXMax > parXMin ? ((p.x - parXMin) / (parXMax - parXMin)) * 2 - 1 : 0;

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
    /* the pair swap runs on the same early clock as the pump, or the lamp that
       pumped early is cut off at the grid beat */
    const biLead = (bphase + (params.lean != null ? Math.max(0, Math.min(0.4, Number(params.lean))) : 0)) >= 1 ? beatIndex + 1 : beatIndex;
    const step = every === 1 ? biLead : Math.floor(biLead / every);
    const innerActive = (step + flip) % 2 === 0;
    const col = cols[bar % cols.length], col2 = cols[(bar + 1) % cols.length];
    /* pop: the downbeat strobe burst. Off under a landing, where a held white cue
       sits on top and the burst leaks through it as a flicker. */
    const pop = params.pop !== false && downbeat && bphase < 0.2 && weight > 0.35;
    /* flash_every / flash_bar: the downbeat white flash on every Nth bar only, counted
       from the score's bar number flash_bar -- so a drop can flash on its own bar and
       every other bar after, and not on every downbeat. */
    const flashEvery = params.flash_every != null ? Math.max(1, Math.round(params.flash_every)) : 1;
    const anchor = params.flash_bar != null ? Math.round(params.flash_bar) : 0;
    const flashLen = params.flash_len != null ? Math.max(0.05, Math.min(1, Number(params.flash_len))) : 0.15;   // how long the downbeat white holds, in beats
    const flashBar = flashEvery === 1 || (((bar - anchor) % flashEvery) + flashEvery) % flashEvery === 0;
    /* lean: the pump fires this much BEFORE the grid beat, so the eye reads it
       as on the beat (light lags sound in the room); decay: how fast it falls back
       to the floor, in beats -- shorter is punchier. */
    const leadB = params.lean != null ? Math.max(0, Math.min(0.4, Number(params.lean))) : 0;
    const decay = params.decay != null ? Math.max(0.15, Math.min(0.9, Number(params.decay))) : 0.55;
    /* the pump RISES into the beat over lead_beats and peaks exactly on it, then
       falls over `decay`. A peak before the beat reads as a dull early flash; a
       rise that arrives on the beat reads as together with the music. */
    const pumpShape = ph => (leadB > 0 && ph >= 1 - leadB) ? (ph - (1 - leadB)) / leadB : flash(ph, decay);
    /* punch: how much of the peak every beat is guaranteed, the rest following the
       beat's measured weight. 0.45 breathes with the drums; 0.85 pumps. */
    const punch = params.punch != null ? Math.max(0, Math.min(1, Number(params.punch))) : 0.45;
    const hitAmp = pumpShape(bphase) * (punch + (1 - punch) * weight);

    for (const par of H.PARS) {
      const isInner = H.INNER.some(p => p.id === par.id);
      /* pairs:false -- the whole row pumps together on every beat instead of the two
         pairs taking turns; twice the visible movement */
      /* split:"sides" -- the LEFT half and the RIGHT half take turns beat by beat,
         instead of the inner and outer pairs. Same pump, a different room. */
      const isLeft = PARX[par.id] < 0;
      const mine = params.split === "sides" ? isLeft : isInner;
      const onPair = params.pairs === false ? true : mine === innerActive;
      const hit = (onPair || downbeat) ? 1 : 0;
      const across = (PARX[par.id] + 1) / 2;
      const bph = stagger === 0 ? bphase : ((bphase - stagger * across) % 1 + 1) % 1;
      const hitAmpL = stagger === 0 ? hitAmp : pumpShape(bph) * (punch + (1 - punch) * weight);
      const ghost = onPair ? 0 : 0.3 * weight * bump(bph, 0.5, 0.05);
      let lvl = floorNow + (peakDial - floorNow) * hit * hitAmpL + ghost;
      let c = onPair ? col : col2;
      if (flashBar && downbeat && bphase < flashLen) { c = [1, 1, 1]; lvl = peakDial; }   // the downbeat white holds at full for its whole length
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
    if (params.head !== false) H.setHeadsMirror(f, {
      level: (0.7 + 0.3 * energy) * (0.72 + 0.28 * flash(bphase, 0.5)), colour: col,
      pan: H.clamp(pan, 0, 1), tilt: H.clamp(tilt, 0, 1),
      gobo: (bar % 2) * 80, prism: 100, strobe: pop ? 200 : 0,
    });
    return f;
  }

  return { beat: true, render, per_fixture: params.head === false ? H.PAR_IDS : H.PAR_IDS.concat(H.HEAD_IDS) };
};
