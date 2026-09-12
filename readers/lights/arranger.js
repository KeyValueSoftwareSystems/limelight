"use strict";
/* The arranger: a seeded, arc-aware PLAN for one song.
   ---------------------------------------------------------------------------
   plan(score, enumResult, seed) reads each section, derives a lighting CONTEXT
   from the song's energy curve and its place in the arc, looks that context up in
   the enumeration matrix, and draws a sequence with a seeded PRNG. It is a pure
   function of (score, seed): identical inputs -> identical plan, and nothing here
   depends on tempo or wall time (the protocol's two-clock rule -- the transport
   owns rate; the plan is in bars/beats). No LLM at play time.

   The score is the format the score endpoint returns (or the pipeline's raw file;
   musical.js reads both alike): a grid, a flat list of `sections` (from/to in
   bar/beat, a feel name, a repeat label) and a per-bar `energy` curve, plus the
   finer structure this plan now listens to -- subsections (layers.subsection /
   phrases), weighted `moments`, the per-bar texture lanes (width/air/pump/pace/
   brightness), the per-bar stem lanes and the chords/key. Sections' feel names are
   noisy, so ENERGY + ARC drive the context; feel/rise only break ties.

   The plan's layers and how they avoid fighting on a fixture attribute:
     par  base look per section, CARVED around subsection variations (the same
          pars:colour/pars:level tokens, never concurrent);  head  one look per
          section (head:*);  accent_strobe (pars:strobe);  whiten / modulate /
          hook / pause / blast / blackout are typed MODIFIERS that claim no token
          and are resolved by priority in frame.js;  lanes + harmony ride along as
          per-bar tables. clashes(plan) counts token conflicts and must be 0. */
const { view } = require("./preflight.js");
const { shape } = require("./fromscore.js");
const Mu = require("./musical.js");

const clamp01 = v => Math.max(0, Math.min(1, v));

/* a small, fast, seedable PRNG -- deterministic for a given seed */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickWeighted = (cands, rng) => {
  if (!cands.length) return null;
  const total = cands.reduce((s, c) => s + c.score, 0);
  let r = rng() * total;
  for (const c of cands) { r -= c.score; if (r <= 0) return c; }
  return cands[cands.length - 1];
};

/* ---- reading the score ------------------------------------------------- */
function energyReader(score) {
  /* two shapes in the wild: {per, from_bar, values} (levels) and a bare per-bar
     array (raga). For a bare array, anchor it to the first section's bar. */
  let from, vals;
  if (Array.isArray(score.energy)) {
    vals = score.energy;
    from = (score.sections && score.sections.length)
      ? Math.min(...score.sections.map(s => s.from.bar)) : 1;
  } else {
    const E = score.energy || {};
    /* `|| 1` reads bar 0 as absent and substitutes 1, which is a whole bar of
       energy error on every 0-based score -- levels included. The bare-array
       branch above escapes it only because it anchors to the first section's
       bar instead. Default on absence, never on falsiness. */
    from = (E.from_bar === undefined || E.from_bar === null) ? 1 : E.from_bar;
    vals = E.values || [];
  }
  return bar => {
    const i = Math.round(bar) - from;
    if (i <= 0) return vals[0] || 0;
    if (i >= vals.length) return vals[vals.length - 1] || 0;
    return vals[i];
  };
}
function sectionEnergyMean(sec, energyAt) {
  let s = 0, n = 0;
  for (let b = sec.from.bar; b < sec.to.bar; b++) { s += energyAt(b); n++; }
  return n ? s / n : energyAt(sec.from.bar);
}
function partRise(sec, score) {
  /* format_v1 carries rise on the section itself; the raw score keeps a top-level
     `parts` list. Prefer the section, fall back to the part covering its first bar. */
  if (typeof sec.rise === "number") return sec.rise;
  const p = (score.parts || []).find(p => p.from_bar <= sec.from.bar && sec.from.bar <= p.to_bar);
  return p && typeof p.rise === "number" ? p.rise : null;
}

