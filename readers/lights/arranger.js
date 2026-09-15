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
const { FACTS } = require("./facts.js");

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

/* ---- how much this song wants doing to it -----------------------------------
   A mournful, harmonically static piece and a four-on-the-floor record can want
   opposite things from the same rig, and the palette alone cannot tell them
   apart -- a strobe is equally POSSIBLE on both.

   What separates them is already in the response, in fields whose direction is
   unambiguous. `tells` says how much each curve actually moves on this song;
   `loudness` says how much room the record left itself; `feel` says how busy it
   is. Not mood_axes: the axes differ from song to song and nothing states which
   end of "happy_vs_sad" a 3.31 sits at, so building on it would be guessing.

   Returns 0..1. Near 0 means the music is doing little and the rig should do
   less. Near 1 means the record is already loud and busy and can take it. */
function appetite(score) {
  const t = score.tells || {}, l = score.loudness || {}, f = score.feel || {};
  const c = score.chord_summary || score.chords || {};
  const num = (v, d) => (typeof v === "number" ? v : d);

  /* how much the song itself moves: the three curves that describe motion */
  const moving = num(t.drums, 3) + num(t.energy, 3) + num(t.pump, 1);
  const drive = clamp01((moving - 5) / 15);              /* ~6 quiet, ~22 busy */

  /* how much room it left itself. A wide range and high dynamic complexity mean
     the music supplies its own contrast and the rig need not shout over it. */
  const room = clamp01((num(l.range_lu, 5) - 3) / 5) * 0.5
             + clamp01((num(l.dynamic_complexity, 3) - 2) / 3) * 0.5;

  /* harmony that barely moves is modal writing, and modal writing does not want
     a gesture every eight bars */
  const harmonic = clamp01((num(c.changes_per_beat, 0.05) - 0.02) / 0.05);

  const busy = clamp01((num(f.onsets_per_second, 4) - 2.5) / 3);

  const a = clamp01(0.45 * drive + 0.2 * busy + 0.2 * harmonic + 0.15 * (1 - room));
  return +a.toFixed(3);
}

/* ---- what has the listener's ear -------------------------------------------
   A designer does not track every event; they track what the room is listening
   to, and act when that changes hands. Attention follows SURPRISE rather than
   loudness: a lane that is loud and steady fades into the background, and one
   that jumps takes the ear even if it is quieter. So for each stem, measure how
   far it has moved from what it has been doing over the last few bars, in units
   of its own variability, and require it to be audible at all before it can
   take the ear.

   This disagrees with the signal list in useful places. At bar 7 of
   raga-of-revenge the score flags the drums entering as the heaviest event, but
   the voice jumps nearly twice as hard -- and the voice is what you notice.

   Bar resolution, because that is what the score publishes. Within-bar
   handovers are invisible until the stem lanes arrive per beat. */
const EAR_LANES = ["drums", "bass", "vocals", "guitar", "piano", "other"];
const EAR_LOOK = 4;          /* bars of recent history each lane is judged against */
const EAR_FLOOR = 0.25;      /* below this a lane is not audible enough to matter */

function attention(score) {
  /* Either score shape: the pipeline writes bars.drums, the protocol response
     writes stems.lanes.drums. Reading only one made the same song plan
     differently depending on which shape it arrived in. */
  const bars = (score && score.bars) || {};
  const st = ((score && score.stems) || {}).lanes || {};
  const laneOf = k => (Array.isArray(bars[k]) && bars[k].length) ? bars[k]
                    : (Array.isArray(st[k]) && st[k].length) ? st[k] : null;
  const lanes = EAR_LANES.filter(k => laneOf(k));
  if (!lanes.length) return [];
  const n = Math.max(...lanes.map(k => laneOf(k).length));
  const out = [];
  for (let i = 0; i < n; i++) {
    let who = null, best = -Infinity;
    for (const k of lanes) {
      const v = laneOf(k), here = v[i];
      if (here == null || here < EAR_FLOOR) continue;
      const past = v.slice(Math.max(0, i - EAR_LOOK), i).filter(x => x != null);
      if (!past.length) continue;
      const m = past.reduce((a, b) => a + b, 0) / past.length;
      const sd = Math.sqrt(past.reduce((a, b) => a + (b - m) * (b - m), 0) / past.length);
      const surprise = (here - m) / Math.max(sd, 0.06);
      if (surprise > best) { best = surprise; who = k; }
    }
    out.push({ bar: i, lane: who, surprise: who ? +best.toFixed(2) : 0 });
  }
  return out;
}

