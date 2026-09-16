"use strict";
const H = require("./helpers");

module.exports = function chase(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  /* direction: "lr" (default) or "rl". A wave that can only run one way is
     half an effect -- the room reads a return sweep as a different move. */
  const pars = String(params.direction || "lr").toLowerCase() === "rl"
    ? H.parsForExtent(params.extent || "all").slice().reverse()
    : H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : 0.85, 0, 1);
  const rest = H.clamp(params.rest != null ? params.rest : 0, 0, 1);
  const perBeat = params.per_beat != null ? params.per_beat : 1;
  const back = params.bounce === true;
  const loopBeats = Math.max(1, Math.round(params.for_beats || 4));
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * loopBeats);
  const n = pars.length;

  const frames = [];
  for (let i = 0; i < N; i++) {
    const step = (i / H.framesPerBeat(ctx.bpm)) * perBeat;
    let head = Math.floor(step) % (back ? Math.max(1, 2 * n - 2) : n);
    if (back && head >= n) head = 2 * n - 2 - head;
    const within = step - Math.floor(step);
    const f = H.emptyFrame();
    pars.forEach((par, k) => {
      const d = Math.abs(k - head);
      const glow = d === 0 ? 1 : d === 1 ? 0.35 * (1 - within) : 0;
      H.setPar(f, par, colour, rest + (level - rest) * glow);
    });
    H.setHead(f, H.HEADS[0], {
      level: level * 0.5, colour,
      pan: 0.40 + 0.40 * (head / Math.max(1, n - 1)), tilt: 0.42,
    });
    frames.push(f);
  }
  return { frames, loop_beats: loopBeats, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
