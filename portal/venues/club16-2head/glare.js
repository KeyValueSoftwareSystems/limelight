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
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = H.parsForExtent(params.extent || "all");
  const level = H.clamp(params.level != null ? params.level : 1, 0, 1);
  const rise = params.rise != null ? params.rise : 0;
  const forBeats = params.for_beats || 2;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1 || 1);
    const lvl = H.clamp(level * (1 + rise * (t - 0.5)), 0, 1);
    const f = H.emptyFrame();
    for (const par of pars) H.setPar(f, par, colour, lvl);
    for (const head of H.HEADS) H.setHead(f, head, { level: lvl * 0.9, colour, pan: 0.662, tilt: 0.45 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
