"use strict";
const H = require("./helpers");

/* isolate — one lamp highlighted GESTURE. The target par carries the colour, the
   rest of the rig drops to a dim grey, and the head aims at the isolated lamp
   (pan tracks its horizontal position). Holds for its span with a faint breath so
   it isn't a dead frame. Needs >=3 lamps to read; 4 pars is fine. */
module.exports = function isolate(params, ctx) {
  /* head: false -- leave the moving head to whichever cue owns it. A state that
     lights the head cannot be dimmed by a gesture (the baker never lets a
     gesture make the head darker than its bed), so a still low pin over a
     pulse state came out at the pulse's brightness, not the pin's. */
  const colour = H.parseColour(params.colour, [1, 0.8, 0.4]);
  const rest = params.rest != null ? params.rest : 0.03;

  /* which lamp: an index, an id, or the middle by default */
  let idx = Math.floor(H.PARS.length / 2);
  if (typeof params.which === "number") idx = H.clamp(Math.round(params.which), 0, H.PARS.length - 1);
  else if (typeof params.which === "string") {
    const found = H.PARS.findIndex(p => p.id === params.which);
    if (found >= 0) idx = found;
  }
  const target = H.PARS[idx];
  const pointer = H.HEADS.length > 0 && params.which == null;
  const panAim = 0.40 + 0.40 * (idx / (H.PARS.length - 1)); // leftmost -> low pan, rightmost -> high

  const loopBeats = 2;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const breath = 1 + 0.08 * Math.sin(2 * Math.PI * (i / N));
    const f = H.emptyFrame();
    for (const par of H.PARS) {
      if (pointer) H.setPar(f, par, [0.6, 0.6, 0.6], rest);
      else if (par.id === target.id) H.setPar(f, par, colour, 0.7 * breath);
      else H.setPar(f, par, [0.6, 0.6, 0.6], rest);
    }
    if (pointer) H.setHead(f, H.HEADS[0], { level: 0.85 * breath, colour, pan: panAim, tilt: 0.30 });
    else if (H.HEADS.length) H.setHead(f, H.HEADS[0], { level: 0.6 * breath, colour, pan: panAim, tilt: 0.30 });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: loopBeats,
    per_fixture: H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS),
  };
};
