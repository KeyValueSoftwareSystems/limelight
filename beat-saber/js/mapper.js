/* Beat-grid mapper: a beat becomes a note, deterministically.
   Pure and DOM-free so Node can test it. Quarter-note grid only. */
"use strict";
(function () {
  const LANES = 4;
  const DIRECTIONS = ["up", "down", "left", "right",
                      "up-left", "up-right", "down-left", "down-right"];

  // A stable 32-bit hash of a beat's musical position.
  // A well-mixed 32-bit hash (MurmurHash3 finalizer). A plain multiplicative
  // hash leaves the LOW bits unmixed, so `h % 4` / `h % 8` collapse back to a
  // trivial index cycle (blocks marched 1-2-3-0 down the lanes every bar). The
  // avalanche below spreads entropy into every bit, so lane/dir/colour vary.
  function hash(bar, beat) {
    let h = (bar * 4 + beat) | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
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
