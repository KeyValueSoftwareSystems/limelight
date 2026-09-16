"use strict";
const H = require("./helpers");
const { PARX } = require("./beat");

/* trade — the row answering itself.
 *
 * Two behaviours, chosen by `travel`:
 *
 *   travel: false (the original)  one half hands to the other and back. Call
 *     and response between two blocks of lamps.
 *
 *   travel: true (a real run)     a single bump travels the row lamp by lamp,
 *     `runs` times across the span, in the direction `direction` names. On four
 *     lamps in a row this is the one move the rig owns outright, and it is what
 *     makes a room move its head. The head pans with the bump so the whole room
 *     runs the same way.
 *
 * direction: "lr" (default) or "rl".
 */
module.exports = function trade(params, ctx) {
  /* head: false -- drive the pars only and leave the moving head to whichever
     cue owns it. Without this a row cue that starts later than a beam cue takes
     the head with it (latest start wins a fixture), parks it, and kills its
     strobe -- so the head could never be the soloist over a moving row. */
  const cols = H.parseColours(params.colours, [[0.2, 0.4, 1], [1, 0.55, 0.2]]);
  const c0 = cols[0], c1 = cols[1];
  const forBeats = params.for_beats || 4;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);
  const rl = String(params.direction || "lr").toLowerCase() === "rl";
  const frames = [];

  if (params.travel) {
    /* order the row by its real physical x, so "left to right" means left to
       right on the floor and not in the order someone listed the fixtures. */
    const pars = H.parsForExtent(params.extent || "all")
      .slice().sort((a, b) => (PARX[a.id] || 0) - (PARX[b.id] || 0));
    const n = pars.length;
    const runs = params.runs || Math.max(1, Math.round(forBeats / 2));
    const rest = params.rest != null ? params.rest : 0.10;
    const peak = params.peak != null ? params.peak : 1.0;
    const width = params.width != null ? params.width : 0.20;   /* bump sigma */

    for (let i = 0; i < N; i++) {
      const t = i / (N - 1 || 1);
      let pos = (t * runs) % 1;
      if (rl) pos = 1 - pos;
      const f = H.emptyFrame();
      for (let k = 0; k < n; k++) {
        const x = n > 1 ? k / (n - 1) : 0.5;
        const d = x - pos;
        const lvl = rest + (peak - rest) * Math.exp(-(d * d) / (2 * width * width));
        /* the bump carries colour[0], the row it leaves behind sits in colour[1] */
        const mix = H.clamp((lvl - rest) / Math.max(1e-6, peak - rest), 0, 1);
        const col = [0, 1, 2].map(j => c1[j] + (c0[j] - c1[j]) * mix);
        H.setPar(f, pars[k], col, H.clamp(lvl, 0, 1));
      }
      if (params.head !== false) 
      H.setHead(f, H.HEADS[0], {
        level: 0.55,
        colour: c0,
        pan: 0.42 + (0.80 - 0.42) * pos,
        tilt: 0.36,
      });
      frames.push(f);
    }
    return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS) };
  }

  const dim = 0.15, hot = 0.9;
  const A = rl ? H.RIGHT : H.LEFT, Bs = rl ? H.LEFT : H.RIGHT;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const over = H.easeInOut(H.clamp((t - 0.35) / 0.3, 0, 1));
    const f = H.emptyFrame();
    for (const par of A)  H.setPar(f, par, c0, hot - (hot - dim) * over);
    for (const par of Bs) H.setPar(f, par, c1, dim + (hot - dim) * over);
    if (params.head !== false) 
    H.setHead(f, H.HEADS[0], {
      level: 0.5,
      colour: over < 0.5 ? c0 : c1,
      pan: rl ? 0.80 - (0.80 - 0.42) * over : 0.42 + (0.80 - 0.42) * over,
      tilt: 0.36,
    });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS) };
};