/* ---- energy + arc -> a lighting context (a matrix column) --------------- */
const HIGH = 0.5, VLOW = 0.1;
function contextsFor(sections, energyAt, score) {
  const means = sections.map(s => sectionEnergyMean(s, energyAt));
  const highIdx = means.map((m, j) => [j, m]).filter(x => x[1] >= HIGH).map(x => x[0]);
  const lastHigh = highIdx.length ? highIdx[highIdx.length - 1] : -1;
  return sections.map((sec, i) => {
    const e = means[i], first = i === 0, last = i === sections.length - 1;
    if (e >= HIGH) return i === lastHigh ? "final_drop" : "drop";
    if (first) return "intro";
    if (last) return "outro";
    if (e < VLOW) return "silence";
    const rise = partRise(sec, score);
    if ((rise !== null && rise > 0.05) || sec.name === "building") return "build";
    return "break";
  });
}

/* ---- per-phase dynamics (from the Arc Rig Playbook) ---------------------
   floor/peak = PAR contrast (dark floor, full peak: the same peak feels harder
   from a lower floor); mode = how the level moves; head = the head's dimmer floor;
   motion = how hard the head moves (0 slow breath .. 1 room-wide, fast). */
const DYN = {
  intro:      { floor: 0.25, peak: 0.55, mode: "breathe", head: 0.45, motion: 0.30 },
  verse:      { floor: 0.28, peak: 1.00, mode: "hit",     head: 0.70, motion: 0.55 },
  break:      { floor: 0.12, peak: 1.00, mode: "hit",     head: 0.50, motion: 0.70 },
  build:      { floor: 0.18, peak: 1.00, mode: "hit",     head: 0.75, motion: 0.85 },
  drop:       { floor: 0.55, peak: 1.00, mode: "hit",     head: 0.90, motion: 1.00 },
  final_drop: { floor: 0.60, peak: 1.00, mode: "hit",     head: 1.00, motion: 1.00 },
  outro:      { floor: 0.05, peak: 0.40, mode: "breathe", head: 0.40, motion: 0.30 },
  silence:    { floor: 0.08, peak: 0.35, mode: "breathe", head: 0.35, motion: 0.30 },
};

/* ---- the finer structure, read once per plan ------------------------------ */
/* how a subsection's `doing` bends the look: LIFT wants a bolder pattern, EASE a
   calmer one, HOLD keeps the section's own. Words from the pipeline's vocabulary. */
const LIFT = new Set(["peaking", "intensifying", "expanding"]);
const EASE = new Set(["easing", "thinning", "suspending", "resolving", "closing"]);
const classify = sub => LIFT.has(sub.doing) ? "lift" : EASE.has(sub.doing) ? "ease" : "hold";
/* a step along the energy ladder of contexts, for a variation's matrix column */
const CALMER = { final_drop: "drop", drop: "break", build: "verse", verse: "break",
                 break: "intro", intro: "silence", outro: "silence", silence: "silence" };
const BOLDER = { silence: "intro", intro: "verse", outro: "verse", break: "verse",
                 verse: "build", build: "drop", drop: "final_drop", final_drop: "final_drop" };

/* the per-bar texture + presence lanes, normalised per song, anchored once */
function lanesBlock(score) {
  const L = Mu.lanesOf(score), S = Mu.stemLanesOf(score);
  if (!L && !S) return null;
  const from_bar = (L || S).from_bar;
  const out = { from_bar };
  if (L) for (const k of Mu.LANES) if (L[k]) out[k] = Mu.normalise(L[k]);
  if (S) {
    /* re-anchor the stem lanes onto the texture lanes' first bar if they differ */
    const shift = S.from_bar - from_bar;
    const align = v => shift === 0 ? v : shift > 0
      ? [...Array.from({ length: shift }, () => null), ...v] : v.slice(-shift);
    const lanes = {};
    for (const k of Mu.STEMS) if (S.lanes[k]) lanes[k] = align(S.lanes[k]);
    const n = Math.max(...Object.values(lanes).map(v => v.length));
    const density = [];
    for (let i = 0; i < n; i++) {
      const vals = Object.values(lanes).map(v => v[i]).filter(x => typeof x === "number");
      density.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    }
    out.density = Mu.normalise(density);
    const c01 = v => (typeof v === "number" ? +clamp01(v).toFixed(4) : null);
    if (lanes.drums) out.drums = lanes.drums.map(c01);
    if (lanes.vocals) out.vocals = lanes.vocals.map(c01);
  }
  return out;
}

