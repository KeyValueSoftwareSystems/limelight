"use strict";
const H = require("./helpers");

function hue(h) {
  const s = 1, v = 1;
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = 0, q = v * (1 - f), t = v * f;
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
}

module.exports = function spectrum(params, ctx) {
  const pars = H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : 0.6, 0, 1);
  const spread = params.spread != null ? params.spread : 0.5;
  const loopBeats = Math.max(1, Math.round(params.for_beats || 8));
  const travel = params.travel !== false;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const roll = travel ? i / N : 0;
    const f = H.emptyFrame();
    pars.forEach((par, k) => {
      const h = (roll + (k / Math.max(1, pars.length)) * spread) % 1;
      H.setPar(f, par, hue(h), level);
    });
    H.setHeadsAll(f, { level: level * 0.7, colour: hue(roll), pan: 0.55, tilt: 0.45 });
    frames.push(f);
  }
  return { frames, loop_beats: travel ? loopBeats : 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
