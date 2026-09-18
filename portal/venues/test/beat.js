"use strict";
/* Beat-locked envelope helpers, ported from experimentation/music_sync/concert.py.
   These are what make a section feel PLAYED instead of triggered: a hit on every
   beat, a bump travelling across the row, a tilt kick on the downbeat. Effects
   compute their look from the beat phase (bph, 0..1 within a beat) so the show
   pulses with the music at 40 fps instead of sitting on a slow wash. */

const H = require("./helpers");

const flash = (p, decay = 0.5) => Math.pow(0.05, p / decay);   // 1 at the beat -> 5% at `decay` beats
const bump  = (x, c, w) => Math.exp(-0.5 * ((x - c) / w) ** 2); // a Gaussian spot at c
const ease  = p => p * p * (3 - 2 * p);
const kick  = (b, hold = 0.45, fall = 0.3) => (b < hold ? 1 : flash(b - hold, fall)); // hold then fall
const mix   = (rgb, amount) => rgb.map(c => c * (1 - amount) + amount);               // toward white

/* Where each par sits along the row, -1 (left) .. +1 (right). arc4-head can hard
   code four lamps; this rig has twenty-eight across two trusses, so the positions
   come from the layout's own metres and are normalised to the widest pair. */
const PARX = (() => {
  const xs = H.PARS.map((p) => p.x);
  const span = Math.max(...xs.map(Math.abs)) || 1;
  const out = {};
  H.PARS.forEach((p) => { out[p.id] = p.x / span; });
  return out;
})();

module.exports = { flash, bump, ease, kick, mix, PARX };
