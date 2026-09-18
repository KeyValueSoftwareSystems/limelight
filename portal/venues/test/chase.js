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
  /* head: false -- drive the pars only and leave the moving head to whichever
     cue owns it. Without this a row cue that starts later than a beam cue takes
     the head with it (latest start wins a fixture), parks it, and kills its
     strobe -- so the head could never be the soloist over a moving row. */
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = String(params.direction || "lr").toLowerCase() === "rl"
    ? H.parsForExtent(params.extent || "all").slice().reverse()
    : H.parsForExtent(params.extent || "all");
  /* `amount` is the dial the editor's intensity slider writes; `level` is kept for
     files that already say it. amount wins when both are present. */
  const level = H.clamp(params.amount != null ? params.amount : (params.level != null ? params.level : 0.85), 0, 1);
  const rest = H.clamp(params.rest != null ? params.rest : 0, 0, 1);
  /* the lamps NOT being walked: their own colour, and a rest level that can rise
     across the cue (rest -> rest_to), so one walk cue also carries the bed's
     swell under it instead of fighting a second full-row cue for the lamps. */
  const restColour = params.rest_colour ? H.parseColour(params.rest_colour, colour) : colour;
  const restTo = params.rest_to != null ? H.clamp(params.rest_to, 0, 1) : rest;
  const perBeat = params.per_beat != null ? params.per_beat : 1;
  const back = params.bounce === true;
  /* step: one lamp at a time, each held for an equal share of the crossing, no
     half-glow on the neighbour. With per_beat = 1/lamps that is one lamp per
     beat on this rig -- a walk that lands on beats, not a wave that arrives
     late at every lamp after the first. */
  const step = params.step === true;
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
      if (params.head !== false) 
      H.setHead(f, head, { level: level * 0.5, colour, pan: 0.40 + 0.40 * pos, tilt: 0.42 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS) };
};
