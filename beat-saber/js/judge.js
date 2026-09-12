/* Hit judging, against musical position (never against a drawn mesh).
   dt is (where the song is) - (where the note belongs), in ms. Pure. */
"use strict";
(function () {
  const S = Math.SQRT1_2;
  const DIR_VEC = {
    "up": [0, -1], "down": [0, 1], "left": [-1, 0], "right": [1, 0],
    "up-left": [-S, -S], "up-right": [S, -S],
    "down-left": [-S, S], "down-right": [S, S],
  };

  function judge(note, swing, nowSec, opts) {
    opts = opts || {};
    const window_ms = opts.window_ms == null ? 180 : opts.window_ms;
    const latency_ms = opts.latency_ms || 0;
    const tol = Math.cos((opts.angle_tol_deg == null ? 45 : opts.angle_tol_deg) * Math.PI / 180);

    const dt_ms = (nowSec + latency_ms / 1000 - note.hitSec) * 1000;
    if (Math.abs(dt_ms) > window_ms) return { hit: false, reason: "timing", dt_ms: dt_ms };
    if (opts.require_color !== false && swing.color !== note.color) {
      return { hit: false, reason: "color", dt_ms: dt_ms };
    }

    if (opts.require_direction !== false) {
      const v = DIR_VEC[note.direction] || [0, 1];
      const sp = Math.hypot(swing.vel.x, swing.vel.y) || 1;
      const sx = swing.vel.x / sp, sy = swing.vel.y / sp;
      const dot = v[0] * sx + v[1] * sy;
      if (dot < tol) return { hit: false, reason: "direction", dt_ms: dt_ms };
    }

    const a = Math.abs(dt_ms);
    const grade = a < 60 ? "perfect" : a < 120 ? "good" : "ok";
    return { hit: true, grade: grade, dt_ms: dt_ms };
  }

  const J = { judge, DIR_VEC };
  if (typeof module !== "undefined" && module.exports) module.exports = { Judge: J };
  if (typeof window !== "undefined") window.Judge = J;
})();
