"use strict";
const H = require("./helpers");

/* Binding: place follows two streams, one per half. The baker calls render()
   with [left_value, right_value] from two lane streams each frame. */
module.exports = function split(params, ctx) {
  /* head: false -- a binding on the row must not also light the head; the still
     pin over the opening was reading at the binding's level, not its own. */
  const colours = H.parseColours(params.colours, [[1, 0.75, 0.35], [0.2, 0.4, 1]]);
  const driven = H.PAR_IDS.concat(params.head === false ? [] : H.HEAD_IDS);

  function render(lane_values) {
    const lv = H.clamp(lane_values[0] || 0, 0, 1);
    const rv = H.clamp(lane_values[1] || 0, 0, 1);
    const frame = H.emptyFrame();

    for (const p of H.LEFT)  H.setPar(frame, p, colours[0], lv * 0.7);
    for (const p of H.RIGHT) H.setPar(frame, p, colours[1], rv * 0.7);

    if (params.head !== false) H.setHead(frame, H.HEADS[0], { level: lv * 0.5, colour: colours[0], pan: 0.3 });
    if (params.head !== false) H.setHead(frame, H.HEADS[1], { level: rv * 0.5, colour: colours[1], pan: 0.7 });
    return frame;
  }

  return {
    frames: [render([0.5, 0.5])],
    loop_beats: 0,
    per_fixture: driven,
    binding: true,
    render,
  };
};
