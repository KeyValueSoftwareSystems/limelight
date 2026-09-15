"use strict";
/* musical.js -- shape-agnostic readers of a score's finer structure.
   ---------------------------------------------------------------------------
   Two score shapes reach the lights reader and it must not care which:
     raw (pipeline)   parts, phrases, moments{bar,beat,is}, bars.{width,..,chord},
                      chords = a summary object, presence, phrase_grid
     format_v1 (hub)  sections, layers.{subsection,presence,phrase}, moments
                      passed through, top-level lanes + curves.*, stems.lanes,
                      harmony, chords = a per-bar LIST
   Every reader here returns one canonical shape from either input, so the plan
   is identical whichever the hub handed us (the bake parity test pins that).
   Only fields present in BOTH shapes are read -- the raw file's finer
   `presence` spans, for one, do not survive the Python formatter, so the
   per-bar stem lanes carry within-section presence instead.
   All pure; positions are bar/beat; arrays keep their nulls (a gap is not a 0). */

const or_ = (v, d) =>
  v === undefined || v === null
    ? d
    : v; /* default on absence, never falsiness */
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* the bar the per-bar arrays start on: the grid says, else the first section */
function firstBarOf(score) {
  const g = (score && score.grid) || {};
  if (isNum(g.first_bar)) return g.first_bar;
  const secs =
    (score && (score.sections || ((score.layers || {}).form || {}).spans)) ||
    [];
  if (secs.length) return Math.min(...secs.map((s) => s.from.bar));
  const parts = (score && score.parts) || [];
  if (parts.length) return Math.min(...parts.map((p) => p.from_bar));
  return 1;
}

/* ---- subsections: layers.subsection.spans (format_v1) or phrases (raw) ------ */
function subsectionsOf(score) {
  if (!score) return [];
  const L = (score.layers || {}).subsection;
  const norm = (from, to, p) => ({
    from,
    to,
    in: or_(p.in, null),
    in_nth: or_(p.in_nth, null),
    doing: or_(p.doing, null),
    also: p.also || [],
    says: or_(p.says, null),
    energy: or_(p.energy, null),
    rise: or_(p.rise, null),
    playing: p.playing || [],
    has_break: p.break != null || !!p.has_break,
  });
  if (L && Array.isArray(L.spans))
    return L.spans.map((sp) => norm(sp.from, sp.to, sp));
  if (Array.isArray(score.phrases))
    return score.phrases.map((p) =>
      norm({ bar: p.from_bar, beat: 1 }, { bar: p.to_bar + 1, beat: 1 }, p),
    );
  return [];
}

/* ---- moments and signals: {bar, beat, is|kind, weight|strength, for_beats, still,
   again_of}. Signals are the pipeline's other events (rises, tempo changes, riffs
   returning); both shapes pass them through untouched, so one normaliser serves. */
function eventsOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list) {
    const at = m.at || m;
    if (!isNum(at.bar)) continue;
    const o = {
      bar: at.bar,
      beat: or_(at.beat, 1),
      kind: or_(m.is, or_(m.kind, or_(m.type, null))),
      what: or_(m.what, null),
      weight: or_(
        m.weight,
        or_(m.strength, or_(m.jump, or_(m.size, or_(m.intensity, null)))),
      ),
      sure: or_(m.sure, null),
    };
    if (isNum(m.for_beats)) o.for_beats = m.for_beats;
    if (Array.isArray(m.still)) o.still = m.still;
    if (isNum(m.again_of)) o.again_of = m.again_of;
    out.push(o);
  }
  return out;
}
const momentsOf = (score) => eventsOf(score && score.moments);
const signalsOf = (score) => eventsOf(score && score.signals);