/* Where the ear changes hands hard enough to be worth a gesture. Only a real
   handover counts -- the same voice getting louder is not a new moment. */
function handovers(score, least = 2.0) {
  const a = attention(score);
  const out = [];
  let held = null;
  for (const row of a) {
    if (!row.lane) continue;
    if (row.lane !== held && row.surprise >= least) {
      /* Deliberately capped below the weight of a genuine flagged signal. A
         handover is worth a gesture where nothing else marks the moment -- bar
         55 of raga, which the score leaves blank -- but it must not displace an
         entrance or a release the pipeline actually measured. */
      out.push({ bar: row.bar, beat: 1, kind: "handover", is: "handover",
                 what: row.lane, weight: +Math.min(0.44, 0.28 + row.surprise / 40).toFixed(3),
                 surprise: row.surprise });
      held = row.lane;
    } else if (row.lane === held) {
      /* holding: nothing to say */
    }
  }
  return out;
}

/* Looks that shout, detected from what they DO rather than from their names:
   anything that claims the strobe channel, or carries a strobe on a key. */
function shouts(seq) {
  if (!seq) return false;
  if ((seq.occupies || []).some(o => /strobe/.test(o))) return true;
  const keys = (seq.gesture && seq.gesture.keys) || [];
  if (keys.some(k => k.intent && k.intent.strobe)) return true;
  for (const part of (seq.parts || [])) if (/strobe/.test(part.seq || "")) return true;
  for (const step of (seq.steps || [])) if (/strobe/.test(step.seq || "")) return true;
  return false;
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
/* SongFormer names a section verse / chorus / bridge; this rig's phases are
   intro / verse / break / build / drop / outro. Only the words the energy
   heuristic cannot infer are mapped here -- a section already named in the
   rig's own vocabulary is left to it, so the older scores plan as they did.
   Without this a second chorus was lit as a break, and DYN.verse was
   unreachable. */
const NAMED = {
  verse: "verse", chorus: "drop", refrain: "drop",
  bridge: "build", prechorus: "build", "pre-chorus": "build",
};

function contextsFor(sections, energyAt, score) {
  const means = sections.map(s => sectionEnergyMean(s, energyAt));
  const highIdx = means.map((m, j) => [j, m]).filter(x => x[1] >= HIGH).map(x => x[0]);
  const lastHigh = highIdx.length ? highIdx[highIdx.length - 1] : -1;
  const named = sections.map(sec =>
    NAMED[String(sec.name || "").toLowerCase().replace(/[ _]/g, "-")] || null);
  const nDrops = named.filter(x => x === "drop").length;
  const lastNamedDrop = nDrops > 1 ? named.lastIndexOf("drop") : -1;
  return sections.map((sec, i) => {
    const e = means[i], first = i === 0, last = i === sections.length - 1;
    if (named[i]) {
      if (named[i] === "drop" && i === lastNamedDrop) return "final_drop";
      return named[i];
    }
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
    if (lanes.bass) out.bass = lanes.bass.map(c01);
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

/* ---- one context vector per bar (spec: "The context vector") -----------------
   Everything here is a fact the score states, read through musical.js so both
   score shapes agree: form from the section, doing from the subsection, presence
   from the stem lanes (0.3 of the stem's own peak), texture bands from the
   per-song normalised lanes (below 0.33 / above 0.67), harmony from the chords,
   and the moment landing on the bar with its weight band. A family the score
   cannot speak to is absent, so the matrix treats it as neutral. */
const PRESENCE_IN = 0.3, BAND_LO = 0.33, BAND_HI = 0.67;
const weightBand = w => (w >= 0.75 ? "heavy" : w >= 0.5 ? "firm" : "light");
function factsBlock(score, sections, contexts, lanes, harmony, subs, moments, bpb) {
  if (!sections.length) return null;
  const from_bar = Math.min(Mu.firstBarOf(score), ...sections.map(s => s.from.bar));
  const to_bar = Math.max(...sections.map(s => s.to.bar));
  const atBeat = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);
  const rd = (blk, k) => (blk && Array.isArray(blk[k]) ? Mu.perBar(blk.from_bar, blk[k]) : null);
  const drums = rd(lanes, "drums"), bass = rd(lanes, "bass"), vocals = rd(lanes, "vocals");
  const width = rd(lanes, "width"), pace = rd(lanes, "pace"), bright = rd(lanes, "brightness");
  const minor = rd(harmony, "minor"), hue = rd(harmony, "hue");
  const band = (v, lo, hi) => (typeof v !== "number" ? null : v < BAND_LO ? lo : v > BAND_HI ? hi : null);
  const vectors = [];
  for (let bar = from_bar; bar < to_bar; bar++) {
    const si = sections.findIndex(s => s.from.bar <= bar && bar < s.to.bar);
    if (si < 0) { vectors.push(null); continue; }
    const v = { form: contexts[si] };
    const B = (bar - 1) * bpb;
    const sub = subs.find(su => atBeat(su.from) <= B && B < atBeat(su.to));
    /* a score that cannot speak to what the music is doing (no subsection layer at
       all) stays silent on it, like presence/texture/harmony -- never a manufactured
       "holding" that would fold a phantom fact into every cell's affinity */
    if (subs.length) v.doing = (sub && sub.doing && FACTS.doing.includes(sub.doing)) ? sub.doing : "holding";
    if (drums || bass || vocals) {
      v.presence = [];
      for (const [name, r] of [["drums", drums], ["bass", bass], ["vocals", vocals]]) {
        if (!r) continue;
        const x = r(bar);
        if (typeof x === "number") v.presence.push(name + (x >= PRESENCE_IN ? ":in" : ":out"));
      }
    }
    if (width || pace || bright) {
      v.texture = [band(width && width(bar), "narrow", "wide"), band(pace && pace(bar), "sparse", "busy"),
                   band(bright && bright(bar), "dull", "bright")].filter(Boolean);
    }
    if (minor || hue) {
      v.harmony = [];
      const m = minor && minor(bar);
      if (m === true) v.harmony.push("minor"); else if (m === false) v.harmony.push("major");
      const h0 = hue && bar > from_bar ? hue(bar - 1) : null, h1 = hue && hue(bar);
      if (h0 !== null && h1 !== null && h0 !== h1) v.harmony.push("changing");
    }
    const here = moments.filter(m => m.bar === bar && typeof m.kind === "string");
    if (here.length) {
      const kinds = [...new Set(here.map(m => m.kind))].filter(k => FACTS.moment.includes(k));
      if (kinds.length) {
        const w = Math.max(...here.map(m => (typeof m.weight === "number" ? m.weight : 0.5)));
        v.moment = [...kinds, weightBand(w)];
      }
    }
    vectors.push(v);
  }
  return { from_bar, vectors };
}

/* the vector a SPAN of bars agrees on: form as given; doing by STRICT majority (or
   the caller's word, a subsection's own) -- a span whose bars do four things in turn
   is not doing one of them, so it stays silent on the family and the draw is decided
   by the facts that do hold; each stem's presence by majority; a texture band only
   when more than half the bars carry it; harmony's mode by majority and never
   "changing" (that is a bar fact). Moments never belong to a span. */
function majorityVector(vectors, i0, i1, form, doing) {
  const span = [];
  for (let i = Math.max(0, i0); i < Math.min(vectors.length, i1); i++) if (vectors[i]) span.push(vectors[i]);
  const v = { form };
  const count = (pick) => {
    const c = {};
    for (const x of span) for (const f of (pick(x) || [])) c[f] = (c[f] || 0) + 1;
    return c;
  };
  const top = c => Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))[0];
  if (doing) v.doing = doing;
  else if (span.some(x => x.doing)) {
    const c = count(x => (x.doing ? [x.doing] : []));
    const w = top(c);
    if (c[w] * 2 > span.length) v.doing = w;                /* no majority word: the family stays silent */
  }
  if (span.some(x => x.presence)) {
    const c = count(x => x.presence);
    v.presence = [];
    for (const stem of ["drums", "bass", "vocals"]) {
      const a = c[stem + ":in"] || 0, b = c[stem + ":out"] || 0;
      if (a || b) v.presence.push(stem + (a >= b ? ":in" : ":out"));
    }
  }
  if (span.some(x => x.texture)) {
    const c = count(x => x.texture);
    v.texture = Object.keys(c).filter(f => c[f] * 2 > span.length).sort();
  }
  if (span.some(x => x.harmony)) {
    const c = count(x => (x.harmony || []).filter(f => f !== "changing"));
    v.harmony = (c.minor || 0) >= (c.major || 0) && (c.minor || c.major) ? ["minor"] : (c.major ? ["major"] : []);
  }
  return v;
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
  /* how much doing-to this song can take, 0..1, from its own numbers */
  const want = (typeof process !== "undefined" && process.env && process.env.LIMELIGHT_APPETITE)
    ? clamp01(parseFloat(process.env.LIMELIGHT_APPETITE))
    : appetite(score);
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
  const pickFor = (vector, grp, exclude) => {
    /* looks only: a one-shot is punctuation, never a look, whatever the fallback */
    const all = V.candidates(vector).filter(c => { const q = V.seq(c.id); return !(q && q.kind === "oneshot"); });
    const same = all.filter(c => groupOf(c.id) === grp && (grp !== "par" || isLook(c.id)));
    let pool = (same.length ? same : all).filter(c => !(exclude || []).includes(c.id));
    /* Weight the draw by what this song can take. A look that shouts keeps its
       full score on a busy record and loses most of it on a restrained one, so
       a mournful modal piece stops drawing strobes without anybody hand-listing
       which songs may have them. Boldness is scaled the same way and in the same
       direction, gently, so a quiet song leans ambient rather than hero. */
    const BOLD = { ambient: 0, accent: 0.5, hero: 1 };
    /* Below a point, weighting is not enough. A hero strobe keeps about a fifth
       of its score at an appetite of 0.27, and a fifth of a high score still
       wins draws -- raga-of-revenge drew strobe_machine_gun twice through a
       chorus the measurements call restrained. Under that threshold a look that
       shouts is removed rather than made unlikely, whenever anything else is
       available: "this song does not want strobes" is a statement, not a dice
       roll. If nothing else fits, it still comes back rather than leaving the
       section dark. */
    const QUIET = 0.35;
    if (want < QUIET) {
      const calm = pool.filter(c => !shouts(V.seq(c.id)));
      if (calm.length) pool = calm;
    }
    const tempered = pool.map(c => {
      const q = V.seq(c.id);
      let k = 1;
      if (shouts(q)) k *= 0.1 + 0.9 * want;
      k *= 1 - 0.5 * (BOLD[c.boldness] != null ? BOLD[c.boldness] : 0.5) * (1 - want);
      return { ...c, score: c.score * k };
    }).filter(c => c.score > 0);
    if (tempered.length) pool = tempered;
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
  const signals = Mu.signalsOf(score);
  const lanes = lanesBlock(score);
  const harmony = harmonyBlock(score);
  const keyHue = harmony && harmony.key ? harmony.key.hue : null;
  const facts = factsBlock(score, sections, contexts, lanes, harmony, subs, moments, bpb);

  /* growth: a section that RISES grows across itself instead of holding one level.
     A per-bar `grow` lane, 0.5 at rest, climbing (or sinking) with the section's
     rise from its first bar to its last; frame scales level and motion by it. */
  let lanesOut = lanes;
  if (facts) {
    const grow = facts.vectors.map(() => 0.5);
    sections.forEach(sec => {
      const r = partRise(sec, score) || 0;
      const n = sec.to.bar - sec.from.bar;
      for (let bar = sec.from.bar; bar < sec.to.bar; bar++) {
        const i = bar - facts.from_bar;
        if (i < 0 || i >= grow.length) continue;
        const pos = n > 1 ? (bar - sec.from.bar) / (n - 1) : 0.5;
        grow[i] = +clamp01(0.5 + r * (pos - 0.5) * 2).toFixed(4);
      }
    });
    if (grow.some(v => v !== 0.5)) { if (!lanesOut) lanesOut = { from_bar: facts.from_bar }; lanesOut.grow = grow; }   /* same object as lanes: the pace pre-pass adds subdiv to it too */
  }
  /* tension: the score's per-beat wind-up, normalised per song; frame lifts level
     and motion with it so a build climbs toward its release beat by beat */
  const tensionRaw = Mu.tensionOf(score);
  const tension = tensionRaw ? { from_bar: tensionRaw.from_bar, values: Mu.normalise(tensionRaw.values) } : null;

  /* memory: repeated material gets its look back. Keyed by the score's own label
     (like / repeat), so the three drops of a song wear one pattern -- the audience
     learns the show's rules -- while each keeps its own dynamics and variations. */
  const memory = {};

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
    const paceRaw = Mu.perBar(rawLanes.from_bar, rawLanes.pace);
    const paceAt = bar => { const v = paceRaw(bar); return (typeof v === "number" && v > 0) ? v : null; };   /* 0.0 = nothing detected */
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
    /* a `change` signal (double time / half time) STEPS the rate from its bar to
       the end of its section, or to the next change -- the music did, so the rig does */
    for (const sg of signals) {
      if (sg.kind !== "change" || typeof sg.what !== "string" || (typeof sg.sure === "number" && sg.sure < 0.5)) continue;
      const k = /double/i.test(sg.what) ? 2 : /half/i.test(sg.what) ? 0.5 : null;
      if (!k) continue;
      const sec = sections.find(x => x.from.bar <= sg.bar && sg.bar < x.to.bar);
      if (!sec) continue;
      const next = signals.filter(o => o.kind === "change" && o.bar > sg.bar && o.bar < sec.to.bar).map(o => o.bar);
      const end = next.length ? Math.min(...next) : sec.to.bar;
      for (let b = sg.bar; b < end; b++) { const i = b - lanes.from_bar; if (i >= 0 && i < subdiv.length) subdiv[i] = Math.max(0.25, Math.min(4, subdiv[i] * k)); }
    }
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
    const idx = bar => (facts ? bar - facts.from_bar : -1);
    const vectors = facts ? facts.vectors : [];
    const sectionVector = facts ? majorityVector(vectors, idx(sec.from.bar), idx(sec.to.bar), context) : { form: context };

    /* the PARs: a look + the phase's contrast (floor/peak/mode) -- remembered when
       this material has played before and the remembered look still suits here */
    const label = sec.like || sec.repeat || null;
    const mem = label && memory[label];
    /* a remembered look returns unless this section's FORM vetoes it (affinity 0);
       being merely weak here is not a reason to break the show's rule */
    const stillFits = id => {
      if (!id) return false;
      const A = enumResult && enumResult.affinity;
      if (A && A.form && A.form[id]) return A.form[id][context] > 0;
      const M = enumResult && enumResult.matrix;
      return !!(M && M[id] && M[id][context] > 0);
    };
    let remembered;
    const par = (mem && stillFits(mem.par)) ? { id: mem.par } : pickFor(sectionVector, "par");
    if (mem && par && par.id === mem.par) remembered = label;
    /* Two things the renderer can now express and nothing was setting.

       `grow` closes the gap between floor and peak across the section's own
       span, so a section the score says is rising actually rises instead of
       being the same in its first bar and its last. Taken straight from the
       section's rise; a falling section gets none, because a look that grows
       through an outro is fighting the music.

       `spread` is beats between one lamp and the next along the row -- the
       thing that turns four lamps into a rig with width rather than one lamp
       wired four times. Wide when the music is sparse, because a wave needs
       room to travel; nothing when it is busy, because at speed the lamps
       should land together. */
    const secRise = partRise(sec, score) || 0;
    const grow = secRise > 0.02 ? +clamp01(secRise * 2.2).toFixed(3) : 0;
    const spread = rate >= 1.5 ? 0
                 : rate >= 0.9 ? 0.125
                 : dyn.mode === "breathe" ? 0.5 : 0.25;
    const parParams = { rate, hue, floor: dyn.floor, peak: dyn.peak, mode: dyn.mode,
                        intensity: boldness, grow, spread };

    const inside = subsIn(sec);

    /* a subsection that changes what the music is doing gets its own PAR look; the
       first one is the section's identity and keeps the base. The base is carved
       around the variations, so no two concurrent looks claim pars:colour/level. */
    const variations = [];
    let lastVar = null;
    inside.forEach((su, j) => {
      const cls = classify(su);
      const isFirst = j === 0 || su.f === secFrom;
      /* an unknown word (not in the vocabulary) is not "doing something" -- it is
         silence on this fact, the same as a bar with no subsection at all */
      const doing = FACTS.doing.includes(su.doing) ? su.doing : "holding";
      const wantsOwn = par && !isFirst && inside.length > 1 && (doing !== "holding" || su.has_break);
      if (wantsOwn) {
        /* the subsection's own vector: its word for doing, the facts its bars agree on */
        const subVector = facts
          ? majorityVector(vectors, idx(barOf(su.f)), idx(barOf(su.t)), context, doing)
          : { form: context, doing };
        let pick = pickFor(subVector, "par", [par.id, lastVar]);
        if (!pick) pick = pickFor(sectionVector, "par", [par.id, lastVar]);
        if (pick) {
          const vp = { ...parParams };
          if (cls === "lift") { vp.floor = +clamp01(dyn.floor + 0.05).toFixed(3); vp.intensity = +clamp01(boldness * 1.1).toFixed(3); }
          if (cls === "ease") { vp.floor = +clamp01(dyn.floor - 0.15).toFixed(3); vp.intensity = +clamp01(boldness * 0.9).toFixed(3); }
          variations.push({ from: fromBeat(su.f), to: fromBeat(su.t), seq_id: pick.id, context, facts: subVector,
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
      const pieces = carve(secFrom, secTo, variations.map(v => [v.f, v.t]))
        .filter(pc => pc[1] > pc[0]);
      pieces.forEach((pc, k) => assignments.push({
        from: fromBeat(pc[0]), to: fromBeat(pc[1]), seq_id: par.id, context, layer: "par", priority: 0,
        ...(pieces.length > 1 ? { piece: k, origin: sec.from } : {}),   /* so a scripted compound keeps its clock */
        params: parParams, facts: sectionVector, ...(remembered ? { remembered } : {}), occupies: occFor(par.id, "par"), section: sec.name,
      }));
      for (const v of variations) { const { f, t, ...a } = v; assignments.push(a); }
    }

    /* the head: always moving/lit, its own colour voice, speed by phase -- one
       continuous look per section, so the hero element reads as continuity */
    const head = (mem && stillFits(mem.head)) ? { id: mem.head } : pickFor(sectionVector, "head");
    if (label) memory[label] = { par: par && par.id, head: head && head.id };
    if (head) assignments.push({
      from: sec.from, to: sec.to, seq_id: head.id, context, layer: "head", priority: 1,
      params: { rate, hue, headDim: dyn.head, motion: dyn.motion, intensity: dyn.head },
      facts: sectionVector, ...(mem && head.id === mem.head ? { remembered: label } : {}), occupies: occFor(head.id, "head"), section: sec.name,
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
  /* phase B: a moment DRAWS its punctuation from the matrix. Its vector is the bar's
     facts plus the moment kind and weight band; one one-shot per slot (before / on /
     span) is drawn among the oneshot candidates. When the cache offers none (an
     older cache, an unknown kind) the fixed effects below still fire. */
  const FX_PRIORITY = { white_blast: 9, blackout: 9, pause: 8, hook: 7, accent_strobe: 5, modulate: 4, whiten: 3 };
  const riffMemory = {};   /* a returning riff is lit the way it was lit the first time */
  const drawOneShots = (m, w, B, len) => {
    const bar = facts && facts.vectors[m.bar - facts.from_bar];
    const vector = { ...(bar || { form: ctxAt(B) }), moment: [m.kind, weightBand(w)] };
    if (!vector.form) return [];
    const shots = V.candidates(vector).filter(c => { const q = V.seq(c.id); return q && q.kind === "oneshot" && q.gesture && q.gesture.fx; });
    const out = [];
    const riffKey = m.kind === "hook" && m.what ? "hook:" + m.what : null;
    const remembered = riffKey && riffMemory[riffKey];
    const chosen = {};
    for (const slot of ["before", "on", "span"]) {
      const pool = shots.filter(c => (V.seq(c.id).gesture.slot || "on") === slot);
      const pick = (remembered && remembered[slot] && pool.some(c => c.id === remembered[slot])) ? { id: remembered[slot] } : pickWeighted(pool, rng);
      if (!pick) continue;
      const q = V.seq(pick.id), g = q.gesture;
      const dur = slot === "span" ? (len || q.duration_beats || bpb) : (q.duration_beats || 1);
      const start = slot === "before" ? B - dur : B;
      const params = { strength: w, ...(g.params || {}) };
      if (g.fx === "pause") params.still = m.still || [];
      if (g.fx === "whiten" && params.amount == null) params.amount = +clamp01(0.2 + 0.5 * w).toFixed(3);
      if (g.fx === "accent_strobe") params.strength = +clamp01(0.4 + 0.6 * w).toFixed(3);
      chosen[slot] = pick.id;
      out.push({ from: fromBeat(start), to: fromBeat(start + dur), context: ctxAt(B), layer: g.fx === "modulate" ? "modulate" : "fx",
        priority: FX_PRIORITY[g.fx] || 6, type: g.fx, seq_id: pick.id, params, occupies: q.occupies || [],
        section: sectionAt(B), moment: m.kind, what: m.what, facts: vector });
    }
    if (riffKey && out.length && !remembered) riffMemory[riffKey] = chosen;
    return out;
  };
  /* returning riffs the signals name (again_of) join the moments, unless a moment
     already sits on that bar and beat; a rise signal becomes a RAMP that arrives at
     full exactly for_beats later -- frame grows level, motion and whiteness along it */
  const has = (b, bt, k) => moments.some(m => m.bar === b && m.beat === bt && m.kind === k);
  for (const sg of signals) {
    /* Every kind of signal is a candidate, not just the three this loop used to
       take. raga-of-revenge marks drums entering at bar 7, the harmony turning
       six times, a rhythm change at 52 weighted 0.64, the band accenting at 60 --
       around sixty signals in one song, and all but the hooks and rises went
       straight in the bin. A gesture should be possible anywhere the music says
       something happened. */
    if (!has(sg.bar, sg.beat, sg.kind)) moments.push(sg);
    if (sg.kind === "rise" && (typeof sg.weight !== "number" || sg.weight >= 0.2)) {
      const B = atBeat({ bar: sg.bar, beat: sg.beat });
      const len = typeof sg.for_beats === "number" && sg.for_beats > 0 ? sg.for_beats : 2 * bpb;
      assignments.push({ from: fromBeat(B), to: fromBeat(B + len), context: ctxAt(B), layer: "modulate", priority: 4, type: "ramp",
        params: { weight: typeof sg.weight === "number" ? clamp01(sg.weight) : 0.5 }, occupies: [], section: sectionAt(B), signal: "rise", what: sg.what });
    }
  }
  /* The ear changing hands is a moment in its own right, and often the only
     thing marking one -- bar 55 of raga-of-revenge is the biggest jump in the
     song and the score flags nothing there at all. */
  for (const h of handovers(score)) {
    /* Only where nothing else already speaks for that bar or its neighbour --
       the point is to cover the score's blind spots, not to double up on the
       moments it already found. */
    /* Same bar only. A neighbouring bar having a signal does not mean this one
       is spoken for -- bar 55 of raga is the biggest jump in the song and was
       being suppressed because bar 56 happens to carry a vocal pause. */
    if (!moments.some(m => m.bar === h.bar)) moments.push(h);
  }
  /* ---- one thing per moment, and only the moments that earn one ------------
     Taking every signal makes the opposite problem: bar 7 carries drums
     entering, the harmony turning and the riff returning, all on one downbeat,
     and three gestures at once is exactly the wall of light a show is supposed
     to avoid. So collapse each position to its heaviest single event -- the
     rig says one thing, about the most important thing that happened.

     Then rank what is left and keep roughly one event every four bars. A song
     does not have sixty moments in it; it has a dozen, and the rest is the
     quiet that makes them read. Cutting by rank rather than by a fixed weight
     means a busy song and a still one both end up with a show that breathes. */
  {
    const best = new Map();
    for (const m of moments) {
      const at = `${m.bar}:${m.beat}`;
      const w = typeof m.weight === "number" ? m.weight : 0.5;
      const prev = best.get(at);
      if (!prev || w > (typeof prev.weight === "number" ? prev.weight : 0.5)) best.set(at, m);
    }
    const one = [...best.values()];
    const span = Math.max(1, (sections.length ? sections[sections.length - 1].to.bar : 64));
    const keep = Math.max(6, Math.min(24, Math.round(span / 4)));
    one.sort((a, b) => ((b.weight || 0.5) - (a.weight || 0.5)));
    const kept = one.filter(m => m.kind !== "handover").slice(0, keep);

    /* Handovers are capped below real signals on purpose, which means ranking
       alone would always drop them -- and the whole reason they exist is to
       cover bars the score says nothing about. So they are chosen separately,
       strongest surprise first, and only where the show would otherwise be
       silent for a long stretch. Bar 55 of raga is the biggest jump in the song
       with no signal on it; this is what puts a gesture there. */
    const GAP = 4;
    const picks = one.filter(m => m.kind === "handover")
      .sort((a, b) => (b.surprise || 0) - (a.surprise || 0));
    const taken = [];
    for (const h of picks) {
      if (taken.length >= 4) break;
      const lonely = !kept.concat(taken).some(m => Math.abs(m.bar - h.bar) < GAP);
      if (lonely) taken.push(h);
    }
    moments.length = 0;
    moments.push(...kept, ...taken);
  }
  moments.sort((a, b) => (a.bar - b.bar) || (a.beat - b.beat));
  for (const m of moments) {
    const w = typeof m.weight === "number" ? clamp01(m.weight) : 0.5;
    const B = atBeat({ bar: m.bar, beat: m.beat });
    const len = typeof m.for_beats === "number" && m.for_beats > 0 ? m.for_beats : null;
    const tag = { moment: m.kind, what: m.what };
    if (m.kind === "pause" || w >= 0.25) {
      const shots = drawOneShots(m, w, B, len);
      if (shots.length) { assignments.push(...shots); continue; }
    }
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
  if (facts) out.facts = facts;
  if (lanesOut) out.lanes = lanesOut;
  if (tension) out.tension = tension;
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

module.exports = { plan, contextsFor, sectionEnergyMean, energyReader, clashes, carve, factsBlock, majorityVector };

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
  const vec = f => f ? "[" + [f.form, f.doing, (f.presence || []).join("+"), (f.texture || []).join("+"), (f.harmony || []).join("+")].filter(Boolean).join("|") + "]" : "";
  for (const a of p.assignments)
    console.log("  " + (pos(a.from) + "-" + pos(a.to)).padEnd(11) +
      "  " + String(a.section || "").padEnd(11) + " " + a.layer.padEnd(9) + " -> " + String(a.seq_id || a.type).padEnd(28) +
      (a.variation ? " [var " + a.doing + "]" : a.moment ? " [" + a.moment + (a.what ? ": " + a.what : "") + "]" : "") +
      " " + vec(a.facts));
  console.log(`  (${clashes(p)} clashes; ${p.lanes ? "lanes " + Object.keys(p.lanes).filter(k => k !== "from_bar").join("/") : "no lanes"}; ${p.harmony ? "harmony from key hue " + (p.harmony.key && p.harmony.key.hue) : "no harmony"})`);
}
