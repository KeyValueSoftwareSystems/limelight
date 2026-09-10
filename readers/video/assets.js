// Shots, and how well each one suits a brief. One writer for both policies.
//
// policy_naive, policy_rules and policy_llm all have to pick clips. If each
// carried its own idea of "suits the brief", a difference between two edits
// could be a difference in taste or a difference in bookkeeping, and nobody
// could tell which -- which would make the whole A/B worthless. So the scoring
// lives here once, and the policies differ only in WHEN they cut and WHICH
// shot they ask for.
//
// Purity: fit(shot, brief) is a function of its two arguments. No clock, no
// randomness, no memory. Reuse and continuity are the caller's business,
// because they depend on what the caller has already placed.
"use strict";

const ASSETS = (function () {

  // How far outside a preferred range a value sits, as a fraction of the range.
  // Inside costs nothing. Outside costs proportionally, so a brief that wants
  // [0,70] px/s is unbothered by 40 and mildly bothered by 90.
  function outside(v, range) {
    if (v === null || v === undefined || !range) return 0;
    const [lo, hi] = range;
    const span = Math.max(1e-6, hi - lo);
    if (v < lo) return (lo - v) / span;
    if (v > hi) return (v - hi) / span;
    return 0;
  }

  // The measured fields a brief is allowed to express a preference about.
  // A brief naming anything else is asking for a guess; briefs/check.py
  // refuses it rather than silently ignoring it.
  const PREFERABLE = ["camera_motion_px_s", "subject_motion_px_s",
                      "brightness", "contrast", "saturation", "faces"];

  // 1.0 is a shot squarely inside every preference; 0.0 is hopeless.
  function fit(shot, brief) {
    const prefs = (brief && brief.prefers) || {};
    let penalty = 0, n = 0;
    for (const k of PREFERABLE) {
      if (!(k in prefs)) continue;
      const v = shot[k];
      // A field the index could not measure is not a field the shot fails.
      // faces === null means nothing looked; scoring it as 0 faces would
      // invent a measurement.
      if (v === null || v === undefined) continue;
      penalty += Math.min(2, outside(v, prefs[k]));
      n += 1;
    }
    if (!n) return 0.5;   // nothing comparable: neutral, not good, not bad
    return 1 / (1 + penalty / n);
  }

  // Every shot of every clip, flattened, with its fit already computed.
  function shots(index, brief) {
    const out = [];
    for (const c of index.clips || []) {
      (c.shots || []).forEach(function (s, i) {
        if (s.duration < 0.35) return;
        out.push(Object.assign({}, s, {
          clip_id: c.clip_id, shot: i,
          clip_duration: c.duration_s,
          fit: fit(s, brief)
        }));
      });
    }
    return out;
  }

  // Pick a shot for a slot of `want` seconds.
  //
  // The caller passes what it has already used, because reuse is a property of
  // the edit and not of the footage. `avoid` is the clip most recently on
  // screen: cutting from a clip to itself reads as a jump cut, which is a real
  // effect and not one anybody asked for here.
  function choose(pool, want, used, avoid, brief, seed) {
    const maxReuse = (brief.callbacks && brief.callbacks.max_reuses_per_clip) || 2;
    let best = null, bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (s.clip_id === avoid) continue;
      const times = used.get(s.clip_id) || 0;
      if (times >= maxReuse) continue;
      // Can this shot supply the requested duration? Shots that cannot are
      // only considered when nothing else is left, and the caller is expected
      // to have capped `want` to what the footage can actually deliver -- a
      // 10.96-second clip placed in a 34.69-second slot is how the compiler
      // came to be handed an in-point past the end of its source.
      const have = s.duration;
      if (have + 0.02 < want) continue;
      // Prefer shots with room to spare, but do not prefer a 40-second shot
      // for a 1-second slot -- that is how a whole edit ends up inside one
      // clip.
      const room = Math.min(1, have / Math.max(0.2, want));
      const fresh = 1 / (1 + times);
      // Deterministic tie-break. Not randomness: the same seed and the same
      // inputs must give the same edit, or nothing here is reproducible.
      const jitter = ((Math.imul(hash(s.clip_id + ":" + s.shot), seed || 1) >>> 8) % 1000) / 1e5;
      const score = s.fit * 0.6 + room * 0.25 + fresh * 0.15 + jitter;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Where inside the chosen shot to start, so that a `want`-second slot fits.
  // Centred, because the middle of a shot is usually the part worth showing --
  // the head has the previous cut's motion in it and the tail is often a
  // camera settling.
  function inPoint(shot, want) {
    const slack = Math.max(0, shot.duration - want);
    return +(shot.start + slack / 2).toFixed(3);
  }

  // The longest slot the footage can fill without repeating itself inside one
  // shot. A cut forced by this limit is NOT a musical decision and must never
  // be recorded as one -- see `footage-limit` in the policies.
  function longest(pool) {
    let m = 0;
    for (const s of pool) if (s.duration > m) m = s.duration;
    return m;
  }

  // Split any stretch longer than `cap`, preferring a real musical candidate
  // inside it and falling back to the grid. Returns the new edge list plus the
  // times that were forced, so the caller can label them honestly.
  function capSlots(edges, cap, declined, snapTo) {
    const out = [edges[0]], forced = [];
    for (let i = 1; i < edges.length; i++) {
      let a = out[out.length - 1];
      const b = edges[i];
      while (b - a > cap) {
        const inner = (declined || [])
          .filter(function (c) { return c.t > a + cap * 0.35 && c.t < Math.min(b, a + cap); })
          .sort(function (x, y) { return y.strength - x.strength; })[0];
        let t = inner ? inner.t : a + cap;
        t = snapTo ? snapTo(t) : t;
        if (!(t > a + 0.05) || t >= b - 0.05) { t = a + cap; }
        if (!inner) forced.push(t);
        out.push(+t.toFixed(3));
        a = out[out.length - 1];
      }
      out.push(b);
    }
    return { edges: Array.from(new Set(out)).sort(function (x, y) { return x - y; }),
             forced: forced };
  }

  return { fit: fit, shots: shots, choose: choose, inPoint: inPoint,
           hash: hash, longest: longest, capSlots: capSlots,
           PREFERABLE: PREFERABLE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ASSETS;
