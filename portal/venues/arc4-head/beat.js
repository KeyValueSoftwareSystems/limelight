"use strict";
/* Beat-locked envelope helpers, ported from experimentation/music_sync/concert.py.
   These are what make a section feel PLAYED instead of triggered: a hit on every
   beat, a bump travelling across the arc, a tilt kick on the downbeat. Effects
   compute their look from the beat phase (bph, 0..1 within a beat) so the show
   pulses with the music at 40 fps instead of sitting on a slow wash. */

const flash = (p, decay = 0.5) => Math.pow(0.05, p / decay);   // 1 at the beat -> 5% at `decay` beats
const bump  = (x, c, w) => Math.exp(-0.5 * ((x - c) / w) ** 2); // a Gaussian spot at c
const ease  = p => p * p * (3 - 2 * p);
const kick  = (b, hold = 0.45, fall = 0.3) => (b < hold ? 1 : flash(b - hold, fall)); // hold then fall — hits & tilt kicks
const mix   = (rgb, amount) => rgb.map(c => c * (1 - amount) + amount);               // toward white

/* PAR positions along the arc, -1 (left) .. +1 (right); the only spatial story a
   line of four lamps can tell is left-to-right. */
const PARX = { par_1: -1, par_8: -0.53, par_15: 0.53, par_22: 1 };

module.exports = { flash, bump, ease, kick, mix, PARX };
