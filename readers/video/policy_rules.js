// Spend a fixed amount of visual attention where the song is worth it.
//
// The argument this policy makes, and the only one it makes: a musical event is
// an OPPORTUNITY to cut, not an instruction to. There is a budget, the budget is
// smaller than the number of opportunities, and so the interesting work is
// deciding which opportunities to decline.
//
// Everything below reads the map and the brief. Nothing below knows what genre
// the footage is, and no constant here was chosen by looking at how a particular
// song came out -- the numbers that shape an edit live in briefs/*.json, which
// is why there are three of them that disagree.
//
// WHERE THE CANDIDATES COME FROM. Not the beat grid. Cutting on beats is what
// policy_naive does and it is why every beat-synced edit feels the same. The
// candidates are the places the map says something CHANGED:
//
//   moments      the six kinds, ranked by observations.salience
//   chapters     a named section beginning
//   phrase_grid  the finest phrase boundary the music actually supports
//   spans        the start and end of a build or a quiet passage
//
// Beats are used for one thing only: snapping a chosen cut to the grid, so a
// cut lands with the music rather than 30 ms behind it.
"use strict";
const ASSETS = require("./assets.js");

// How much a candidate of each kind is worth before salience is considered.
// Ordering, not tuning: a section boundary is a bigger visual permission than a
// phrase boundary, which is bigger than a bar line.
const KIND_WEIGHT = {
  drop: 1.00, stop: 0.92, build: 0.72, return: 0.70,
  spotlight: 0.62, quiet: 0.55,
  chapter: 0.66, span_start: 0.58, span_end: 0.54, phrase: 0.34,
  // Half a bar. The finest division this will offer, and it exists because a
  // colour-block phone ad cuts twice a bar and the candidate set stopped at
  // one: with bars as the floor, every shot in a 22-second cut came out at
  // exactly 1.88 s. Weighted below a bar so only a brief that explicitly drops
  // its floor can reach it -- which is what keeps this from turning back into a
  // beat-cutter by default.
  half_bar: 0.13,
  // A bar line is a real musical boundary and the weakest one worth naming.
  // It is here because the candidate set otherwise stopped at the phrase grid,
  // which on Levels is two bars -- 3.75 s at 128 bpm -- so no brief could ask
  // for a shot shorter than that however large its budget. A vertical reel
  // legitimately cuts at bar rate. It is weighted far below a phrase so that a
  // restrained brief never reaches it, which is what keeps this from quietly
  // turning back into a beat-cutter.
  bar: 0.20
};

// How much a candidate is worth more at the END of a build than at its start.
const BUILD_LIFT = 1.9;

