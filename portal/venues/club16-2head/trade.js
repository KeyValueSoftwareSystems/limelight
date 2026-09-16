"use strict";
const H = require("./helpers");

/* trade — the row answering itself.
 *
 *   travel: false (the original)  one half hands to the other and back.
 *   travel: true                  a single bump travels the row lamp by lamp,
 *     `runs` times across the span, in the direction `direction` names. The
 *     desk rig has four lamps in a line and the club rig has sixteen; the run
 *     is written against POSITION ALONG THE ROW, not against a lamp count, so
 *     the same cue reads as the same move on either. Sixteen lamps make the
 *     bump smoother, which is what more lamps should buy you.
 *
 * direction: "lr" (default) or "rl".
 */
module.exports = function trade(params, ctx) {
  /* head: false -- drive the pars only and leave the moving head to whichever
     cue owns it. Without this a row cue that starts later than a beam cue takes
     the head with it (latest start wins a fixture), parks it, and kills its
     strobe -- so the head could never be the soloist over a moving row. */
  const cols = H.parseColours(params.colours, [[1, 0.75, 0.35], [0.2, 0.4, 1]]);
  const c0 = cols[0], c1 = cols[1];
  const forBeats = params.for_beats || 2;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = Math.max(2, fpb * forBeats);
  const rl = String(params.direction || "lr").toLowerCase() === "rl";
  const frames = [];

  if (params.travel) {
    const pars = H.parsForExtent(params.extent || "all");
    const n = pars.length;
    const runs = params.runs || Math.max(1, Math.round(forBeats / 2));
    const rest = params.rest != null ? params.rest : 0.10;
    const peak = params.peak != null ? params.peak : 1.0;
    const width = params.width != null ? params.width : 0.20;

    for (let i = 0; i < total; i++) {
      const t = i / (total - 1 || 1);
      let pos = (t * runs) % 1;
      if (rl) pos = 1 - pos;
      const f = H.emptyFrame();
      for (let k = 0; k < n; k++) {
        const x = n > 1 ? k / (n - 1) : 0.5;
        const d = x - pos;
        const lvl = rest + (peak - rest) * Math.exp(-(d * d) / (2 * width * width));
        const mix = H.clamp((lvl - rest) / Math.max(1e-6, peak - rest), 0, 1);
        const col = [0, 1, 2].map(j => c1[j] + (c0[j] - c1[j]) * mix);
        H.setPar(f, pars[k], col, H.clamp(lvl, 0, 1));
      }
      /* both heads ride the bump, a little apart, so the move reads from the
         truss as well as from the wash bar */
      if (params.head !== false) 
      H.setHead(f, H.HEADS[0], { level: 0.55, colour: c0, pan: 0.25 + 0.5 * pos, tilt: 0.4 });
      if (params.head !== false) 
      H.setHead(f, H.HEADS[1], { level: 0.55, colour: c0, pan: 0.35 + 0.5 * pos, tilt: 0.4 });
      frames.push(f);
    }
    return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(params.head === false ? [] : H.HEAD_IDS) };
  }

  const half = Math.floor(total / 2);
  const A = rl ? H.RIGHT : H.LEFT, B = rl ? H.LEFT : H.RIGHT;
  const driven = H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS);
  for (let i = 0; i < total; i++) {
    const frame = H.emptyFrame();
    const inFirst = i < half;
    const t = inFirst ? i / half : (i - half) / (total - half);
    const env = H.hitEnv(t * 0.5);
    const aCol = inFirst ? c0 : c1, bCol = inFirst ? c1 : c0;
    const aLv = inFirst ? 0.7 * env : 0.2, bLv = inFirst ? 0.2 : 0.7 * env;
    for (const p of A) H.setPar(frame, p, aCol, aLv);
    for (const p of B) H.setPar(frame, p, bCol, bLv);
    if (params.head !== false) 
    H.setHead(frame, H.HEADS[0], { level: aLv, colour: aCol, pan: rl ? 0.7 : 0.3 });
    if (params.head !== false) 
    H.setHead(frame, H.HEADS[1], { level: bLv, colour: bCol, pan: rl ? 0.3 : 0.7 });
    frames.push(frame);
  }
  return { frames, loop_beats: forBeats, per_fixture: driven };
};
