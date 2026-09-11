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

// The grid step the edit is quantised to. Median, not mean: one missing
// downbeat in a five-minute song doubles the mean and halves nothing.
function medianGap(ts) {
  if (!ts || ts.length < 4) return 0;
  const g = [];
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d > 0.2 && d < 6) g.push(d);
  }
  if (!g.length) return 0;
  g.sort(function (a, b) { return a - b; });
  return g[Math.floor(g.length / 2)];
}
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
  // `cuts_per_minute` is a RATE, and a global budget does not enforce a rate.
  // Ranking the whole song and taking the top N spends the budget wherever the
  // candidates are densest: this brief asked for 34 cuts a minute and the
  // passage at 4:02 got 51, because that stretch offers a strong half-bar
  // everywhere and the budget had no reason to say no. Locally that is a
  // different edit from the one the brief describes -- and against a 15-shot
  // film it means wrapping through the whole ad twice, so the same phone comes
  // back three times in twenty-six seconds. Repetition reads as a mistake.
  //
  // So the rate is enforced where it is felt: inside a sliding window, never
  // more than the brief's rate allows. Rank still decides WHICH candidates win,
  // so the strongest moments are still the ones that get the cuts.
  const RATE_WIN_S = 20.0;
  const perWin = Math.max(1, Math.round(perMin * RATE_WIN_S / 60));
  const localFull = function (t) {
    let n = 0;
    for (const x of chosen) if (Math.abs(x.t - t) <= RATE_WIN_S / 2) n++;
    return n >= perWin;
  };
  for (const c of ranked) {
    if (chosen.length >= allowed) { declined.push(c); continue; }
    if (localFull(c.t)) {
      declined.push(Object.assign({}, c, {
        over_rate: "the brief's " + perMin + " cuts/min is already spent in the " +
                   RATE_WIN_S + "s around this" }));
      continue;
    }
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
  // A ceiling that admits only ONE step of the grid is not a ceiling, it is a
  // quantiser. `fast` says max_shot_s 2.6; this song's bar is 1.905 s; so every
  // shot came out 0.95 or 1.91 and nothing else -- stdev 0.43 against the human
  // editor's 1.45 on the same footage. The brief's pacing should still bind,
  // but the grid needs somewhere to go, so the ceiling rounds up to two bars
  // when a single bar is all it would otherwise allow.
  const bar = medianGap(map.downbeats || []);
  let ceiling = maxS, ceilingNote = null;
  if (bar > 0 && maxS < 2 * bar) {
    ceiling = +(2 * bar).toFixed(3);
    ceilingNote = "brief max_shot_s " + maxS + "s admits one " + bar.toFixed(3) +
      "s bar and no more; raised to two bars so shot length can vary";
  }
  const cap = Math.min(ceiling, footageCap);
  const capBoundBy = ceiling <= footageCap
    ? (ceilingNote ? "brief-max-shot-raised-to-bar" : "brief-max-shot")
    : "footage-limit";
  const snapper = function (t) { return snap(t, beats); };
  const snapHard = function (t) { return snap(t, beats, true); };
  let edges, capped;
  if (brief.preserve_order) {
    // When the order is the film's, the LENGTHS are the film's too.
    //
    // Ranking the music and then forcing the footage to fit produced 22 cuts
    // where the brief asked for 15: every slot longer than the shot it landed
    // on had to be split, so the music was asked for one cut and the edit
    // performed two. Against a 15-shot film that wraps through the whole ad
    // twice and the same phone comes back three times in twenty-six seconds.
    //
    // Inverted: walk the film, and for each shot ask the music where to cut.
    // The shot proposes a length -- its own -- and the strongest candidate near
    // that length decides the instant. Nothing is split because nothing was
    // ever asked to stretch, every cut is still on a musical event, and the
    // film is used once through before it repeats.
    const orderOf = [], scratch = new Map();
    for (let q = 0; q < pool0.length; q++) {
      const c2 = ASSETS.nextInOrder(pool0, scratch, 0.5, brief);
      if (!c2) break;
      orderOf.push(c2);
    }
    const all = cands.slice().sort(function (a, b) { return a.t - b.t; });
    const best_fallback = function (lo, hi) {
      let b = null, bs = -1;
      for (const c of all) {
        const x = snapHard(c.t);
        if (x < lo || x > hi) continue;
        if ((c.strength || 0) > bs) { bs = c.strength || 0; b = x; }
      }
      // Never hand back a raw time. `hi` is where the SHOT runs out, which is
      // not a musical instant, and returning it put one cut 172 ms off the grid.
      return b === null ? snapHard(hi) : b;
    };
    edges = [0];
    let t = 0, k = 0;
    while (t < dur - minS && orderOf.length) {
      const sh = orderOf[k % orderOf.length]; k++;
      const room = Math.min(sh.duration - 0.02, cap);
      const lo = t + minS, hi = t + room;
      if (hi <= lo) { continue; }
      // The strongest musical candidate the shot can reach. Nearest-to-the-end
      // is the tie-break, so a shot is used for as much of itself as the music
      // allows rather than cut early on a marginally stronger beat.
      // LATEST first, strength second -- the opposite of everywhere else in
      // this file, and deliberately so. A 1.60 s shot against a grid of
      // 0.48 / 0.95 / 1.43 / 1.91 can only reach 1.43; scoring by strength took
      // the half bar at 0.95 and threw away two fifths of the shot, which is
      // why the edit kept coming out at 0.95 no matter what the film offered.
      // Here the shot's length is the proposal and the music's job is to place
      // the cut near it, so the last musical instant the shot can reach wins
      // and strength only breaks ties within half a second of it.
      const late = snapHard(hi);
      const at = (late >= lo && late <= hi) ? (function () {
        let b = late, bs = -1;
        for (const c of all) {
          const x = snapHard(c.t);
          if (x < late - 0.5 || x > hi || x < lo) continue;
          const sc = (c.strength || 0) + (x >= late - 0.01 ? 0.25 : 0);
          if (sc > bs) { bs = sc; b = x; }
        }
        return b;
      })() : (best_fallback(lo, hi));
      if (at <= t + 0.01 || at > dur) break;
      edges.push(at); t = at;
    }
    if (edges[edges.length - 1] < dur) edges.push(dur);
    capped = { edges: edges, forced: [] };
  } else {
    edges = [0].concat(chosen.map(function (c) { return snapper(c.t); }));
    edges.push(dur);
    capped = ASSETS.capSlots(edges, cap, declined, snapHard);
  }
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
  const footageCut = [], skippedShort = [];
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
    const start = edges[i];
    let end = edges[i + 1];
    let want = end - start;
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
    // Where the slot is cut short because the film's next shot cannot hold it.
    let splitAt = null;
    if (!s && brief.preserve_order) {
      // A slot the next shot cannot fill has to become a shorter slot, and the
      // cut that ends it must still be a musical one. Look for the strongest
      // candidate the budget declined inside the room the shot actually has.
      const roomFor = function (sh) {
        if (sh.duration + 0.02 >= want) return { ok: true, at: null };
        const room = start + sh.duration - 0.02;
        const here = declined.filter(function (c) {
          return c.t > start + minS && c.t <= room; });
        here.sort(function (a, b) { return (b.strength || 0) - (a.strength || 0); });
        // Snapping MOVES the point, and it can move it back outside the room --
        // a candidate at room-0.02 snapped forward to the next beat is past the
        // end of the shot again. Every test below is against `room`, not just
        // against the slot, which is what 11 surviving overruns in the
        // full-length edit were.
        const legal = function (x) {
          return x !== null && x - start >= minS && x <= room + 1e-6 && x < end; };
        let at = here.length ? snapHard(here[0].t) : null;
        if (!legal(at)) {
          at = null;
          for (const c of here) { const h = snapHard(c.t); if (legal(h)) { at = h; break; } }
        }
        if (!legal(at)) { const h = snapHard(room); at = legal(h) ? h : null; }
        if (!legal(at)) at = null;
        return at === null ? { ok: false, at: null }
                           : { ok: true, at: at, ref: here.length ? here[0].ref : null };
      };
      // Try the shot the film is up to. If it can neither fill the slot nor be
      // cut short legally -- a 0.80 s shot against a 0.95 s slot whose only
      // interior beat sits under the brief's 0.55 s minimum -- it is not a
      // candidate for this slot at all, and taking it anyway is what put 21
      // uninvited source cuts in the full-length edit. Move on. This skips only
      // shots too short to be cut into, so the order still reads forwards.
      for (let tries = 0; tries < pool.length; tries++) {
        const c2 = ASSETS.nextInOrder(pool, used, want, brief);
        if (!c2) break;
        const r = roomFor(c2);
        if (r.ok) { s = c2; splitAt = r.at; if (r.at !== null) footageCut.push({
            at: +r.at.toFixed(3), shot_is_s: +c2.duration.toFixed(3),
            slot_wanted_s: +want.toFixed(3),
            on: r.ref || "no declined candidate in range; snapped to the beat",
            why: "the film's next shot is shorter than the music's slot" }); break; }
        skippedShort.push({ at: +start.toFixed(3), shot: c2.shot,
          shot_is_s: +c2.duration.toFixed(3), slot_wanted_s: +want.toFixed(3),
          why: "too short to fill the slot and too short to cut inside it" });
      }
    }
    if (!s && !brief.preserve_order)
      s = ASSETS.choose(pool, want, used, prev, brief, seed,
                        prevKin, isBoundary(start),
                        cand ? cand.strength : 0,
                        ASSETS.moodAt(map, start), semIdx, prevWord);
    if (!s) continue;
    if (splitAt !== null) {
      edges.splice(i + 1, 0, splitAt);
      end = splitAt; want = end - start;
    }
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

  // A runt at the end is leftover, not a decision. The brief states a minimum
  // shot length; anything under it is folded into the shot before. Half the
  // minimum was the first threshold and it let a 0.33 s tail through against a
  // stated floor of 0.55.
  if (timeline.length > 1) {
    const last = timeline[timeline.length - 1];
    if (last.end - last.start < minS) {
      timeline[timeline.length - 2].end = last.end;
      timeline.pop();
    }
  }

  const spent = Math.max(0, timeline.length - 1);
  return {
    timeline: timeline,
    holds: holds,
    footage_cuts: footageCut,
    shots_too_short: skippedShort,
    budget: {
      allowed: allowed, spent: spent,
      candidates_available: cands.length,
      declined: declined.length,
      forced_without_musical_reason: capped.forced.length,
      forced_by: capBoundBy,
      ceiling_note: ceilingNote,
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
