"use strict";
const H = require("./helpers");

/* chase — one lamp at a time runs the row, the rest dark. The wave.
 *
 * `per_beat` is CROSSINGS PER BEAT, not lamps per beat. Stepping one lamp per
 * step made the same cue mean different things on different rigs: a run that
 * crossed the four-lamp desk rig in a beat only got a quarter of the way along
 * this sixteen-lamp row in the same beat. Position along the ROW is the unit;
 * how many lamps that is belongs to the venue. More lamps buy a smoother wave,
 * never a slower one.
 *
 * direction: "lr" (default) or "rl".
 */
module.exports = function chase(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = String(params.direction || "lr").toLowerCase() === "rl"
    ? H.parsForExtent(params.extent || "all").slice().reverse()
    : H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : 0.85, 0, 1);
  const rest = H.clamp(params.rest != null ? params.rest : 0, 0, 1);
  const perBeat = params.per_beat != null ? params.per_beat : 1;
  const back = params.bounce === true;
  const forBeats = Math.max(1, params.for_beats || 4);
  const fpb = H.framesPerBeat(ctx.bpm);
  const N = Math.max(2, Math.round(fpb * forBeats));
  const n = pars.length;
  /* the bump is a fixed fraction of the ROW wide, so it looks the same size on
     a four-lamp bar and a sixteen-lamp one */
  const width = (params.width != null ? params.width : 0.14);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const beats = (i / fpb) * perBeat;
    let pos = beats % 1;
    if (back) pos = pos < 0.5 ? pos * 2 : (1 - pos) * 2;
    const f = H.emptyFrame();
    for (let k = 0; k < n; k++) {
      const x = n > 1 ? k / (n - 1) : 0.5;
      const d = x - pos;
      const glow = Math.exp(-(d * d) / (2 * width * width));
      H.setPar(f, pars[k], colour, H.clamp(rest + (level - rest) * glow, 0, 1));
    }
    for (const head of H.HEADS)
      H.setHead(f, head, { level: level * 0.5, colour, pan: 0.40 + 0.40 * pos, tilt: 0.42 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
