/* A session: the client side of the protocol.  OWNER: whoever is nearest.
   ---------------------------------------------------------------------------
   The hub answers in bars and beats. An application thinks in seconds, or in
   milliseconds, or in frames. This is the only place those two meet, and it
   runs on the application's machine.

   That placement is the whole design. Because the conversion lives here and
   not on the wire, a tempo change costs one number: `rate` moves, every bar
   and beat we were given is still correct, and nothing is refetched. And
   because interpolation lives here too, one payload of five points serves a
   game reading four times a second and a lighting rig reading forty-four.

   No network. Give it a plan and a window and it answers offline forever --
   which is what "the session degrades to the score" means in practice.

     const s = Session(plan, window);
     s.at(69.4)              -> { amount: 0.78, pulse: {...} }  values now
     s.between(69.4, 71.4)   -> [ {in_ms: 0, ...}, ... ]        what is coming
     s.describe()            -> { drops: [...], sections: [...] }
     s.rate(1.2)             -> the transform. Costs nothing.
*/
"use strict";

function Session(plan, win) {
  if (!plan || !plan.grid) throw new Error("a session needs a plan with a grid");
  const G = win && win.grid ? win.grid : plan.grid;
  const bpb = G.beats_per_bar || 4;
  const phase = G.first_beat_s || 0;
  let rate = 1;                       /* the one number a tempo change moves */

  /* ---- the bridge, and the only place seconds appear ---------------------- */
  const barSec = () => G.bar_seconds / rate;
  const beatSec = () => G.beat_seconds / rate;

  /* JavaScript's % keeps the sign of the dividend, so anything before the first
     beat came back negative: a pulse phase of -0.476 and, downstream, a
     brightness of 2.057. Music has no negative beat, so every wrap goes through
     here. */
  const mod = (x, m) => ((x % m) + m) % m;

  function posAt(t) {
    const b = (t - phase / rate) / barSec();
    return { bar: Math.floor(b) + 1,
             beat: +(mod(b, 1) * bpb + 1).toFixed(3),
             before_grid: b < 0 };   /* the pre-roll is honest, not bar zero */
  }
  function secondsAt(bar, beat) {
    return phase / rate + (bar - 1) * barSec() + ((beat || 1) - 1) * beatSec();
  }
  /* bars are a real line, not a pair, so comparisons are one subtraction */
  const flat = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);

  /* ---- curves: sparse points plus a shape, interpolated here -------------- */
  const SHAPE = {
    swell:   u => Math.sin((Math.PI / 2) * u),    /* fast in, easing out */
    deepen:  u => u * u,                          /* slow in, arriving late */
    release: u => 1 - (1 - u) * (1 - u),
    hold:    () => 1,
    linear:  u => u,
  };
  function sample(curve, pos) {
    const pts = (curve && curve.points) || [];
    if (!pts.length) return null;
    const x = flat(pos);
    if (x <= flat(pts[0][0])) return pts[0][1];
    if (x >= flat(pts[pts.length - 1][0])) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = flat(pts[i][0]), b = flat(pts[i + 1][0]);
      if (x >= a && x <= b) {
        const u = b === a ? 0 : (x - a) / (b - a);
        const f = (SHAPE[curve.shape] || SHAPE.linear)(u);
        return +(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f).toFixed(4);
      }
    }
    return pts[pts.length - 1][1];
  }

  /* ---- what the plan said about each field ------------------------------- */
  const byKey = {};
  for (const f of (plan.fields || [])) byKey[f.key] = f;
  const usable = k => {
    const f = byKey[k];
    return !f || f.outcome !== "unpayable";
  };

  /* ---- the three reads ---------------------------------------------------- */
  function at(t) {
    const pos = posAt(t);
    const out = { t, position: pos };
    const F = (win && win.fields) || {};
    if (F.amount && usable("amount")) out.amount = sample(F.amount, pos);
    if (F.pulse && usable("pulse")) {
      const within = mod(flat(pos), 1);               /* 0 at the beat */
      const beatIndex = Math.floor(flat(pos));
      const accent = (F.pulse.accent_on_beats || [1])
        .includes((beatIndex % bpb) + 1);
      out.pulse = { phase: +within.toFixed(3), accent,
                    to_next_beat_s: +((1 - within) * beatSec()).toFixed(4) };
      if (pos.before_grid) out.pulse.before_grid = true;
    }
    out.span = (win && win.spans || []).find(s2 =>
      flat(pos) >= flat(s2.from) && flat(pos) < flat(s2.to)) || null;
    return out;
  }

  /* What begins in the next stretch, already converted to the caller's clock.
     A game asks in seconds of lead and gets milliseconds, because that is what
     it will actually schedule against. */
  function between(t0, t1) {
    const p0 = posAt(t0), p1 = posAt(t1), out = [];
    if (win && win.fields && win.fields.pulse && usable("pulse")) {
      const first = Math.ceil(flat(p0)), last = flat(p1);
      for (let i = first; i < last; i++) {
        const bar = Math.floor(i / bpb) + 1, beat = (i % bpb) + 1;
        out.push({ what: "beat", at: { bar, beat },
                   accent: (win.fields.pulse.accent_on_beats || [1]).includes(beat),
                   in_ms: Math.round((secondsAt(bar, beat) - t0) * 1000) });
      }
    }
    for (const m of (win && win.moments) || []) {
      if (flat(m.at) < flat(p0) || flat(m.at) >= flat(p1)) continue;
      if (!usable(m.field)) continue;
      out.push({ what: m.kind, field: m.field, at: m.at,
                 in_ms: Math.round((secondsAt(m.at.bar, m.at.beat) - t0) * 1000) });
    }
    return out.sort((a, b) => a.in_ms - b.in_ms);
  }

  /* No timeline at all. For anything writing a file rather than performing. */
  function describe() {
    const W = win || {};
    const drops = (W.moments || []).filter(m => m.kind === "drop");
    return {
      song: plan.song, bpm: G.bpm,
      drops: drops.map(d => ({ at: d.at, seconds: +secondsAt(d.at.bar, d.at.beat).toFixed(2) })),
      sections: (W.spans || []).map(s2 => ({
        name: s2.name, from: s2.from, to: s2.to, repeats: s2.same_as ?? null,
        seconds: [+secondsAt(s2.from.bar, s2.from.beat).toFixed(2),
                  +secondsAt(s2.to.bar, s2.to.beat).toFixed(2)] })),
      unpayable: (plan.fields || []).filter(f => f.outcome === "unpayable")
                   .map(f => ({ field: f.key, why: f.rate_note || f.why })),
      smoothed: (plan.fields || []).filter(f => f.outcome === "smoothed")
                   .map(f => ({ field: f.key, every_nth: f.every_nth })),
    };
  }

  /* A ceiling is a fact about a person, and speeding the music up moves the
     field's rate without moving the ceiling. So the library can warn before a
     player reaches a speed the application cannot actually show. */
  function headroomAt(r) {
    /* Most dimensions do not declare a perceptual ceiling yet -- today only
       pitch does -- so fall back to the output chain's own rate and say which
       ceiling was used. A chain ceiling is a weaker claim than a perceptual
       one and should not be quietly presented as the same thing. */
    const chain = plan.output_hz || 44;
    return (plan.fields || [])
      .filter(f => f.rate_hz && f.outcome !== "unpayable")
      .map(f => {
        const ceiling = f.readable_rate_hz || chain;
        return { field: f.key, outcome: f.outcome,
                 ceiling_from: f.readable_rate_hz ? "a room" : "the chain",
                 headroom: +(ceiling / (f.rate_hz * r)).toFixed(2) };
      })
      .sort((a, b) => a.headroom - b.headroom);
  }

  return {
    at, between, describe, posAt, secondsAt, headroomAt,
    rate(x) { if (x !== undefined) rate = x; return rate; },
    plan, window: win,
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { Session };
if (typeof window !== "undefined") window.LimelightSession = { Session };
