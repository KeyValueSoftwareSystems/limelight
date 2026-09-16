"use strict";
const H = require("./helpers");

module.exports = function chase(params, ctx) {
  const colour = H.parseColour(params.colour, (ctx && ctx.restColour) || [1, 0.75, 0.35]);
  const pars = H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : 0.85, 0, 1);
  const rest = H.clamp(params.rest != null ? params.rest : 0, 0, 1);
  const perBeat = params.per_beat != null ? params.per_beat : 1;
  const back = params.bounce === true;
  const loopBeats = Math.max(1, Math.round(params.for_beats || 4));
  const n = pars.length;

  function at(step, gain) {
    let head = Math.floor(step) % (back ? Math.max(1, 2 * n - 2) : n);
    if (back && head >= n) head = 2 * n - 2 - head;
    const within = step - Math.floor(step);
    const f = H.emptyFrame();
    pars.forEach((par, k) => {
      const d = Math.abs(k - head);
      const glow = d === 0 ? 1 : d === 1 ? 0.35 * (1 - within) : 0;
      H.setPar(f, par, colour, (rest + (level - rest) * glow) * gain);
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.5 * gain, colour,
      pan: 0.40 + 0.40 * (head / Math.max(1, n - 1)), tilt: 0.42,
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
    return at(beatOf(t) * perBeat, v);
  }

  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);
  const frames = [];
  for (let i = 0; i < N; i++) frames.push(at((i / H.framesPerBeat(ctx.bpm)) * perBeat, 1));

  return {
    binding: true, render, frames, loop_beats: loopBeats,
    per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS),
  };
};
