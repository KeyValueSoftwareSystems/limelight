"use strict";
const H = require("./helpers");

module.exports = function chase(params, ctx) {
  /* head: false -- drive the pars only and leave the moving head to whichever
     cue owns it. Without this a row cue that starts later than a beam cue takes
     the head with it (latest start wins a fixture), parks it, and kills its
     strobe -- so the head could never be the soloist over a moving row. */
  const colour = H.parseColour(params.colour, (ctx && ctx.restColour) || [1, 0.75, 0.35]);
  /* direction: "lr" (default) or "rl". A wave that can only run one way is
     half an effect -- the room reads a return sweep as a different move. */
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
  /* anticipate: in step mode the NEXT lamp starts to glow through the last third
     of the current step, so the walk leans into each beat instead of switching
     on it -- the groove lives in the lean. mirror: a second walker from the far
     end, so the two meet in the middle and cross. */
  const anticipate = params.anticipate === true;
  const mirror = params.mirror === true;
  const loopBeats = Math.max(1, Math.round(params.for_beats || 4));
  const n = pars.length;

  /* `per_beat` is CROSSINGS PER BEAT, not lamps per beat.
     Stepping one lamp per step made the same cue mean different things on
     different rigs: a run that crossed the four-lamp desk rig in a beat only
     got a quarter of the way along the sixteen-lamp club rig in the same beat,
     which is exactly the kind of drift a show file is supposed to make
     impossible. Position along the ROW is the unit; how many lamps that is
     belongs to the venue. */
  function at(beats, gain) {
    const span = back ? 2 : 1;
    let pos = (beats * span) % 1;
    if (back && pos > 0.5) pos = 1 - pos;
    else if (back) pos = pos;
    const exact = H.clamp(pos * span, 0, 1) * (n - 1);
    let head = step ? Math.min(n - 1, Math.floor(H.clamp(pos * span, 0, 1) * n)) : Math.floor(exact);
    const within = step ? 1 : exact - head;
    const f = H.emptyFrame();
    const restNow = rest + (restTo - rest) * H.clamp((beats / perBeat) / loopBeats, 0, 1);   // `beats` arrives already scaled by per_beat
    const frac = step ? (H.clamp(pos * span, 0, 1) * n) - head : 0;            // how far through the current step, 0..1
    const lean = step && anticipate ? H.clamp((frac - 0.66) / 0.34, 0, 1) * 0.55 : 0;
    const heads = mirror ? [head, n - 1 - head] : [head];
    pars.forEach((par, k) => {
      let glow = 0;
      for (const hd of heads) {
        const d = Math.abs(k - hd);
        glow = Math.max(glow, d === 0 ? 1 : d === 1 ? 0.35 * (1 - within) : 0);
        if (lean > 0 && k === hd + 1 && hd + 1 < n) glow = Math.max(glow, lean);          // the lamp ahead of the walker leans in
        if (lean > 0 && mirror && k === hd - 1 && hd - 1 >= 0) glow = Math.max(glow, lean);
      }
      if (glow > 0) H.setPar(f, par, colour, (restNow + (level - restNow) * glow) * gain);
      else H.setPar(f, par, restColour, restNow * gain);
    });
    if (params.head !== false) 
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

  /* NOT binding:true.
     As a binding this rendered from ABSOLUTE time -- beatOf(t) counts from the
     top of the song -- so a one-beat run placed at bar 15 caught whatever slice
     of the crossing cycle happened to be passing, and the light did not cross
     the row so much as flicker somewhere in the middle of it. Returning frames
     alone makes the baker play them from the cue's own start, which is what a
     run placed on a beat has to do. `render` stays available for anyone binding
     it to a stream. */
  return {
    render, frames, loop_beats: loopBeats,
    per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS),
  };
};
