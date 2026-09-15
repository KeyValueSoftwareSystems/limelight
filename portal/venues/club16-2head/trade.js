"use strict";
const H = require("./helpers");

module.exports = function trade(params, ctx) {
  const colours = H.parseColours(params.colours, [[1, 0.75, 0.35], [0.2, 0.4, 1]]);
  const forBeats = params.for_beats || 2;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;
  const half = Math.floor(total / 2);

  const leftPars = H.LEFT;
  const rightPars = H.RIGHT;
  const driven = leftPars.map(p => p.id).concat(rightPars.map(p => p.id)).concat(H.HEAD_IDS);

  const frames = [];
  for (let i = 0; i < total; i++) {
    const frame = H.emptyFrame();
    const inFirst = i < half;
    const t = inFirst ? i / half : (i - half) / (total - half);
    const env = H.hitEnv(t * 0.5);

    const leftColour  = inFirst ? colours[0] : colours[1];
    const rightColour = inFirst ? colours[1] : colours[0];
    const leftLevel   = inFirst ? 0.7 * env : 0.2;
    const rightLevel  = inFirst ? 0.2 : 0.7 * env;

    for (const p of leftPars)  H.setPar(frame, p, leftColour, leftLevel);
    for (const p of rightPars) H.setPar(frame, p, rightColour, rightLevel);

    H.setHead(frame, H.HEADS[0], { level: leftLevel, colour: leftColour, pan: 0.3 });
    H.setHead(frame, H.HEADS[1], { level: rightLevel, colour: rightColour, pan: 0.7 });
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: driven,
  };
};