function candidates(map, dur, derive) {
  const out = [];
  // How far through a build we are, 0 outside one.
  //
  // A build is the one place where the right number of cuts CHANGES across the
  // span: tension rises, so the picture should tighten with it. Without this a
  // build reads as dead air -- energy is low, so nothing cleared the floor and
  // a 20-second build came out as two shots. Accelerating into a drop is not a
  // trick, it is what the span means.
  const builds = (map.spans || []).filter(function (s) { return s.kind === "build"; });
  function buildProgress(t) {
    for (const b of builds) {
      if (b.from === undefined || b.to === undefined || b.to <= b.from) continue;
      if (t >= b.from && t < b.to) return (t - b.from) / (b.to - b.from);
    }
    return 0;
  }
  function push(t, kind, ref) {
    if (!(t > 0.05) || t >= dur - 0.05) return;
    // Salience comes from derive.js, not from the map: everything it needs is
    // already in the file, so writing it into the map would be a second copy of
    // a fact (rule 3). It is UNCORROBORATED -- bench/salience-check.py could not
    // find a witness that discriminates -- so where it is used, it is recorded.
    const s = derive && derive.salienceAt ? derive.salienceAt(t) : null;
    const kw = KIND_WEIGHT[kind] || 0.4;
    // The kind and the measurement are both evidence and neither is authority.
    // Blending them keeps a drop a drop even where the arithmetic is unexcited,
    // and lets a strong measured change promote a mere phrase boundary.
    const base = s ? (0.5 * kw + 0.5 * s.value) : kw;
    // Tighten toward the end of a build. Quadratic, so the last quarter of the
    // span is where the cutting really gathers, which is where a listener feels
    // it gathering.
    const bp = buildProgress(t);
    const lift = bp > 0 ? 1 + BUILD_LIFT * bp * bp : 1;
    out.push({
      t: t, kind: kind, ref: ref,
      strength: +(base * lift).toFixed(4),
      strength_is: s ? "kind+salience(uncorroborated)" : "kind_only",
      salience: s ? s.value : null,
      build_progress: bp > 0 ? +bp.toFixed(3) : null
    });
  }
  (map.moments || []).forEach(function (m, i) {
    push(m.at, m.kind, "moments[" + i + "]");
  });
  (map.chapters || []).forEach(function (c, i) {
    if (i === 0) return;
    push(c.at, "chapter", "chapters[" + i + "]:" + c.name);
  });
  (map.spans || []).forEach(function (s, i) {
    push(s.from, "span_start", "spans[" + i + "]:" + s.kind);
    push(s.to, "span_end", "spans[" + i + "]:" + s.kind);
  });
  const pg = map.observations && map.observations.phrase_grid;
  const phraseAt = (pg && Array.isArray(pg.at)) ? pg.at : [];
  phraseAt.forEach(function (t, i) { push(t, "phrase", "phrase_grid.at[" + i + "]"); });
  // Bar lines that are not already phrase boundaries.
  const downs = map.downbeats || [];
  downs.forEach(function (t, i) {
    if (phraseAt.some(function (p) { return Math.abs(p - t) < 0.05; })) return;
    push(t, "bar", "downbeats[" + i + "]");
  });
  // And the midpoint between consecutive bars.
  for (let i = 0; i + 1 < downs.length; i++) {
    const mid = (downs[i] + downs[i + 1]) / 2;
    if (phraseAt.some(function (p) { return Math.abs(p - mid) < 0.05; })) continue;
    push(mid, "half_bar", "downbeats[" + i + "]+half");
  }
  // One candidate per instant: a drop that is also a chapter start is one
  // opportunity, not two, and must not be counted twice against the budget.
  const seen = new Map();
  for (const c of out) {
    const k = c.t.toFixed(2);
    const prev = seen.get(k);
    if (!prev || c.strength > prev.strength) seen.set(k, c);
  }
  return Array.from(seen.values()).sort(function (a, b) { return a.t - b.t; });
}

function snap(t, beats, hard) {
  if (!beats || !beats.length) return t;
  let best = beats[0], bd = Math.abs(t - beats[0]);
  for (const b of beats) {
    const d = Math.abs(t - b);
    if (d < bd) { bd = d; best = b; }
  }
  // A cut chosen FOR a musical moment only snaps if the grid is genuinely
  // nearby -- dragging it half a second to reach a beat would move it off the
  // thing it was chosen for.
  //
  // A cut forced by a length cap is different, and `hard` is that case. It was
  // not chosen for anything; it exists because the brief will not tolerate a
  // longer shot. Leaving it at an arbitrary instant costs alignment for no
  // reason, and it was costing a lot: half of these landed off-grid, they are
  // 17 of the rules policy's 37 cuts, and the policy scored BELOW its own null
  // on the share of cuts landing on an onset. A cut with no musical reason has
  // no reason to be off the beat either.
  return (hard || bd <= 0.12) ? best : t;
}

