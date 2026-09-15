"use strict";
const H = require("./helpers");

/* split — place BINDING. render([left, right], t) gets the two bound streams'
   live 0..1 levels each frame. The LEFT pars carry colour[0] at `left`, the RIGHT
   pars carry colour[1] at `right`, and the head pans toward whichever side is
   louder and takes that side's colour. Call and response, driven by the music. */
module.exports = function split(params, ctx) {
  const cols = H.parseColours(params.colours, [[1, 0.75, 0.35], [0.2, 0.4, 1]]);
  const c0 = cols[0], c1 = cols[1];
  const bpm = ctx.bpm;

  function render(value, t) {
    const arr = Array.isArray(value) ? value : [value, value];
    const l = H.clamp(arr[0] || 0, 0, 1);
    const r = H.clamp(arr[1] || 0, 0, 1);
    const beat = (t || 0) * bpm / 60;
    const f = H.emptyFrame();
    for (const p of H.LEFT)  H.setPar(f, p, c0, l * 0.9);
    for (const p of H.RIGHT) H.setPar(f, p, c1, r * 0.9);
    const balance = r - l;                                  // -1 all-left .. +1 all-right
    H.setHead(f, H.HEADS[0], {
      level: (l + r) * 0.4,
      colour: l >= r ? c0 : c1,
      pan: 0.60 + 0.20 * H.clamp(balance * 1.5, -1, 1),     // lean toward the louder side
      tilt: 0.32 + 0.05 * Math.sin(2 * Math.PI * beat / 8),
    });
    return f;
  }

  return {
    binding: true,
    render,
    frames: [render([0.5, 0.5], 0)],
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