/* per-bar harmony as hue (circle of fifths), minor flag and confidence, plus the key */
function harmonyBlock(score) {
  const H = Mu.harmonyOf(score);
  if (!H) return null;
  const hue = H.chords.map(Mu.hueOfChord);
  const minor = H.chords.map(c => { const k = Mu.chordOf(c); return k ? k.minor : null; });
  let key = null;
  if (H.key && H.key.root) {
    const name = H.key.root + (H.key.scale === "minor" ? "m" : "");
    const h = Mu.hueOfChord(name);
    if (h !== null) key = { hue: h, minor: H.key.scale === "minor" };
  }
  if (!key) {               /* no key: the song's most frequent chord stands in */
    const count = {};
    for (const c of H.chords) if (c) count[c] = (count[c] || 0) + 1;
    const top = Object.keys(count).sort((a, b) => count[b] - count[a] || (a < b ? -1 : 1))[0];
    const k = Mu.chordOf(top);
    if (k) key = { hue: Mu.hueOfChord(top), minor: k.minor };
  }
  return { from_bar: H.from_bar, hue, minor, sure: H.confidence, key };
}

/* ---- pace -> how fast the PAR patterns run -------------------------------------
   The pipeline's `pace` is events per beat against the song's median bar (1.0 =
   ordinary). A stretch well below it runs the patterns at HALF time, well above at
   DOUBLE time, else normal. Decided per subsection (else per section) so a speed
   change lands on a musical boundary, and clamped by context: an intro/outro/
   silence never doubles, a drop never halves. Returns events-per-beat. */
const LAZY = 0.5, BUSY = 1.5;
function subdivFor(meanPace, ctx) {
  if (typeof meanPace !== "number") return 1;
  let k = meanPace < LAZY ? 0.5 : meanPace > BUSY ? 2 : 1;
  if (ctx === "intro" || ctx === "outro" || ctx === "silence") k = Math.min(k, 1);
  if (ctx === "drop" || ctx === "final_drop") k = Math.max(k, 1);
  return k;
}
/* the mean of a per-bar reader over [fromBar, toBar), ignoring nulls */
function meanOver(readAt, fromBar, toBar) {
  let s = 0, n = 0;
  for (let b = fromBar; b < toBar; b++) { const v = readAt(b); if (typeof v === "number") { s += v; n++; } }
  return n ? s / n : null;
}

/* [from,to) in beats minus a list of [from,to) cuts -> the remaining pieces */
function carve(from, to, cuts) {
  const pieces = [];
  let cur = from;
  for (const c of [...cuts].sort((a, b) => a[0] - b[0])) {
    if (c[0] > cur) pieces.push([cur, Math.min(c[0], to)]);
    cur = Math.max(cur, c[1]);
  }
  if (cur < to) pieces.push([cur, to]);
  return pieces;
}

/* ---- the plan: a PAR look AND a head look for EVERY section, varied inside by
   its subsections, punctuated by its moments, coloured by its harmony ---------- */
