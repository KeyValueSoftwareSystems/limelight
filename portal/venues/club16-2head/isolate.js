"use strict";
const H = require("./helpers");

module.exports = function isolate(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const which = params.which || H.PARS[Math.floor(H.PARS.length / 2)].id;
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const rest = params.rest != null ? params.rest : 0.06;
  const forBeats = params.for_beats || 4;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;

  const target = H.PARS.find(p => p.id === which) || H.PARS[Math.floor(H.PARS.length / 2)];

  const frames = [];
  for (let i = 0; i < total; i++) {
    const frame = H.emptyFrame();
    for (const p of H.PARS) {
      if (p.id === target.id) {
        H.setPar(frame, p, colour, 0.7);
      } else {
        H.setPar(frame, p, [0.3, 0.3, 0.3], rest);
      }
    }
    for (const h of H.HEADS) {
      if (params.head !== false) H.setHead(frame, h, { level: rest * 0.5, colour: [0.3, 0.3, 0.3] });
    }
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
