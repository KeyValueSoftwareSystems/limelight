"use strict";
const H = require("./helpers");
module.exports = function shift(params, ctx) {
  const cols = H.parseColours(params.colours,
    [[1, 0.75, 0.35], [1, 0.35, 0.2], [0.5, 0.3, 0.9], [0.2, 0.5, 1]]);
  const pars = H.parsForExtent(params.extent || "all");
  const level = params.level != null ? params.level : 0.55;
  const loop = Math.max(2, Math.round(params.over_beats || 16));
  const N = Math.max(4, H.framesPerBeat(ctx.bpm) * loop);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const pos = (i / N) * cols.length;
    const a = cols[Math.floor(pos) % cols.length];
    const b = cols[(Math.floor(pos) + 1) % cols.length];
    const k = pos - Math.floor(pos);
    const c = [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * k);
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, c, level);
    H.setHeadsAll(f, { level: level * 0.85, colour: c, pan: 0.55, tilt: 0.45 });
    frames.push(f);
  }
  return { frames, loop_beats: loop, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
