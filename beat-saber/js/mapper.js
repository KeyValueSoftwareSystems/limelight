/* Beat-grid mapper: a beat becomes a note, deterministically.
   Pure and DOM-free so Node can test it. Quarter-note grid only. */
"use strict";
(function () {
  const LANES = 4;
  const DIRECTIONS = ["up", "down", "left", "right",
                      "up-left", "up-right", "down-left", "down-right"];

  // A stable 32-bit hash of a beat's musical position.
  function hash(bar, beat) {
    let h = ((bar * 4 + beat) >>> 0) * 2654435761;
    return (h >>> 0);
  }

  function keeps(difficulty, accent) {
    if (difficulty === "Easy") return accent;   // downbeats only
    return true;                                 // Normal/Hard/Expert: every beat
  }

  function noteFrom(beat, ctx, salt) {
    const h = hash(beat.bar, beat.beat + salt);
    const hitSec = ctx.secondsAt(beat.bar, beat.beat);
    return {
      key: Math.round(hitSec * 1000) + salt,     // salt keeps a mirrored pair distinct
      hitSec: hitSec,
      lane: h % LANES,
      // downbeats lean blue (left hand lead), others alternate by hash
      color: beat.accent ? "blue" : (h & 1 ? "red" : "blue"),
      // downbeats are a clean down-cut; others vary
      direction: beat.accent ? "down" : DIRECTIONS[h % DIRECTIONS.length],
    };
  }

  function mapBeat(beat, ctx) {
    if (!keeps(ctx.difficulty, beat.accent)) return null;
    return noteFrom(beat, ctx, 0);
  }

  // Expert: a mirrored second note on downbeats, opposite lane + color.
  function mapExtra(beat, ctx) {
    if (ctx.difficulty !== "Expert" || !beat.accent) return null;
    const n = noteFrom(beat, ctx, 1);
    n.lane = (LANES - 1) - n.lane;
    n.color = n.color === "blue" ? "red" : "blue";
    return n;
  }

  const M = { LANES, DIRECTIONS, mapBeat, mapExtra };
  if (typeof module !== "undefined" && module.exports) module.exports = { Mapper: M };
  if (typeof window !== "undefined") window.Mapper = M;
})();