function plan(scoreIn, enumResult, seed) {
  /* the raw hub score (parts, bars) is shaped here too, so a caller may hand in
     either shape and the plan is the same either way */
  const score = (scoreIn && Array.isArray(scoreIn.sections)) ? scoreIn : shape(scoreIn || {});
  const rng = mulberry32((seed || 0) >>> 0);
  const V = view(enumResult);
  const energyAt = energyReader(score);
  const sections = score.sections || [];
  const contexts = contextsFor(sections, energyAt, score);

  const bpb = (score.grid && score.grid.beats_per_bar) || 4;
  const atBeat = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);
  const fromBeat = B => ({ bar: Math.floor(B / bpb) + 1, beat: (((B % bpb) + bpb) % bpb) + 1 });
  const occOf = id => { const s = V.seq(id); return (s && s.occupies) || []; };

  /* classify a candidate by which fixtures it drives */
  const groupOf = id => {
    const o = occOf(id);
    const par = o.some(t => t.startsWith("pars:") || t.startsWith("all_pars"));
    const head = o.some(t => t.startsWith("head:"));
    return par && head ? "combo" : par ? "par" : head ? "head" : "other";
  };
  /* a PAR look must drive the pars' level (a strobe-only accent is not a look --
     carving the base around it would leave colour/level unowned) */
  const isLook = id => occOf(id).some(t => t === "pars:level" || t.startsWith("all_pars"));
  const pickFor = (ctx, grp, exclude) => {
    const all = V.candidates(ctx);
    const same = all.filter(c => groupOf(c.id) === grp && (grp !== "par" || isLook(c.id)));
    const pool = (same.length ? same : all).filter(c => !(exclude || []).includes(c.id));
    return pickWeighted(pool, rng);
  };
  /* what an assignment actually drives: its sequence's claims on ITS layer's
     fixtures. A head-layer look renders through the head whatever sequence it
     borrowed (the base vocabulary has no head look for an intro), so it never
     claims a PAR attribute -- and the occupancy model stays honest. */
  const HEAD_DEFAULT = ["head:move", "head:level"];
  const occFor = (id, layer) => {
    const o = occOf(id);
    if (layer === "head") { const h = o.filter(t => t.startsWith("head:")); return h.length ? h : HEAD_DEFAULT; }
    return o.filter(t => !t.startsWith("head:"));
  };

  /* the finer structure */
  const subs = Mu.subsectionsOf(score);
  const moments = Mu.momentsOf(score);
  const lanes = lanesBlock(score);
  const harmony = harmonyBlock(score);
  const keyHue = harmony && harmony.key ? harmony.key.hue : null;

  /* the subsections inside a section, clipped to it, at least a bar long */
  const subsIn = sec => {
    const secFrom = atBeat(sec.from), secTo = atBeat(sec.to);
    return subs
      .map(su => ({ ...su, f: Math.max(atBeat(su.from), secFrom), t: Math.min(atBeat(su.to), secTo) }))
      .filter(su => su.t - su.f >= bpb)
      .sort((a, b) => a.f - b.f);
  };
  const barOf = B => Math.floor(B / bpb) + 1;

  /* pace -> the PAR patterns' speed, per bar, constant across a subsection */
  const rawLanes = Mu.lanesOf(score);
  const sectionK = sections.map(() => 1);
  if (lanes && rawLanes && Array.isArray(rawLanes.pace)) {
    const paceAt = Mu.perBar(rawLanes.from_bar, rawLanes.pace);
    const subdiv = rawLanes.pace.map(() => 1);
    const fill = (fromBar, toBar, k) => {
      for (let b = fromBar; b < toBar; b++) { const i = b - lanes.from_bar; if (i >= 0 && i < subdiv.length) subdiv[i] = k; }
    };
    sections.forEach((sec, i) => {
      sectionK[i] = subdivFor(meanOver(paceAt, sec.from.bar, sec.to.bar), contexts[i]);
      fill(sec.from.bar, sec.to.bar, sectionK[i]);
      for (const su of subsIn(sec))
        fill(barOf(su.f), barOf(su.t), subdivFor(meanOver(paceAt, barOf(su.f), barOf(su.t)), contexts[i]));
    });
    lanes.subdiv = subdiv;
  }

  const assignments = [];
  sections.forEach((sec, i) => {
    const context = contexts[i];
    const dyn = DYN[context] || DYN.verse;
    const e = sectionEnergyMean(sec, energyAt);
    const boldness = context === "final_drop" ? 1 : clamp01(0.6 + 0.4 * e);
    /* the section's pattern speed (events per beat) from its pace. The old seeded
       rate draw is kept so existing seeds keep their sequence picks. */
    rng();
    const rate = sectionK[i];
    /* colour follows the key when the score states one; the draw still happens so
       the seed's later picks do not move when harmony appears */
    const drawnHue = +rng().toFixed(3);
    const hue = keyHue !== null ? keyHue : drawnHue;
    const secFrom = atBeat(sec.from), secTo = atBeat(sec.to);

    /* the PARs: a look + the phase's contrast (floor/peak/mode) */
    const par = pickFor(context, "par");
    const parParams = { rate, hue, floor: dyn.floor, peak: dyn.peak, mode: dyn.mode, intensity: boldness };

    const inside = subsIn(sec);

    /* a subsection that changes what the music is doing gets its own PAR look; the
       first one is the section's identity and keeps the base. The base is carved
       around the variations, so no two concurrent looks claim pars:colour/level. */
    const variations = [];
    let lastVar = null;
    inside.forEach((su, j) => {
      const cls = classify(su);
      const isFirst = j === 0 || su.f === secFrom;
      const wantsOwn = par && !isFirst && inside.length > 1 && (cls !== "hold" || su.has_break);
      if (wantsOwn) {
        const vctx = cls === "ease" ? CALMER[context] : cls === "lift" ? BOLDER[context] : context;
        let pick = pickFor(vctx, "par", [par.id, lastVar]);
        if (!pick && vctx !== context) pick = pickFor(context, "par", [par.id, lastVar]);
        if (pick) {
          const vp = { ...parParams };
          if (cls === "lift") { vp.floor = +clamp01(dyn.floor + 0.05).toFixed(3); vp.intensity = +clamp01(boldness * 1.1).toFixed(3); }
          if (cls === "ease") { vp.floor = +clamp01(dyn.floor - 0.15).toFixed(3); vp.intensity = +clamp01(boldness * 0.9).toFixed(3); }
          variations.push({ from: fromBeat(su.f), to: fromBeat(su.t), seq_id: pick.id, context, vcontext: vctx,
            layer: "par", priority: 0, variation: true, doing: su.doing || null, params: vp,
            occupies: occFor(pick.id, "par"), section: sec.name, f: su.f, t: su.t });
          lastVar = pick.id;
        }
      }
      /* every subsection modulates the base: louder/quieter than its section, and
         faster/slower as the music lifts or eases. Rides on no fixture attribute. */
      const se = typeof su.energy === "number" ? su.energy : e;
      let gain = 1 + 0.5 * (se - e), motion = 0;
      if (cls === "lift") { gain += 0.05; motion += 0.15; }
      if (cls === "ease") { gain -= 0.05; motion -= 0.2; }
      if (typeof su.rise === "number" && su.rise > 0.1) motion += 0.1;
      assignments.push({ from: fromBeat(su.f), to: fromBeat(su.t), context, layer: "modulate", priority: 4,
        type: "modulate", params: { gain: +Math.max(0.7, Math.min(1.15, gain)).toFixed(3), motion: +motion.toFixed(2),
        doing: su.doing || null }, occupies: [], section: sec.name });
    });

    if (par) {
      const pieces = carve(secFrom, secTo, variations.map(v => [v.f, v.t]));
      pieces.forEach((pc, k) => assignments.push({
        from: fromBeat(pc[0]), to: fromBeat(pc[1]), seq_id: par.id, context, layer: "par", priority: 0,
        ...(pieces.length > 1 ? { piece: k, origin: sec.from } : {}),   /* so a scripted compound keeps its clock */
        params: parParams, occupies: occFor(par.id, "par"), section: sec.name,
      }));
      for (const v of variations) { const { f, t, ...a } = v; assignments.push(a); }
    }

    /* the head: always moving/lit, its own colour voice, speed by phase -- one
       continuous look per section, so the hero element reads as continuity */
    const head = pickFor(context, "head");
    if (head) assignments.push({
      from: sec.from, to: sec.to, seq_id: head.id, context, layer: "head", priority: 1,
      params: { rate, hue, headDim: dyn.head, motion: dyn.motion, intensity: dyn.head },
      occupies: occFor(head.id, "head"), section: sec.name,
    });

    /* extra musical aspects, overlapping on their own fixture attribute so they
       never fight the base look (the user's "one sequence per aspect" idea):
         drums  -> strobe accents on downbeats (PAR strobe)
         build  -> whitening the PARs toward white (PAR colour) */
    const stems = sec.stems || {};
    const drums = (stems.drums && stems.drums.level) || (e >= 0.5 ? e : 0);
    if (drums > 0.35 && ["break", "build", "drop", "final_drop"].includes(context))
      assignments.push({ from: sec.from, to: sec.to, context, layer: "accent", priority: 2,
        type: "accent_strobe", params: { strength: clamp01(drums) }, occupies: ["pars:strobe"], section: sec.name });
    const rise = partRise(sec, score) || 0;
    if (context === "build" || rise > 0.08)
      assignments.push({ from: sec.from, to: sec.to, context, layer: "whiten", priority: 3,
        type: "whiten", params: { amount: clamp01(0.3 + rise) }, occupies: [], section: sec.name });

    /* contrast at a drop, when the score has no moments of its own to say where
       the hits are: the last beat before it is black, its first beat blasts white */
    if (!moments.length && (context === "drop" || context === "final_drop")) {
      const f = atBeat(sec.from);
      assignments.push({ from: fromBeat(f - 1), to: sec.from, context, layer: "fx",
        priority: 9, type: "blackout", params: {}, occupies: [], section: sec.name });
      assignments.push({ from: sec.from, to: fromBeat(f + 1), context, layer: "fx",
        priority: 9, type: "white_blast", params: {}, occupies: [], section: sec.name });
    }
  });

  /* ---- moments: punctuation at the exact bar/beat, scaled by weight --------
       entrance/release/accent/... -> a white blast on the beat; a heavy one holds
       its breath (blackout) on the beat before.   hook -> a lifted span.
       pause -> everything but what is still playing sits down for its beats.
       rise -> whitening over its beats.   fill -> strobe accents.   exit -> a dip. */
  const sectionAt = B => { const s = sections.find(x => atBeat(x.from) <= B && B < atBeat(x.to)); return s ? s.name : null; };
  const ctxAt = B => { const i = sections.findIndex(x => atBeat(x.from) <= B && B < atBeat(x.to)); return i >= 0 ? contexts[i] : null; };
  const spanFx = (B, len, extra) => ({ from: fromBeat(B), to: fromBeat(B + len), context: ctxAt(B), layer: "fx",
    occupies: [], section: sectionAt(B), ...extra });
  for (const m of moments) {
    const w = typeof m.weight === "number" ? clamp01(m.weight) : 0.5;
    const B = atBeat({ bar: m.bar, beat: m.beat });
    const len = typeof m.for_beats === "number" && m.for_beats > 0 ? m.for_beats : null;
    const tag = { moment: m.kind, what: m.what };
    if (m.kind === "pause") {
      assignments.push(spanFx(B, len || bpb, { priority: 8, type: "pause", params: { strength: w, still: m.still || [] }, ...tag }));
      continue;
    }
    if (w < 0.25) continue;                        /* below this a moment is noise */
    if (m.kind === "hook") {
      assignments.push(spanFx(B, len || bpb, { priority: 7, type: "hook", params: { strength: w }, ...tag }));
    } else if (m.kind === "rise") {
      assignments.push(spanFx(B, len || 2 * bpb, { priority: 3, type: "whiten", params: { amount: +clamp01(0.2 + 0.5 * w).toFixed(3) }, ...tag }));
    } else if (m.kind === "fill") {
      assignments.push(spanFx(B, len || bpb, { priority: 5, type: "accent_strobe", params: { strength: +clamp01(0.4 + 0.6 * w).toFixed(3) },
        occupies: ["pars:strobe"], ...tag }));
    } else if (m.kind === "exit") {
      assignments.push(spanFx(B, len || bpb, { priority: 4, type: "modulate", layer: "modulate", params: { gain: 0.75, motion: -0.2, doing: "exit" }, ...tag }));
    } else {                                       /* entrance, release, accent, change, ... a hit */
      if (w >= 0.75)
        assignments.push(spanFx(B - 1, 1, { priority: 9, type: "blackout", params: { strength: w }, ...tag }));
      assignments.push(spanFx(B, 1, { priority: 9, type: "white_blast", params: { strength: w }, ...tag }));
    }
  }

  const out = { seed: (seed || 0) >>> 0, grid: score.grid, contexts, assignments };
  if (lanes) out.lanes = lanes;
  if (harmony) out.harmony = harmony;
  return out;
}

