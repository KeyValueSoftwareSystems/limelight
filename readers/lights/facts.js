"use strict";
/* facts.js -- the musical facts the matrix understands, a context VECTOR, and the
   scoring rule (spec: "The context vector", "Scoring").
   A context used to be one of eight form names. It is now a small vector of facts
   the score already states, one per bar: the form, what the subsection is doing,
   who is playing, the moment landing there with its weight band, texture bands and
   harmony. A sequence declares affinity per family; the cell is fit times the
   geometric mean of the affinities for the facts the vector carries in the families
   the sequence mentions. A 0 is a veto. An unmentioned family is neutral.
   Every word here is a MUSICAL fact the protocol emits (never a lighting word), so
   the matrix stays rig-independent. Pure; no I/O. */

const FACTS = {
  form: [
    "intro",
    "verse",
    "break",
    "build",
    "drop",
    "outro",
    "silence",
    "final_drop",
  ],
  /* the spec's eight, plus the pipeline's other words -- the scores emit them */
  doing: [
    "establishing",
    "developing",
    "sustaining",
    "expanding",
    "intensifying",
    "peaking",
    "easing",
    "thinning",
    "resolving",
    "suspending",
    "transitioning",
    "closing",
    "holding",
  ],
  presence: [
    "drums:in",
    "drums:out",
    "bass:in",
    "bass:out",
    "vocals:in",
    "vocals:out",
  ],
  moment: [
    "drop",
    "breakdown",
    "build",
    "peak",
    "register_shift",
    "tempo_change",
    "rhythm_change",
    "entrance",
    "release",
    "hook",
    "pause",
    "fill",
    "rise",
    "exit",
    "accent",
    "change",
    "transition",
    "highlight",
    "light",
    "firm",
    "heavy",
  ],
  texture: ["narrow", "wide", "sparse", "busy", "dull", "bright"],
  harmony: ["minor", "major", "changing"],
};
const FAMILIES = Object.keys(FACTS);

/* a bare form string, or { form, family: fact | [facts] } -> { form, family: [facts] } */
function toVector(ctx) {
  if (typeof ctx === "string") return { form: ctx };
  if (!ctx || typeof ctx !== "object") return { form: null };
  const v = { form: typeof ctx.form === "string" ? ctx.form : null };
  for (const fam of FAMILIES) {
    if (fam === "form") continue;
    const x = ctx[fam];
    if (x === undefined || x === null) continue;
    v[fam] = (Array.isArray(x) ? x : [x]).filter(
      (f) => f !== null && f !== undefined,
    );
  }
  return v;
}

/* affinity: { family: { fact: 0..1, _default?: 0..1 } } for ONE sequence.
   fitK: the sequence's fit multiplier (a base sequence's fit; 1 for a palette one). */
function cellFor(affinity, fitK, vector) {
  const v = toVector(vector);
  if (!v.form) return 0;
  if (!affinity || !affinity.form)
    return 0; /* no form table: nothing to stand on */
  let logs = 0,
    n = 0;
  for (const fam of FAMILIES) {
    const table = affinity && affinity[fam];
    if (!table) continue; /* unmentioned family: neutral */
    const facts = fam === "form" ? [v.form] : v[fam] || [];
    for (const f of facts) {
      let a = table[f];
      if (a === undefined) {
        if (fam === "form")
          return 0; /* a form the table doesn't name is a veto, not a shrug */
        a = table._default !== undefined ? table._default : 0.5;
      }
      if (!(a > 0)) return 0; /* a veto */
      logs += Math.log(Math.min(1, a));
      n++;
    }
  }
  if (!n) return 0; /* belt and braces: a form table always
                                                               scores the form fact above, so n > 0 */
  return +(fitK * Math.exp(logs / n)).toFixed(4);
}

module.exports = { FACTS, FAMILIES, toVector, cellFor };