function run(ctx) {
  const { map, brief, index, seed, derive } = ctx;
  // Slots outside the exported window still exist -- they shape the arc, the
  // holds and the budget -- but they do not consume footage.
  const win = ctx.window || null;
  function exported(a, b) {
    return !win || (b > win.from + 1e-6 && a < win.to - 1e-6);
  }
  const dur = ctx.length_s;
  const B = brief.budgets || {};
  const R = brief.restraint || {};
  const perMin = B.cuts_per_minute || 20;
  const allowed = Math.max(1, Math.round(perMin * dur / 60));
  const minS = B.min_shot_s || 0.5, maxS = B.max_shot_s || 8.0;
  const floor = brief.salience_floor === undefined ? 0.5 : brief.salience_floor;

  const cands = candidates(map, dur, derive).filter(function (c) {
    return c.strength >= floor;
  });

  // The big moments this edit is saving itself for. Headroom is defined against
  // these and nothing else.
  const majors = cands.filter(function (c) { return c.strength >= 0.8; });
  const holdBefore = R.hold_before_major_s || 0;

  function inHoldWindow(t) {
    for (const m of majors) {
      if (t < m.t && m.t - t <= holdBefore) return m;
    }
    return null;
  }

  // Rank by strength, take the budget, then re-sort by time. This is the whole
  // idea: the strongest N opportunities get the cuts and the rest are declined.
  const ranked = cands.slice().sort(function (a, b) { return b.strength - a.strength; });
  const chosen = [];
  const declined = [];
  for (const c of ranked) {
    if (chosen.length >= allowed) { declined.push(c); continue; }
    const held = R.allow_no_change === false ? null : inHoldWindow(c.t);
    if (held && c.strength < 0.8) {
      // Deliberately declined: cutting here would spend the contrast that the
      // upcoming moment is being saved for.
      declined.push(Object.assign({}, c, { held_for: held }));
      continue;
    }
    if (chosen.some(function (x) { return Math.abs(x.t - c.t) < minS; })) {
      declined.push(c);
      continue;
    }
    chosen.push(c);
  }
  chosen.sort(function (a, b) { return a.t - b.t; });

  // A shot longer than the brief allows is broken up on the strongest declined
  // candidate inside it -- not on a timer. Where the music offered nothing at
  // all, the shot would stay long, except that the FOOTAGE has a limit too: no
  // clip here is longer than a minute, and asking for a 35-second shot from an
  // 11-second one is what made the compiler refuse this file the first time.
  //
  // So there are two caps, and they mean different things. The brief's
  // max_shot_s is a creative decision. The footage limit is not a decision at
  // all, and any cut it forces is labelled `footage-limit` so that nobody
  // later reads it as the system having found something in the music.
  const beats = map.beats || [];
  const pool0 = ASSETS.selectBySubject(
    ASSETS.cohere(ASSETS.shots(index, brief),
                  (brief.coherence || {}).radius,
                  (brief.coherence || {}).min_shots),
    brief, ctx.sem, (brief.subject_tolerance || undefined),
    (brief.subject_min_shots || undefined));
  const footageCap = Math.max(1.0, ASSETS.longest(pool0) - 0.05);
  // WHICH cap binds changes what the resulting cut MEANS, so it is recorded.
  // The brief's max_shot_s is a creative instruction: this job does not want a
  // shot longer than nine seconds. The footage limit is not an instruction at
  // all -- it is an accident of what was downloaded. Labelling both
  // "footage-limit" would let a brief's own decision masquerade as an external
  // constraint, which is the kind of thing that is impossible to spot later.
  const cap = Math.min(maxS, footageCap);
  const capBoundBy = maxS <= footageCap ? "brief-max-shot" : "footage-limit";
  const snapper = function (t) { return snap(t, beats); };
  const snapHard = function (t) { return snap(t, beats, true); };
  let edges = [0].concat(chosen.map(function (c) { return snapper(c.t); }));
  edges.push(dur);
  const capped = ASSETS.capSlots(edges, cap, declined, snapHard);
  edges = capped.edges;
  const forced = new Set(capped.forced.map(function (t) { return t.toFixed(3); }));

  // Holds: the stretches where the policy could have cut and chose not to.
  const holds = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    if (b - a < (R.min_rest_s || 0)) continue;
    const skipped = declined.filter(function (c) { return c.t > a && c.t < b; });
    if (!skipped.length) continue;
    const forMoment = skipped.find(function (c) { return c.held_for; });
    holds.push({
      start: +a.toFixed(3), end: +b.toFixed(3),
      reason: forMoment
        ? "headroom for " + forMoment.held_for.kind + "@" +
          forMoment.held_for.t.toFixed(2)
        : "budget spent on stronger moments elsewhere",
      declined: skipped.length,
      evidence: skipped.slice(0, 4).map(function (c) { return c.ref; })
        .concat(forMoment ? ["brief.restraint.hold_before_major_s"] : [])
    });
  }

  const pool = pool0;
  const used = new Map();
  const timeline = [];
  let prev = null, prevKin = null, prevWord = null;
  // Where the picture is ALLOWED to change world: a named section beginning.
  // Everywhere else the chooser holds the world it is in, so a run of shots
  // reads as one place. This is the map earning its keep for video -- chapters
  // were already there and the first version of this ignored them.
  const chapterAt = (map.chapters || []).map(function (c) { return c.at; });
  const semIdx = ASSETS.semanticIndex(ctx.sem);
  function isBoundary(t) {
    return chapterAt.some(function (c) { return Math.abs(c - t) < 0.75; });
  }
  // Repeated music can get repeated picture. `identity` says which bar repeats
  // which earlier bar; when a section repeats, the policy is allowed to reach
  // back for the clip it used the first time.
  const callback = brief.callbacks && brief.callbacks.repeat_visual_on_repeated_music;
  const placedAt = [];

  function forcedHere(t) { return forced.has(Number(t).toFixed(3)); }

  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i], end = edges[i + 1];
    const want = end - start;
    if (want < 0.15) continue;
    if (!exported(start, end)) continue;
    const cand = chosen.find(function (c) { return Math.abs(snap(c.t, beats) - start) < 1e-6; });

    let s = null, why = null;
    // A callback reaches BACK to an earlier picture, which is exactly the thing
    // preserve_order exists to forbid.
    if (callback && !brief.preserve_order) {
      const back = repeatOf(map, start, derive);
      if (back !== null) {
        const earlier = placedAt.find(function (p) { return Math.abs(p.t - back) < 1.2; });
        // A callback must not be to the shot that is already on screen. Coming
        // back to an image when the music comes back around is the point;
        // cutting from a clip to itself is a jump cut nobody asked for, and the
        // callback path was bypassing the check that prevents it everywhere
        // else.
        if (earlier && earlier.clip_id === prev) {
          // fall through to an ordinary choice
        } else if (earlier) {
          s = pool.find(function (x) {
            return x.clip_id === earlier.clip_id && x.shot === earlier.shot;
          });
          if (s && s.duration >= Math.min(want, 0.5)) {
            why = "callback: this bar repeats " + back.toFixed(2);
          } else { s = null; }
        }
      }
    }
    if (!s) s = brief.preserve_order
      ? ASSETS.nextInOrder(pool, used, want, brief)
      : ASSETS.choose(pool, want, used, prev, brief, seed,
                      prevKin, isBoundary(start),
                      cand ? cand.strength : 0,
                      ASSETS.moodAt(map, start), semIdx, prevWord);
    if (!s) continue;
    (function () {
      const mk = s.clip_id + "#" + s.shot + "#" + (s.moment || 0);
      used.set(mk, (used.get(mk) || 0) + 1);
      used.set(s.clip_id, (used.get(s.clip_id) || 0) + 1);
    })();
    prev = s.clip_id + "#" + s.shot;
    placedAt.push({ t: start, clip_id: s.clip_id, shot: s.shot });
    prevKin = s.source_category;
    (function () {
      const r0 = semIdx && semIdx.get(s.clip_id + "#" + s.shot);
      prevWord = (r0 && r0.content_top) ? r0.content_top[0] : null;
    })();
    timeline.push({
      start: +start.toFixed(3), end: +end.toFixed(3),
      clip_id: s.clip_id, shot: s.shot,
      in_s: ASSETS.inPoint(s, want),
      because: forcedHere(start)
        ? { rule: capBoundBy,
            salience: null, salience_is: null,
            not_a_musical_cut: capBoundBy === "brief-max-shot"
              ? "the brief caps a shot at " + maxS + "s; the music did not ask " +
                "for this cut"
              : "no clip is long enough to hold this stretch; the music did " +
                "not ask for this cut",
            evidence: [capBoundBy === "brief-max-shot"
              ? "brief.budgets.max_shot_s=" + maxS
              : "assets.longest=" + footageCap.toFixed(2) + "s"] }
        : {
            rule: why || (cand ? "moment:" + cand.kind : "length-cap"),
            salience: cand ? +cand.strength.toFixed(3) : null,
            salience_is: cand ? cand.strength_is : null,
            evidence: cand ? [cand.ref] : ["brief.budgets.max_shot_s"]
          }
    });
  }

  const spent = Math.max(0, timeline.length - 1);
  return {
    timeline: timeline,
    holds: holds,
    budget: {
      allowed: allowed, spent: spent,
      candidates_available: cands.length,
      declined: declined.length,
      forced_without_musical_reason: capped.forced.length,
      forced_by: capBoundBy,
      why_underspent: spent < allowed
        ? "no further candidate cleared salience_floor " + floor
        : null
    }
  };
}

// Which earlier time does the music at t repeat? From observations.identity,
// which is measured per bar and is the only field that answers this.
function repeatOf(map, t, derive) {
  const id = map.observations && map.observations.identity;
  if (!id || !Array.isArray(id.entries)) return null;
  let best = null, bd = 1e9;
  for (const e of id.entries) {
    if (e.same_as === null || e.same_as === undefined) continue;
    const d = Math.abs(e.at - t);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best || bd > 1.5) return null;
  const src = id.entries[best.same_as];
  return src ? src.at : null;
}

module.exports = { run: run, id: "rules", label: "budget over musical events",
                   candidates: candidates };
