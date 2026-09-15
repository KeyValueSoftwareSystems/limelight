"use strict";
const H = require("./helpers");

/* spin — colour-spin flourish GESTURE. The PARs cycle through the hue wheel and
   the head's colour wheel spins continuously (raw wheel value ≥150), prism on.
   A "spend-once" rainbow to CLOSE a section (last bar of a drop, second half of
   an anthem). Beat-locked so the rotation rides the tempo. Ported from
   concert.py's colour spin. */
function hsv(h) {                                  // h 0..1 -> [r,g,b] 0..1, full sat/val
  const i = Math.floor(h * 6), f = h * 6 - i;
  const q = 1 - f;
  switch (((i % 6) + 6) % 6) {
    case 0: return [1, f, 0]; case 1: return [q, 1, 0]; case 2: return [0, 1, f];
    case 3: return [0, q, 1]; case 4: return [f, 0, 1]; default: return [1, 0, q];
  }
}

module.exports = function spin(params, ctx) {
  const beatsPerTurn = params.beats_per_turn != null ? params.beats_per_turn : 4;

  function render(bx) {
    const { beat, energy } = bx;
    const f = H.emptyFrame();
    const level = 0.6 + 0.4 * energy;
    for (let i = 0; i < H.PARS.length; i++) {
      const hue = ((beat / beatsPerTurn) + i / H.PARS.length) % 1;   // a moving rainbow across the line
      H.setPar(f, H.PARS[i], hsv((hue + 1) % 1), level);
    }
    H.setHead(f, H.HEADS[0], { level: 0.85, colour: [1, 1, 1], pan: 0.498 + 0.3 * Math.sin(2 * Math.PI * beat / 6), tilt: 0.45, prism: 100 });
    f[H.HEADS[0].offset + H.HEAD.colour] = 170;    // raw wheel value >=150 = continuous spin
    return f;
  }

  return { beat: true, render, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
