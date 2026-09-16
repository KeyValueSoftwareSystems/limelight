"use strict";
const H = require("./helpers");
const { kick } = require("./beat");

/* beam — a standalone head-motion GESTURE that drives ONLY the head, leaving the
   PARs on whatever state is underneath. For a solo or instrumental where the
   beam tells the story. Room-wide, beat-locked, tilt kicking on the beat. Ported
   from concert.py's "room-wide motion". pattern: sweep | figure8 | snap. */
module.exports = function beam(params, ctx) {
  const pattern = params.pattern || "figure8";
  const colour = H.parseColour(params.colour, [1, 1, 1]);

  function render(bx) {
    const { beat, bphase, beatIndex, energy } = bx;
    const beatInBar = (((beatIndex % 4) + 4) % 4) + bphase;
    let pan, tilt;
    if (pattern === "sweep") { const s = 1 - Math.abs(2 * (beatInBar / 4) - 1); pan = 0.02 + 0.96 * s; tilt = 0.16 + 0.72 * kick(bphase); }
    else if (pattern === "snap") { pan = (beatIndex % 2 === 0) ? 0.1 : 0.9; tilt = 0.24 + 0.5 * (Math.floor(beatIndex / 2) % 2) + 0.14 * kick(bphase); }
    else { const w = 2 * Math.PI * beat / 4; pan = 0.498 + 0.47 * Math.sin(w); tilt = 0.498 + 0.4 * Math.sin(2 * w); }  // figure-8
    const f = H.emptyFrame();
    H.setHead(f, H.HEADS[0], {
      level: 0.7 + 0.3 * energy, colour,
      pan: H.clamp(pan, 0, 1), tilt: H.clamp(tilt, 0, 1),
      gobo: params.gobo != null ? params.gobo : 0, prism: 100,
    });
    return f;
  }

  return { beat: true, render, per_fixture: H.HEAD_IDS };
};