/* ---- the per-bar texture lanes: bars.* (raw) or top-level / curves (format_v1) */
const LANES = ["width", "air", "pump", "pace", "brightness"];
function lanesOf(score) {
  if (!score) return null;
  const bars = score.bars || {},
    curves = score.curves || {};
  const out = { from_bar: firstBarOf(score) };
  let any = false;
  for (const k of LANES) {
    const v = Array.isArray(bars[k])
      ? bars[k]
      : Array.isArray(score[k])
        ? score[k]
        : curves[k] && Array.isArray(curves[k].values)
          ? curves[k].values
          : null;
    if (v) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
}

/* ---- the per-bar stem lanes: bars.{drums,..} (raw) or stems.lanes (format_v1) */
const STEMS = ["drums", "bass", "vocals", "other"];
function stemLanesOf(score) {
  if (!score) return null;
  const bars = score.bars || {};
  const fromStems = score.stems && score.stems.lanes ? score.stems.lanes : null;
  const lanes = {};
  let any = false;
  for (const s of STEMS) {
    const v = Array.isArray(bars[s])
      ? bars[s]
      : fromStems && Array.isArray(fromStems[s])
        ? fromStems[s]
        : null;
    if (v) {
      lanes[s] = v;
      any = true;
    }
  }
  if (!any) return null;
  const from_bar =
    fromStems && isNum(score.stems.from_bar)
      ? score.stems.from_bar
      : firstBarOf(score);
  return { from_bar, lanes };
}

/* ---- harmony: per-bar chord names + the key ---------------------------------- */
function harmonyOf(score) {
  if (!score) return null;
  const bars = score.bars || {};
  let from_bar, chords, confidence;
  if (Array.isArray(bars.chord)) {
    from_bar = firstBarOf(score);
    chords = bars.chord;
    confidence = bars.chord_sure || [];
  } else if (score.harmony && Array.isArray(score.harmony.chords)) {
    from_bar = or_(score.harmony.from_bar, firstBarOf(score));
    chords = score.harmony.chords;
    confidence = score.harmony.confidence || [];
  } else return null;
  const k = score.key || {};
  const key = { root: or_(k.root, null), scale: or_(k.scale, null) };
  return {
    from_bar,
    chords: chords.map((c) => (c ? String(c) : null)),
    confidence: chords.map((_, i) => or_(confidence[i], null)),
    key,
  };
}

/* ---- tension: one value per beat -- a bare array (raw) or {per:'beat', from_bar,
   values} (format_v1); anchored at the first bar, beat 1 ------------------------- */
function tensionOf(score) {
  if (!score) return null;
  if (Array.isArray(score.tension))
    return { from_bar: firstBarOf(score), values: score.tension };
  const T = score.tension;
  if (T && Array.isArray(T.values))
    return { from_bar: or_(T.from_bar, firstBarOf(score)), values: T.values };
  return null;
}

/* a chord name -> { root: pitch class 0..11, minor } ; null when unparseable */
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function chordOf(name) {
  if (typeof name !== "string") return null;
  const m = /^([A-G])([#b]?)(.*)$/.exec(name.trim());
  if (!m) return null;
  let pc = PC[m[1]];
  if (m[2] === "#") pc = (pc + 1) % 12;
  if (m[2] === "b") pc = (pc + 11) % 12;
  const rest = m[3];
  const minor = /^m(?!aj)/.test(rest) || /^min/.test(rest) || /^-/.test(rest);
  return { root: pc, minor };
}
/* hue on the circle of fifths, so harmonic neighbours are colour neighbours:
   C G D A E B F# C# G# D# A# F -> 0 .. 11/12 */
function hueOfChord(name) {
  const c = chordOf(name);
  if (!c) return null;
  return +(((c.root * 7) % 12) / 12).toFixed(4);
}

/* ---- per-song normalisation: the 10th..90th percentile -> 0..1, nulls kept --- */
function normalise(values) {
  if (!Array.isArray(values)) return null;
  const nums = values
    .filter(isNum)
    .slice()
    .sort((a, b) => a - b);
  if (!nums.length) return values.map(() => null);
  const q = (p) => nums[Math.min(nums.length - 1, Math.floor(p * nums.length))];
  const lo = q(0.1),
    hi = q(0.9);
  return values.map((v) => {
    if (!isNum(v)) return null;
    if (hi - lo < 1e-9) return 0.5;
    return +Math.max(0, Math.min(1, (v - lo) / (hi - lo))).toFixed(4);
  });
}

/* a reader over an anchored per-bar array, holding at the edges */
function perBar(from_bar, values) {
  if (!Array.isArray(values) || !values.length) return () => null;
  return (bar) => {
    let i = Math.round(bar) - from_bar;
    if (i < 0) i = 0;
    if (i >= values.length) i = values.length - 1;
    return or_(values[i], null);
  };
}

module.exports = {
  firstBarOf,
  subsectionsOf,
  momentsOf,
  signalsOf,
  lanesOf,
  stemLanesOf,
  harmonyOf,
  tensionOf,
  chordOf,
  hueOfChord,
  normalise,
  perBar,
  LANES,
  STEMS,
};
