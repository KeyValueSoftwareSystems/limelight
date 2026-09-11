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
  //
  // A long shot is cut into several MOMENTS. A 20-second take holds five
  // different four-second pictures, and treating it as one choice is why an
  // edit built from 13 clips kept returning to the same few images -- "the same
  // clips again and again". The measurements are the shot's; what differs is
  // where in it we enter, which is exactly what an editor is choosing when they
  // pick a moment out of a take.
  function shots(index, brief, sliceLen) {
    const out = [];
    const SL = sliceLen || 4.5;
    for (const c of index.clips || []) {
      (c.shots || []).forEach(function (s, i) {
        if (s.duration < 0.35) return;
        const n = Math.max(1, Math.floor(s.duration / SL));
        if (n > 1) {
          const w = s.duration / n;
          for (let k = 0; k < n; k++) {
            out.push(Object.assign({}, s, {
              clip_id: c.clip_id, shot: i,
              moment: k, moments_in_shot: n,
              start: +(s.start + k * w).toFixed(3),
              end: +(s.start + (k + 1) * w).toFixed(3),
              duration: +w.toFixed(3),
              clip_duration: c.duration_s,
              source_category: c.source_category || null,
              look: s.look || null,
              fit: fit(s, brief)
            }));
          }
          return;
        }
        out.push(Object.assign({}, s, {
          clip_id: c.clip_id, shot: i,
          clip_duration: c.duration_s,
          // The source's category. Not a measurement and not trusted as one --
          // it is the only signal available about whether two shots belong to
          // the same world, and it is the source's opinion. A real subject
          // model would replace it.
          source_category: c.source_category || null,
          look: s.look || null,
          fit: fit(s, brief)
        }));
      });
    }
    return out;
  }

  // Pick a shot for a slot of `want` seconds.
  //
  // `avoid` is the clip most recently on screen and `kin` is the world it came
  // from -- the source's own category, which is the only thing here that knows
  // two shots belong together.
  //
  // THIS FUNCTION USED TO OPTIMISE FOR INCOHERENCE, and it is worth stating
  // plainly because the effect was severe and invisible in every number the
  // scorer produced. It refused to reuse the previous clip and it scored unused
  // clips higher, so across a 38-shot edit it selected 38 different clips and
  // changed subject on 92% of cuts: snow, then a flower, then a server room.
  // Timing was fine. A person watched three edits built this way and rejected
  // all three -- "random clips pieced together without any emotion" -- and was
  // right. Optimising for variety IS optimising for incoherence.
  //
  // Now the default pull is the other way: staying in the same world is
  // rewarded, and `allowKin` lets the caller relax that at a structural
  // boundary, where a change of subject is the point rather than an accident.
  // `impact` is how big the moment being cut TO is, 0 to 1.
  //
  // Without it every cut is chosen the same way, and the climax gets whatever
  // happened to fit -- on one render the two tightest shots in the piece, the
  // 0.94 s pair landing exactly on the drop, were a static drum cymbal. A
  // drop deserves the most alive picture available, not a picture that merely
  // suits the brief's ranges. At impact 1 the choice leans hard on movement and
  // on faces; at impact 0 it does not lean at all, so ordinary bars still get
  // continuity rather than spectacle.
  function choose(pool, want, used, avoid, brief, seed, kin, allowKin, impact) {
    const imp = Math.max(0, Math.min(1, impact || 0));
    // Normalised against the pool, so "a lot of movement" means a lot for this
    // footage rather than a number carried over from other footage.
    let maxSub = 0;
    for (const s of pool) if ((s.subject_motion_px_s || 0) > maxSub) maxSub = s.subject_motion_px_s || 0;
    const maxReuse = (brief.callbacks && brief.callbacks.max_reuses_per_clip) || 2;
    let best = null, bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      // Cutting from a clip straight back to itself reads as a jump cut, which
      // is a real effect and not one anybody asked for here.
      if (s.clip_id === avoid) continue;
      // TWO counters, because one was not enough.
      //
      // Reuse was counted per MOMENT, so a clip cut into six moments could
      // appear six times and never reach its per-clip cap. With 36 clips
      // available an edit came out using four, alternating two of them -- the
      // exact repetition this was supposed to prevent. The per-moment count
      // stops the same picture coming back; the per-clip count stops the same
      // SOURCE dominating, and it is the one a brief is talking about.
      const mkey = s.clip_id + "#" + s.shot + "#" + (s.moment || 0);
      if ((used.get(mkey) || 0) >= 1) continue;
      if ((used.get(s.clip_id) || 0) >= maxReuse) continue;
      const times = used.get(s.clip_id) || 0;
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
      // Mild, so that a shot is not reused three times in a row, but nowhere
      // near strong enough to drive the edit. It used to be a headline term.
      const fresh = 1 / (1 + times);
      // Continuity. Same world as the outgoing shot is what makes a sequence
      // read as one place rather than a slideshow. At a structural boundary the
      // caller passes allowKin and this term is dropped, so the picture changes
      // where the music does.
      const same = (kin && s.source_category === kin) ? 1 : 0;
      const cont = allowKin ? 0 : same;
      const jitter = ((Math.imul(hash(s.clip_id + ":" + s.shot + ":" + (s.moment || 0)),
                                 seed || 1) >>> 8) % 1000) / 1e5;
      // How striking this shot is, on its own terms: movement, a face, colour.
      const sub = maxSub > 0 ? Math.min(1, (s.subject_motion_px_s || 0) / maxSub) : 0;
      const face = s.faces ? 1 : 0;
      const alive = 0.55 * sub + 0.25 * face + 0.20 * Math.min(1, (s.saturation || 0) / 0.7);
      const score = (1 - 0.45 * imp) * (s.fit * 0.42 + cont * 0.32 + room * 0.14 + fresh * 0.12)
                    + 0.45 * imp * alive + jitter;
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

  // Keep only the shots that LOOK like each other.
  //
  // Coherence was first attempted with the source's category name and that was
  // not good enough: "street" held a neon alley at night and a desert highway
  // at sunset, "city" held green hills. Cut together the result read as random
  // to a viewer even though the label said otherwise.
  //
  // `look` is 36 numbers of measured appearance per shot. This finds the
  // densest cluster -- the shot with the most neighbours inside `radius`, then
  // everything inside that radius -- and returns it. Not k-means: there is no k
  // worth guessing here, and the question is not "what groups exist" but "what
  // is the biggest group that looks like itself".
  //
  // Returns the whole pool unchanged if nothing was measured, because a pool
  // filtered on a field nobody wrote would be filtered on nothing.
  function cohere(pool, radius, minKeep) {
    const withLook = pool.filter(function (s) {
      return Array.isArray(s.look) && s.look.length >= 12;
    });
    if (withLook.length < (minKeep || 8)) return pool;
    function dist(a, b) {
      let d = 0;
      for (let i = 0; i < a.look.length; i++) {
        const x = a.look[i] - b.look[i];
        d += x * x;
      }
      return Math.sqrt(d / a.look.length);
    }
    // Which cluster, not just the biggest one. Density alone picked "dark
    // things" -- a tape deck, three star fields and a train all measure dark
    // and share nothing else. Weighting by how well the members suit the brief
    // lets a brief that wants people and movement land on the cluster of
    // people moving rather than on the cluster of night sky.
    const r = radius || 0.16;
    let best = null, bestScore = -1;
    for (const c of withLook) {
      let n = 0, fitSum = 0;
      for (const o of withLook) {
        if (dist(c, o) <= r) { n++; fitSum += o.fit; }
      }
      if (n < 4) continue;
      const score = n * (fitSum / n) * (fitSum / n);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return pool;
    const kept = withLook.filter(function (s) { return dist(best, s) <= r; });
    return kept.length >= (minKeep || 8) ? kept : pool;
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
  // `cap` may be a number or a function of the stretch's start time, so that a
  // deliberate HOLD can be exempt from the brief's max_shot_s while still
  // obeying the footage limit. A hold is an explicit decision not to cut;
  // max_shot_s is a default about ordinary shots. Letting the default override
  // the decision is how a model's 29-second hold came back as four cuts.
  function capSlots(edges, cap, declined, snapTo) {
    const capAt = typeof cap === "function" ? cap : function () { return cap; };
    const out = [edges[0]], forced = [];
    for (let i = 1; i < edges.length; i++) {
      let a = out[out.length - 1];
      const b = edges[i];
      while (b - a > capAt(a)) {
        const cap = capAt(a);
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
           hash: hash, longest: longest, capSlots: capSlots, cohere: cohere,
           PREFERABLE: PREFERABLE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ASSETS;
