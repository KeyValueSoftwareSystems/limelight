"use strict";
const H = require("./helpers");

/* Gear changes the RATE dimension. On hardware this means we output a single
   frame that the baker will tile at the new rate. The baker is responsible for
   using ctx.bpm × (to/from) as the effective tempo for any effects concurrent
   with this gear shift. The DMX function itself just outputs one beat of a
   visible pulse at the target rate so the preview is meaningful. */
module.exports = function gear(params, ctx) {
  const from = params.from != null ? params.from : 1;
  const to = params.to != null ? params.to : 2;
  const ratio = to / (from || 1);
  const effectiveBpm = ctx.bpm * ratio;
  const fpb = H.framesPerBeat(effectiveBpm);

  const frames = [];
  for (let i = 0; i < fpb; i++) {
    const t = i / fpb;
    const pulse = 0.3 + 0.2 * Math.sin(t * Math.PI * 2);
    const frame = H.emptyFrame();
    for (const p of H.PARS) H.setPar(frame, p, [0.8, 0.8, 0.8], pulse);
    for (const h of H.HEADS) H.setHead(frame, h, { level: pulse * 0.5 });
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: 1,
    per_fixture: H.ALL_FIXTURES.slice(),
    rate_ratio: ratio,
  };
};