/* how many pairs of concurrent SEQUENCE assignments claim the same fixture
   attribute -- the conflict the arranger promises never to produce. Typed
   modifiers (whiten, modulate, fx) ride on top and are resolved by priority. */
function clashes(p) {
  const bpb = (p.grid && p.grid.beats_per_bar) || 4;
  const at = q => (q.bar - 1) * bpb + ((q.beat || 1) - 1);
  const seqs = (p.assignments || []).filter(a => a.seq_id);
  let n = 0;
  for (let i = 0; i < seqs.length; i++) for (let j = i + 1; j < seqs.length; j++) {
    const a = seqs[i], b = seqs[j];
    if (at(a.from) >= at(b.to) || at(b.from) >= at(a.to)) continue;
    if ((a.occupies || []).some(t => (b.occupies || []).includes(t))) n++;
  }
  return n;
}

module.exports = { plan, contextsFor, sectionEnergyMean, energyReader, clashes, carve };

/* ---- CLI: plan a score and print the show, section by section ------------
     node readers/lights/arranger.js [score file] [seed]   */
if (require.main === module) {
  const fs = require("fs"), path = require("path");
  const { enumerate } = require("./preflight.js");
  const scoreFile = process.argv[2] || null;
  const seed = +(process.argv[3] || 1);
  const score = require("./fromscore.js").load(scoreFile);
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "arc4-head.layout.json"), "utf8"));
  let palette = [];
  try { palette = JSON.parse(fs.readFileSync(path.join(__dirname, "arc4-head.palette.json"), "utf8")); } catch (e) {}
  const en = enumerate(layout, { palette });
  const p = plan(score, en, seed);
  console.log(`\n${score.score || "song"} — plan @ seed ${seed}   (${p.assignments.length} assignments over ${score.sections.length} sections, ${en.sequences.length}-sequence palette)`);
  const pos = q => q.bar + (q.beat && q.beat !== 1 ? "." + q.beat : "");
  for (const a of p.assignments)
    console.log("  " + (pos(a.from) + "-" + pos(a.to)).padEnd(11) +
      "  " + String(a.section || "").padEnd(11) + " " + String(a.context || "").padEnd(11) +
      " " + a.layer.padEnd(9) + " -> " + String(a.seq_id || a.type).padEnd(28) +
      (a.variation ? " [" + a.doing + "]" : a.moment ? " [" + a.moment + (a.what ? ": " + a.what : "") + "]" : "") +
      " " + JSON.stringify(a.params || {}));
  console.log(`  (${clashes(p)} clashes; ${p.lanes ? "lanes " + Object.keys(p.lanes).filter(k => k !== "from_bar").join("/") : "no lanes"}; ${p.harmony ? "harmony from key hue " + (p.harmony.key && p.harmony.key.hue) : "no harmony"})`);
}
