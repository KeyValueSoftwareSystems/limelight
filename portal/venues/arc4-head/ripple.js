"use strict";
const H = require("./helpers");

module.exports = function ripple(params, ctx) {
  const colour = H.parseColour(params.colour, (ctx && ctx.restColour) || [1, 0.75, 0.35]);
  const level = params.level != null ? params.level : 0.85;
  const rest = params.rest != null ? params.rest : 0.15;
  const width = params.width != null ? params.width : 1.2;
  const perBeat = params.per_beat != null ? params.per_beat : 0.5;
  const loop = Math.max(1, Math.round(params.for_beats || 4));
  const n = H.PARS.length;
  const span = n + width * 2;

  function at(phase, gain) {
    const head = (phase % 1) * span - width;
    const f = H.emptyFrame();
    H.PARS.forEach((p, k) => {
      const d = Math.abs(k - head);
      const g = Math.max(0, 1 - (d / width) * (d / width));
      H.setPar(f, p, colour, (rest + (level - rest) * g) * gain);
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.55 * gain, colour,
      pan: 0.45 + 0.42 * H.clamp(head / Math.max(1, n - 1), 0, 1), tilt: 0.44,
    });
    return f;
  }

  function beatOf(t) {
    if (ctx && typeof ctx.beatAt === "function") {
      const b = ctx.beatAt(t);
      if (typeof b === "number" && isFinite(b)) return b;
    }
    return (t || 0) * ctx.bpm / 60;
  }

  function render(value, t) {
    const v = H.clamp(value == null ? 1 : value, 0, 1);
    return at(beatOf(t) * perBeat, 0.35 + 0.65 * v);
  }

  const N = Math.max(4, H.framesPerBeat(ctx.bpm) * loop);
  const frames = [];
  for (let i = 0; i < N; i++) frames.push(at(i / N, 1));

  return {
    binding: true, render, frames, loop_beats: loop,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
