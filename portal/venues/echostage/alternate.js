"use strict";
const H = require("./helpers");
module.exports = function alternate(params, ctx) {
  const cols = H.parseColours(params.colours, [[1, 0.75, 0.35], [0.25, 0.45, 1]]);
  const level = params.level != null ? params.level : 0.8;
  const rest = params.rest != null ? params.rest : 0;
  const per = params.per_beat != null ? params.per_beat : 1;
  const loop = Math.max(1, Math.round(params.for_beats || 4));
  const fpb = H.framesPerBeat(ctx.bpm);
  const N = Math.max(2, fpb * loop);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const step = Math.floor((i / fpb) * per);
    const odd = step % 2 === 1;
    const f = H.emptyFrame();
    H.PARS.forEach((p, k) => {
      const mine = (k % 2 === 0) !== odd;
      H.setPar(f, p, cols[k % 2 === 0 ? 0 : 1], mine ? level : rest);
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.6, colour: cols[odd ? 1 : 0],
      pan: odd ? 0.48 : 0.64, tilt: 0.44,
    });
    H.setHead(f, H.HEADS[1], {
      level: level * 0.6, colour: cols[odd ? 0 : 1],
      pan: odd ? 0.84 : 0.68, tilt: 0.44,
    });
    H.setHead(f, H.HEADS[2], {
      level: level * 0.45, colour: cols[odd ? 1 : 0],
      pan: odd ? 0.55 : 0.67, tilt: 0.48,
    });
    H.setHead(f, H.HEADS[3], {
      level: level * 0.45, colour: cols[odd ? 0 : 1],
      pan: odd ? 0.77 : 0.65, tilt: 0.48,
    });
    frames.push(f);
  }
  return { frames, loop_beats: loop, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
