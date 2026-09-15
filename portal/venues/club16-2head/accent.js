"use strict";
const H = require("./helpers");

/* Binding: amount follows drum onsets above a threshold. The baker calls render()
   with the onset intensity (0 when no onset, 0..1 when an onset fires). */
module.exports = function accent(params, ctx) {
  const threshold = params.threshold != null ? params.threshold : 0.5;
  const extent = params.extent || "all";
  const pars = H.parsForExtent(extent);
  const driven = pars.map(p => p.id).concat(H.HEAD_IDS);

  function render(onset_value) {
    const v = onset_value > threshold ? H.clamp(onset_value, 0, 1) : 0;
    const env = v > 0 ? 0.9 : 0;
    const frame = H.emptyFrame();
    for (const p of pars) H.setPar(frame, p, [1, 1, 1], env);
    for (const h of H.HEADS) H.setHead(frame, h, { level: env * 0.7, colour: [1, 1, 1] });
    return frame;
  }

  return {
    frames: [render(0)],
    loop_beats: 0,
    per_fixture: driven,
    binding: true,
    render,
    threshold,
  };
};
