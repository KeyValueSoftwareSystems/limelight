"use strict";
const H = require("./helpers");

/* glare — the whole row HELD on, for as long as the cue lasts.
 *
 * The catalogue had no way to say this. `impact` is a flash with a hard decay,
 * `wash` is a resting state and can only be hung on a whole section, so there
 * was no gesture that simply holds every lamp up for two beats. That is the
 * other half of a wave: the room blazes, then collapses to one travelling lamp,
 * and the collapse is what makes the travel read. Without the blaze the run is
 * just a small light in a dark room.
 *
 * `rise` tilts the hold: 0 is flat, positive swells into it, negative falls away.
 */
module.exports = function glare(params, ctx) {
  /* head: false -- drive the pars only and leave the moving head to whichever
     cue owns it. Without this a row cue that starts later than a beam cue takes
     the head with it (latest start wins a fixture), parks it, and kills its
     strobe -- so the head could never be the soloist over a moving row. */
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = H.parsForExtent(params.extent || "all");
  /* `amount` is the dial the editor's intensity slider writes; `level` is kept for
     files that already say it. amount wins when both are present. */
  const level = H.clamp(params.amount != null ? params.amount : (params.level != null ? params.level : 1), 0, 1);
  const rise = params.rise != null ? params.rise : 0;
  const forBeats = params.for_beats || 2;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1 || 1);
    const lvl = H.clamp(level * (1 + rise * (t - 0.5)), 0, 1);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, colour, lvl);
    if (params.head !== false) 
    for (const head of H.HEADS) H.setHead(f, head, { level: lvl * 0.9, colour, pan: 0.662, tilt: 0.45 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS) };
};
