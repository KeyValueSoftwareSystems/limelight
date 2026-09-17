"use strict";
/* Beat-locked envelope helpers (ported from arc4-head/beat.js) so the effects
   this rig shares with the desk rig — drive, breakdown — compute the same look.
   echostage had none, which is why those effects were blank here. */

const flash = (p, decay = 0.5) => Math.pow(0.05, p / decay);    // 1 at the beat -> 5% at `decay` beats
const bump  = (x, c, w) => Math.exp(-0.5 * ((x - c) / w) ** 2); // a Gaussian spot at c
const ease  = p => p * p * (3 - 2 * p);
const kick  = (b, hold = 0.45, fall = 0.3) => (b < hold ? 1 : flash(b - hold, fall));
const mix   = (rgb, amount) => rgb.map(c => c * (1 - amount) + amount);

/* PAR position along the row, -1 (left) .. +1 (right). 20 lamps in a line, so
   the spatial story is left-to-right, same as the desk rig's four. */
const PARX = {};
for (let i = 0; i < 20; i++) PARX["par_" + String(i + 1).padStart(2, "0")] = (i / 19) * 2 - 1;

module.exports = { flash, bump, ease, kick, mix, PARX };
