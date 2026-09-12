# Fact-Driven Matrix, Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The suitability matrix scores a **context vector** of musical facts (form, what the subsection is doing, who is playing, texture bands, harmony, a moment) instead of one form column, and the arranger draws base looks and subsection variations with vectors built from the score, recording per-bar facts in the plan.

**Architecture:** A new `facts.js` owns the fact vocabulary, vector normalisation and the scoring rule (fit times the geometric mean of the matched family affinities, a 0 is a veto, an unmentioned family is neutral). `preflight.js` validates and stores per-family affinity in the cached enumeration (`affinity[family][seq][fact]`), keeps the form table for the report and old callers, and `view().candidates()` accepts a vector or a bare form string. `arranger.js` builds one vector per bar from `musical.js` readers, derives section and subsection vectors by majority, picks with them, drops the CALMER/BOLDER context stepping, and exposes `plan.facts`; `bake.js` exports it. No renderer changes in this phase.

**Tech Stack:** Node 24 (plain CommonJS, no framework; tests are `ok(name, cond)` lists run with `node <file>`), Python 3 for the parity test, JSON caches.

**Spec:** `docs/superpowers/specs/2026-09-13-limelight-fact-driven-palette-design.md` (sections: The context vector; What a sequence declares; Scoring; The arranger with vectors; Validation; Backward compatibility; Testing; Phases → **A**).

## Global Constraints

- `plan(score, enumResult, seed)` stays a pure, deterministic function of `(score, seed)`: no Date, no I/O, no wall time.
- The plan is in bars and beats only; never seconds or tempo (the two-clock rule).
- Sequences are chosen only through `view(result).candidates(...)`; no sequence id is hard-coded in the arranger.
- Concurrent sequence assignments never share an `occupies` token; `clashes(plan)` must stay 0 on levels.
- Scores without the richer fields plan exactly as today: a vector carrying only `form` must give the same candidates as the form string, and the seeded draw order must not change.
- Both score shapes (raw pipeline file and the hub's format_v1 view) must plan byte-identically: every fact is read through `musical.js`; `python3 readers/lights/panel/protocol_bake.test.py` must stay green.
- Fact values are the spec's vocabulary (spec table "What the score says, per bar"), with the pipeline's extra `doing` words (developing, sustaining, expanding, thinning, transitioning) admitted as valid facts because the scores emit them.
- Thresholds are the spec's: presence `in` at 0.3 of the stem's own peak; texture bands below 0.33 / above 0.67 of the per-song normalised lane; moment weight bands light `< 0.5`, firm `0.5–0.75`, heavy `≥ 0.75`.
- **Commit hold:** the working tree is shared with session `2026-9b`, which commits its renderPar work first; nothing is committed until Alnas says so. Every "Commit" step below is written for when the hold lifts; until then, leave the changes in the working tree and run the suite.
- Suite to keep green after every task: `node readers/lights/{facts,musical,fromscore,preflight,arranger,frame,wire,bake}.test.js`, `node readers/lights/drivers/*.test.js`, `python3 readers/lights/bridge.test.py`, `python3 readers/lights/panel/protocol_bake.test.py`.

---

## File structure

| File | Responsibility |
|---|---|
| **Create** `readers/lights/facts.js` | the fact vocabulary `FACTS`, `toVector(ctx)`, `cellFor(affinity, fitK, vector)`; pure, no I/O; used by preflight, arranger, tests |
| **Create** `readers/lights/facts.test.js` | pins the vocabulary, normalisation and scoring maths |
| **Modify** `readers/lights/preflight.js` | `VOCABULARY[].affinity` becomes family-shaped with hand-tuned doing/presence/texture anchors; `validateSequence` accepts `affinity` (or legacy `suitability`); `enumerate` emits `affinity`, `fit`, keeps `matrix`, adds `report.strongest_by_fact`; `view().candidates` scores vectors, falls back to `matrix` for old caches |
| **Modify** `readers/lights/preflight.test.js` | the new contract |
| **Regenerate** `readers/lights/arc4-head.matrix.json` | the cache in the new shape (`node readers/lights/preflight.js`) |
| **Modify** `readers/lights/arranger.js` | `lanesBlock` adds `bass`; new `factsBlock` → `plan.facts`; `sectionVector` / subsection vectors by majority; `pickFor(vector, …)`; CALMER/BOLDER removed; assignments carry `facts`; CLI prints the vector |
| **Modify** `readers/lights/arranger.test.js` | vectors per bar, picks explained, parity, no clashes |
| **Modify** `readers/lights/bake.js`, `readers/lights/bake.test.js` | timeline carries `facts` |

---

### Task 1: `facts.js` — vocabulary, vector, scoring

**Files:**
- Create: `readers/lights/facts.js`
- Test: `readers/lights/facts.test.js`

**Interfaces:**
- Produces: `FACTS: { form: string[], doing: string[], presence: string[], moment: string[], texture: string[], harmony: string[] }`; `FAMILIES: string[]` (the keys of FACTS in that order); `toVector(ctx: string | object) -> { form: string|null, [family]: string[] }`; `cellFor(affinity: { [family]: { [fact]: number, _default?: number } }, fitK: number, vector) -> number` (0..1, 4 decimals, 0 on veto or missing form).

- [ ] **Step 1: Write the failing tests**

```js
/* facts.js tests -- the musical facts the matrix understands, the context vector,
   and the scoring rule from the spec: fit x geomean of matched family affinities;
   a 0 is a veto; an unmentioned family is neutral. Plain node idiom. */
"use strict";
const { FACTS, FAMILIES, toVector, cellFor } = require("./facts.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-4 : e);

/* ---- the vocabulary ------------------------------------------------------- */
{
  ok("six fact families, form first", FAMILIES.join(",") === "form,doing,presence,moment,texture,harmony", FAMILIES.join(","));
  ok("form is the eight matrix contexts", FACTS.form.length === 8 && FACTS.form.includes("final_drop"));
  ok("doing carries the spec's words and the pipeline's extras",
     ["establishing", "intensifying", "peaking", "easing", "suspending", "resolving", "closing", "holding", "expanding", "thinning"].every(w => FACTS.doing.includes(w)));
  ok("presence facts are stem:in / stem:out for drums, bass, vocals",
     FACTS.presence.join(",") === "drums:in,drums:out,bass:in,bass:out,vocals:in,vocals:out");
  ok("moment facts are the kinds plus the three weight bands",
     ["entrance", "release", "hook", "pause", "fill", "rise", "exit", "accent", "change", "light", "firm", "heavy"].every(w => FACTS.moment.includes(w)));
  ok("texture facts are three band pairs", FACTS.texture.join(",") === "narrow,wide,sparse,busy,dull,bright");
  ok("harmony facts", FACTS.harmony.join(",") === "minor,major,changing");
}

/* ---- toVector: a bare form string is a vector with only form -------------- */
{
  ok("a string is a form-only vector", JSON.stringify(toVector("drop")) === JSON.stringify({ form: "drop" }));
  const v = toVector({ form: "drop", doing: "peaking", presence: ["drums:in", null, "bass:in"], texture: [] });
  ok("a scalar family value becomes a one-element list", JSON.stringify(v.doing) === JSON.stringify(["peaking"]));
  ok("nulls are dropped from a family list", JSON.stringify(v.presence) === JSON.stringify(["drums:in", "bass:in"]));
  ok("an empty family list is kept as empty (says nothing)", Array.isArray(v.texture) && v.texture.length === 0);
  ok("an absent family is absent", v.harmony === undefined && v.moment === undefined);
  ok("garbage gives a formless vector", toVector(null).form === null && toVector(42).form === null);
}

/* ---- cellFor: the scoring rule ------------------------------------------- */
{
  const A = { form: { drop: 0.8, intro: 0 }, doing: { peaking: 0, easing: 0.9 } };
  ok("form only: fit x form affinity", near(cellFor(A, 1, "drop"), 0.8), `${cellFor(A, 1, "drop")}`);
  ok("fit scales the cell", near(cellFor(A, 0.5, "drop"), 0.4));
  ok("a matched family joins the geometric mean", near(cellFor(A, 1, { form: "drop", doing: "easing" }), Math.sqrt(0.8 * 0.9)), `${cellFor(A, 1, { form: "drop", doing: "easing" })}`);
  ok("a fact scored 0 is a veto", cellFor(A, 1, { form: "drop", doing: "peaking" }) === 0);
  ok("a form scored 0 is a veto too", cellFor(A, 1, "intro") === 0);
  ok("a fact the vector carries but the table omits scores 0.5", near(cellFor(A, 1, { form: "drop", doing: "holding" }), Math.sqrt(0.8 * 0.5)));
  const D = { form: { drop: 0.8 }, doing: { peaking: 0.9, _default: 0.2 } };
  ok("_default replaces the 0.5 for omitted facts", near(cellFor(D, 1, { form: "drop", doing: "holding" }), Math.sqrt(0.8 * 0.2)));
  ok("an unmentioned family is neutral (not in the mean)", near(cellFor({ form: { drop: 0.8 } }, 1, { form: "drop", doing: "peaking", texture: ["busy"] }), 0.8));
  const P = { form: { drop: 0.8 }, presence: { "drums:in": 0.9, "bass:in": 0.6 } };
  ok("several facts of one family each join the mean", near(cellFor(P, 1, { form: "drop", presence: ["drums:in", "bass:in"] }), Math.pow(0.8 * 0.9 * 0.6, 1 / 3)));
  ok("the mean is order-independent", cellFor(P, 1, { form: "drop", presence: ["drums:in", "bass:in"] }) === cellFor(P, 1, { form: "drop", presence: ["bass:in", "drums:in"] }));
  ok("no form, no cell", cellFor(A, 1, { doing: "easing" }) === 0 && cellFor({ doing: { easing: 1 } }, 1, "drop") === 0);
  ok("cells are rounded to four decimals", String(cellFor(A, 1, { form: "drop", doing: "easing" })).replace("0.", "").length <= 4);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/facts.test.js`
Expected: `Error: Cannot find module './facts.js'`

- [ ] **Step 3: Write the module**

```js
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
  form: ["intro", "verse", "break", "build", "drop", "outro", "silence", "final_drop"],
  /* the spec's eight, plus the pipeline's other words -- the scores emit them */
  doing: ["establishing", "developing", "sustaining", "expanding", "intensifying", "peaking",
          "easing", "thinning", "resolving", "suspending", "transitioning", "closing", "holding"],
  presence: ["drums:in", "drums:out", "bass:in", "bass:out", "vocals:in", "vocals:out"],
  moment: ["entrance", "release", "hook", "pause", "fill", "rise", "exit", "accent", "change",
           "light", "firm", "heavy"],
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
    v[fam] = (Array.isArray(x) ? x : [x]).filter(f => f !== null && f !== undefined);
  }
  return v;
}

/* affinity: { family: { fact: 0..1, _default?: 0..1 } } for ONE sequence.
   fitK: the sequence's fit multiplier (a base sequence's fit; 1 for a palette one). */
function cellFor(affinity, fitK, vector) {
  const v = toVector(vector);
  if (!v.form) return 0;
  let logs = 0, n = 0;
  for (const fam of FAMILIES) {
    const table = affinity && affinity[fam];
    if (!table) continue;                                   /* unmentioned family: neutral */
    const facts = fam === "form" ? [v.form] : (v[fam] || []);
    for (const f of facts) {
      let a = table[f];
      if (a === undefined) a = table._default !== undefined ? table._default : 0.5;
      if (!(a > 0)) return 0;                                /* a veto */
      logs += Math.log(Math.min(1, a)); n++;
    }
  }
  if (!n) return 0;                                         /* no form table: nothing to stand on */
  return +(fitK * Math.exp(logs / n)).toFixed(4);
}

module.exports = { FACTS, FAMILIES, toVector, cellFor };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node readers/lights/facts.test.js`
Expected: all checks pass (the file prints `all N checks pass`)

- [ ] **Step 5: Commit (when the hold lifts)**

```bash
git add readers/lights/facts.js readers/lights/facts.test.js
git commit -m "lights: the fact vocabulary, context vectors and the scoring rule (spec phase A)"
```

---

### Task 2: `validateSequence` accepts per-family affinity

**Files:**
- Modify: `readers/lights/preflight.js` (function `validateSequence`, currently the loop `for (const ctx of CONTEXTS) { const v = su[ctx]; ... }`)
- Test: `readers/lights/preflight.test.js`

**Interfaces:**
- Consumes: `FACTS`, `FAMILIES` from `./facts.js`.
- Produces: `validateSequence(seq, layout) -> { ok: true } | { ok: false, reason: string }` accepting `seq.affinity` (family-shaped) **or** legacy `seq.suitability` (a flat form table); exports a new `validateAffinity(aff) -> { ok, reason? }`.

- [ ] **Step 1: Write the failing tests** (append before the summary loop in `preflight.test.js`; the file already imports `enumerate, view, validateSequence, VOCABULARY` and defines `RIG`)

```js
/* ---- affinity: per-family, from the fact vocabulary ------------------------ */
{
  const { validateAffinity } = require("./preflight.js");
  const base = { id: "aff_ok", kind: "individual", boldness: "accent",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] }, occupies: ["pars:colour", "pars:level"],
    gesture: { group: "all_pars", keys: [{ at: 0, intent: { colour: [1, 0, 0] } }] } };
  const form = { intro: 0, verse: 0.5, break: 0.4, build: 0.6, drop: 0.9, outro: 0, silence: 0, final_drop: 0.9 };
  ok("a legacy suitability row still validates", validateSequence({ ...base, suitability: form }, RIG).ok);
  ok("a family-shaped affinity validates", validateSequence({ ...base, affinity: { form, doing: { peaking: 0.9, easing: 0.2, _default: 0.5 }, presence: { "drums:in": 0.8 } } }, RIG).ok,
     JSON.stringify(validateSequence({ ...base, affinity: { form, doing: { peaking: 0.9 } } }, RIG)));
  const unknownFact = validateSequence({ ...base, affinity: { form, doing: { grooving: 0.5 } } }, RIG);
  ok("an unknown fact is rejected and the message names it, its family and the allowed words",
     !unknownFact.ok && /grooving/.test(unknownFact.reason) && /doing/.test(unknownFact.reason) && /peaking/.test(unknownFact.reason), unknownFact.reason);
  const unknownFamily = validateSequence({ ...base, affinity: { form, mood: { happy: 1 } } }, RIG);
  ok("an unknown family is rejected", !unknownFamily.ok && /mood/.test(unknownFamily.reason), unknownFamily.reason);
  ok("an affinity value above 1 is rejected", !validateSequence({ ...base, affinity: { form, texture: { busy: 1.2 } } }, RIG).ok);
  ok("an affinity without form is rejected", !validateSequence({ ...base, affinity: { doing: { peaking: 1 } } }, RIG).ok);
  ok("neither affinity nor suitability is rejected", !validateSequence(base, RIG).ok);
  ok("validateAffinity is exported for generate.py's retry loop", validateAffinity({ form }).ok && !validateAffinity({ form, doing: { nope: 1 } }).ok);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/preflight.test.js 2>&1 | grep -v "^  pass"`
Expected: FAIL lines for "a family-shaped affinity validates", "an unknown fact is rejected…", "an unknown family is rejected", "an affinity without form is rejected", and a TypeError for `validateAffinity` not being a function (fix by implementing; a crash here is the missing export).

- [ ] **Step 3: Implement**

At the top of `preflight.js`, after `const drivers = require("./drivers/index.js");`:

```js
const { FACTS, FAMILIES, toVector, cellFor } = require("./facts.js");
```

Add before `function validateSequence`:

```js
/* per-family affinity: { form: {ctx: 0..1}, doing?: {fact: 0..1, _default?}, ... }.
   Facts come from facts.js's vocabulary; the message names the offending word and
   the allowed ones, because generate.py feeds it back to the model. */
function validateAffinity(aff) {
  const bad = reason => ({ ok: false, reason });
  if (!aff || typeof aff !== "object") return bad("missing affinity");
  if (!aff.form || typeof aff.form !== "object") return bad("affinity.form missing");
  for (const fam of Object.keys(aff)) {
    if (!FACTS[fam]) return bad("unknown affinity family `" + fam + "`; allowed: " + FAMILIES.join(", "));
    const table = aff[fam];
    if (!table || typeof table !== "object") return bad("affinity." + fam + " is not an object");
    for (const f of Object.keys(table)) {
      if (f !== "_default" && !FACTS[fam].includes(f))
        return bad("unknown fact `" + f + "` in family `" + fam + "`; allowed: " + FACTS[fam].join(", "));
      const x = table[f];
      if (typeof x !== "number" || x < 0 || x > 1) return bad("bad affinity for " + fam + "." + f);
    }
  }
  for (const ctx of CONTEXTS) {
    const v = aff.form[ctx];
    if (typeof v !== "number" || v < 0 || v > 1) return bad("bad suitability for " + ctx);
  }
  return { ok: true };
}
/* a sequence's affinity, whichever way it was written */
const affinityOf = seq => seq.affinity || (seq.suitability ? { form: seq.suitability } : null);
```

In `validateSequence`, replace

```js
  const su = seq.suitability || {};
  for (const ctx of CONTEXTS) {
    const v = su[ctx];
    if (typeof v !== "number" || v < 0 || v > 1) return bad("bad suitability for " + ctx);
  }
  return { ok: true };
```

with

```js
  return validateAffinity(affinityOf(seq));
```

Extend the export line to

```js
module.exports = { enumerate, view, validateSequence, validateAffinity, affinityOf, layoutFacts, groupsOf,
                   VOCABULARY, CONTEXTS, FIT_FLOOR, BUDGETS, FACTS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node readers/lights/preflight.test.js`
Expected: all checks pass (8 new)

- [ ] **Step 5: Commit (when the hold lifts)**

```bash
git add readers/lights/preflight.js readers/lights/preflight.test.js
git commit -m "preflight: validate per-family affinity from the fact vocabulary"
```

---

### Task 3: `enumerate` emits per-family affinity; base vocabulary gains fact anchors

**Files:**
- Modify: `readers/lights/preflight.js` (`VOCABULARY` entries' `affinity`; `enumerate`)
- Test: `readers/lights/preflight.test.js`

**Interfaces:**
- Consumes: `affinityOf`, `FAMILIES` (Task 2).
- Produces: `enumerate(layout, { palette }) -> { sequences, fit: { [seqId]: number }, affinity: { [family]: { [seqId]: { [fact]: number } } }, matrix: { [seqId]: { [form]: number } }, report }` where `report.strongest_by_fact: { [family]: { [fact]: [{ id, score }] } }` (families other than form) and `report.strongest` is unchanged. `sequences[i].fit` and `sequences[i].source` unchanged.

- [ ] **Step 1: Write the failing tests** (append before the summary loop)

```js
/* ---- enumerate: per-family affinity in the result, form table kept ----------- */
{
  const legacy = { id: "x_legacy", kind: "individual", boldness: "ambient",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] }, occupies: ["pars:colour", "pars:level"],
    gesture: { group: "all_pars", keys: [{ at: 0, intent: { colour: [0, 0, 1] } }] },
    suitability: { intro: 0.9, verse: 0.3, break: 0.4, build: 0.1, drop: 0, outro: 0.9, silence: 0.8, final_drop: 0 } };
  const rich = { ...legacy, id: "x_rich", suitability: undefined,
    affinity: { form: legacy.suitability, doing: { establishing: 0.9, peaking: 0 }, presence: { "drums:out": 0.9, "drums:in": 0.3 } } };
  delete rich.suitability;
  const e = enumerate(RIG, { palette: [legacy, rich] });
  ok("the result carries an affinity block keyed family -> sequence -> fact",
     e.affinity && e.affinity.form && e.affinity.form.x_legacy && e.affinity.form.x_legacy.intro === 0.9, JSON.stringify(Object.keys(e.affinity || {})));
  ok("a legacy suitability row becomes affinity.form", e.affinity.form.x_legacy.drop === 0);
  ok("a rich sequence's other families are stored", e.affinity.doing.x_rich.establishing === 0.9 && e.affinity.presence.x_rich["drums:out"] === 0.9);
  ok("a sequence that does not mention a family is absent from that family's table", e.affinity.doing.x_legacy === undefined);
  ok("the base vocabulary carries fact anchors beyond form",
     e.affinity.doing.pair_call_response && e.affinity.doing.pair_call_response.peaking > 0.5 && e.affinity.presence.breathe && e.affinity.presence.breathe["drums:out"] > 0.5);
  ok("the form table is still there for the report and old callers", e.matrix.x_legacy.intro === 0.9 && e.matrix.pair_call_response.drop > 0);
  ok("fit is stored per sequence", e.fit && e.fit.x_legacy === 0.9 && e.fit.pair_call_response === e.sequences.find(s => s.id === "pair_call_response").fit);
  ok("the report ranks the strongest sequences per fact", Array.isArray(e.report.strongest_by_fact.doing.peaking) && e.report.strongest_by_fact.doing.peaking[0].id, JSON.stringify(e.report.strongest_by_fact.doing.peaking));
  ok("the cache round-trips through JSON", JSON.stringify(JSON.parse(JSON.stringify(e)).affinity) === JSON.stringify(e.affinity));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/preflight.test.js 2>&1 | grep -v "^  pass"`
Expected: FAILs on "the result carries an affinity block…", "…fact anchors beyond form", "fit is stored…", "…strongest sequences per fact", and a TypeError reading `e.affinity.form` (the block is absent).

- [ ] **Step 3: Restructure the base vocabulary's affinity** — every `affinity: { intro: …, final_drop: … }` in `VOCABULARY` becomes `affinity: { form: { … }, … }` with hand-tuned anchors. Replace the eight entries' `affinity` values exactly as follows (keep every other field of each entry as it is):

```js
  // pair_call_response
  affinity: { form: { intro: 0, verse: 0.5, break: 0.4, build: 0.6, drop: 0.9, outro: 0, silence: 0, final_drop: 0.95 },
              doing: { peaking: 0.9, intensifying: 0.8, expanding: 0.8, holding: 0.6, easing: 0.4, thinning: 0.2, _default: 0.5 },
              presence: { "drums:in": 0.9, "drums:out": 0.3 },
              texture: { busy: 0.8, narrow: 0.7, sparse: 0.4 } },
  // travelling_pulse
  affinity: { form: { intro: 0, verse: 0.7, break: 0.4, build: 0.5, drop: 0.5, outro: 0, silence: 0, final_drop: 0.4 },
              doing: { establishing: 0.7, easing: 0.7, holding: 0.7, developing: 0.7, peaking: 0.4, _default: 0.5 },
              texture: { wide: 0.8, sparse: 0.6 } },
  // strobe_pops
  affinity: { form: { intro: 0, verse: 0.2, break: 0.4, build: 0.7, drop: 0.8, outro: 0, silence: 0, final_drop: 0.85 },
              doing: { peaking: 1, intensifying: 0.9, expanding: 0.7, easing: 0.2, thinning: 0, suspending: 0, _default: 0.4 },
              presence: { "drums:in": 0.9, "drums:out": 0 },
              texture: { busy: 0.9, sparse: 0.2 } },
  // head_sweep
  affinity: { form: { intro: 0, verse: 0.4, break: 0.3, build: 0.7, drop: 0.9, outro: 0, silence: 0, final_drop: 0.9 },
              texture: { wide: 0.8 },
              presence: { "vocals:in": 0.5 } },
  // breathe
  affinity: { form: { intro: 0.85, verse: 0.2, break: 0.5, build: 0, drop: 0, outro: 0.85, silence: 0.55, final_drop: 0 },
              doing: { establishing: 0.9, suspending: 0.9, thinning: 0.9, closing: 0.9, easing: 0.8, peaking: 0.1, intensifying: 0.2, _default: 0.5 },
              presence: { "drums:out": 0.9, "drums:in": 0.4 },
              texture: { sparse: 0.8, busy: 0.2 } },
  // build_ramp
  affinity: { form: { intro: 0, verse: 0, break: 0.2, build: 0.9, drop: 0.3, outro: 0, silence: 0, final_drop: 0.3 },
              doing: { intensifying: 1, expanding: 0.8, peaking: 0.7, easing: 0.2, thinning: 0.1, _default: 0.4 } },
  // drop_combo_A
  affinity: { form: { intro: 0, verse: 0, break: 0, build: 0.3, drop: 0.95, outro: 0, silence: 0, final_drop: 1.0 },
              doing: { peaking: 1, expanding: 0.9, intensifying: 0.8, holding: 0.7, easing: 0.3, _default: 0.5 },
              presence: { "drums:in": 1, "drums:out": 0.1 },
              texture: { busy: 0.9 } },
  // laser_sweep
  affinity: { form: { intro: 0, verse: 0.2, break: 0.2, build: 0.6, drop: 0.9, outro: 0, silence: 0, final_drop: 0.95 } },
```

Update every reader of the flat form table inside `preflight.js`: in `enumerate` the base row currently reads `(s.affinity && s.affinity[ctx])` — it becomes `s.affinity.form[ctx]` (see Step 4). Search the file for `affinity[` to be sure nothing else reads the old shape.

- [ ] **Step 4: Rewrite the middle of `enumerate`** — replace from `const matrix = {};` through `return { sequences, matrix, report };` with:

```js
  const matrix = {}, fit = {};
  const affinity = {};
  for (const fam of FAMILIES) affinity[fam] = {};
  const store = (id, aff) => { for (const fam of Object.keys(aff)) affinity[fam][id] = { ...aff[fam] }; };
  const sequences = [];

  for (const s of keptBase) {
    const f = +(s.fit ? s.fit(g) : 0).toFixed(4);
    const row = {};
    for (const ctx of CONTEXTS) row[ctx] = gate(f * ((s.affinity.form && s.affinity.form[ctx]) || 0));
    matrix[s.id] = row; fit[s.id] = f; store(s.id, s.affinity);
    sequences.push({ id: s.id, kind: s.kind, boldness: s.boldness, source: "base",
      fit: f, occupies: s.kind === "combination" ? comboOccupies(s) : (s.occupies || []),
      ...(s.parts ? { parts: s.parts.map(p => p.seq) } : {}) });
  }

  let rejected = 0, dup = 0;
  for (const seq of (options.palette || [])) {
    if (matrix[seq && seq.id]) { dup++; continue; }
    const v = validateSequence(seq, layout);
    if (!v.ok) { rejected++; continue; }
    const aff = affinityOf(seq);
    const row = {};
    for (const ctx of CONTEXTS) row[ctx] = gate(aff.form[ctx]);
    const f = +Math.max(...CONTEXTS.map(c => aff.form[c])).toFixed(4);
    matrix[seq.id] = row; fit[seq.id] = f; store(seq.id, aff);
    sequences.push({ id: seq.id, kind: seq.kind, boldness: seq.boldness, source: "llm",
      fit: f, occupies: seq.occupies || [],
      ...(Array.isArray(seq.parts) ? { parts: seq.parts.map(p => p && p.seq).filter(Boolean) } : {}) });
  }

  const impossible = VOCABULARY.filter(s => !keptBase.includes(s)).map(s => s.id);
  const weak = sequences.filter(s => CONTEXTS.every(c => matrix[s.id][c] === 0)).map(s => s.id);
  const strongest = {};
  for (const ctx of CONTEXTS) {
    strongest[ctx] = sequences.map(s => ({ id: s.id, score: matrix[s.id][ctx] }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  /* per fact, the sequences that most want it (their affinity, weighted by fit for
     base sequences) -- so taste stays inspectable per family */
  const strongest_by_fact = {};
  for (const fam of FAMILIES) {
    if (fam === "form") continue;
    strongest_by_fact[fam] = {};
    for (const fact of FACTS[fam]) {
      strongest_by_fact[fam][fact] = sequences
        .map(s => ({ id: s.id, score: affinity[fam][s.id] && affinity[fam][s.id][fact] != null
          ? +((s.source === "base" ? fit[s.id] : 1) * affinity[fam][s.id][fact]).toFixed(4) : 0 }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    }
  }
  const report = { rig: layout.rig || null, can_do: sequences.map(s => s.id),
    impossible, weak, strongest, strongest_by_fact,
    sources: { base: keptBase.length, llm: sequences.length - keptBase.length },
    rejected, dup };

  return { sequences, fit, affinity, matrix, report };
```

Note the base fit is now rounded to four decimals **before** the row is computed, so Task 4's on-the-fly cell equals the stored row exactly.

- [ ] **Step 5: Print the per-fact ranking in the CLI report** — in the `require.main === module` block of `preflight.js`, after the `STRONGEST BY CONTEXT` loop, add:

```js
  console.log("STRONGEST BY FACT:");
  for (const fam of Object.keys(r.strongest_by_fact || {})) {
    const line = Object.keys(r.strongest_by_fact[fam])
      .filter(f => r.strongest_by_fact[fam][f].length)
      .map(f => f + ": " + r.strongest_by_fact[fam][f].slice(0, 2).map(x => x.id).join("/"))
      .join("   ");
    if (line) console.log("  " + fam.padEnd(9) + line);
  }
```

- [ ] **Step 6: Run to verify it passes**

Run: `node readers/lights/preflight.test.js`
Expected: all checks pass (9 new). Also run `node readers/lights/arranger.test.js` — it must still pass (the arranger still passes strings to `candidates`, which Task 4 keeps working). `node readers/lights/preflight.js` prints a STRONGEST BY FACT block with a `doing` line naming `pair_call_response` under peaking.

- [ ] **Step 7: Commit (when the hold lifts)**

```bash
git add readers/lights/preflight.js readers/lights/preflight.test.js
git commit -m "preflight: enumerate per-family affinity; base vocabulary gains doing/presence/texture anchors"
```

---

### Task 4: `view().candidates(vector)` scores vectors

**Files:**
- Modify: `readers/lights/preflight.js` (function `view`)
- Test: `readers/lights/preflight.test.js`

**Interfaces:**
- Consumes: `cellFor`, `toVector`, `FAMILIES` (Task 1); the result shape of Task 3.
- Produces: `view(result).candidates(ctx: string | vector) -> [{ id, score, boldness }]` sorted by score desc; `view(result).facts === FACTS`. A result without `affinity` (an older cache) scores form only from `matrix`.

- [ ] **Step 1: Write the failing tests** (append before the summary loop)

```js
/* ---- view: candidates take a vector; a form string is a form-only vector --------- */
{
  const veto = { id: "x_veto", kind: "individual", boldness: "accent",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] }, occupies: ["pars:colour", "pars:level"],
    gesture: { group: "all_pars", keys: [{ at: 0, intent: { colour: [1, 0, 0] } }] },
    affinity: { form: { intro: 0, verse: 0.5, break: 0.5, build: 0.6, drop: 0.8, outro: 0, silence: 0, final_drop: 0.8 },
                doing: { peaking: 0, easing: 0.9 }, presence: { "drums:in": 0.9, "bass:in": 0.6 } } };
  const e = enumerate(RIG, { palette: [veto] });
  const v = view(e);
  ok("view exposes the fact vocabulary", v.facts && v.facts.doing.includes("peaking"));
  ok("a form-only vector gives exactly the form string's candidates",
     JSON.stringify(v.candidates({ form: "drop" })) === JSON.stringify(v.candidates("drop")));
  ok("a form-only vector's scores equal the stored form table",
     v.candidates("drop").every(c => c.score === e.matrix[c.id].drop));
  const ids = ctx => v.candidates(ctx).map(c => c.id);
  ok("a vetoed fact removes the sequence", ids("drop").includes("x_veto") && !ids({ form: "drop", doing: "peaking" }).includes("x_veto"));
  const easing = v.candidates({ form: "drop", doing: "easing" }).find(c => c.id === "x_veto");
  ok("a matched fact joins the geometric mean", easing && Math.abs(easing.score - Math.sqrt(0.8 * 0.9)) < 1e-3, easing && String(easing.score));
  const neutral = v.candidates({ form: "drop", texture: ["busy"] }).find(c => c.id === "x_veto");
  ok("an unmentioned family leaves the score alone", neutral && neutral.score === 0.8, neutral && String(neutral.score));
  ok("the order of facts in a family does not matter",
     JSON.stringify(v.candidates({ form: "drop", presence: ["drums:in", "bass:in"] })) === JSON.stringify(v.candidates({ form: "drop", presence: ["bass:in", "drums:in"] })));
  ok("candidates stay sorted by score", v.candidates({ form: "drop", doing: "easing" }).every((c, i, a) => i === 0 || a[i - 1].score >= c.score));
  ok("a base sequence's cell still carries its fit", v.candidates({ form: "drop", doing: "peaking" }).find(c => c.id === "pair_call_response").score <= e.fit.pair_call_response);
  /* an older cache: sequences + matrix, no affinity -> form only, richer facts ignored */
  const old = view({ sequences: e.sequences, matrix: e.matrix });
  ok("an old cache without affinity scores form only", JSON.stringify(old.candidates({ form: "drop", doing: "peaking" })) === JSON.stringify(old.candidates("drop")));
  ok("the cached result scores identically after a JSON round trip",
     JSON.stringify(view(JSON.parse(JSON.stringify(e))).candidates({ form: "drop", doing: "easing", presence: ["drums:in"] })) === JSON.stringify(v.candidates({ form: "drop", doing: "easing", presence: ["drums:in"] })));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/preflight.test.js 2>&1 | grep -v "^  pass"`
Expected: FAILs on "view exposes the fact vocabulary", "a vetoed fact removes the sequence", "a matched fact joins…", "the order of facts…" (an object passed to today's `candidates` is coerced to `"[object Object]"` and yields no candidates).

- [ ] **Step 3: Rewrite `view`**

```js
/* The arranger's read-only view over a (possibly cached) enumeration result. A
   context may be a form name or a fact VECTOR (facts.js); the cell is computed on
   the fly from the per-family affinity (fit x geomean; a 0 vetoes). A cache that
   predates affinity scores form only from its matrix. */
function view(result) {
  const M = result.matrix || {}, A = result.affinity || null, F = result.fit || {};
  const sequences = result.sequences || [];
  const byId = Object.fromEntries(sequences.map(s => [s.id, s]));
  const gate = v => (v >= FIT_FLOOR ? +v.toFixed(4) : 0);
  const affOf = id => {
    if (!A) return null;
    const out = {};
    for (const fam of FAMILIES) if (A[fam] && A[fam][id]) out[fam] = A[fam][id];
    return out.form ? out : null;
  };
  const fitK = s => (s.source === "llm" ? 1 : (F[s.id] != null ? F[s.id] : (s.fit != null ? s.fit : 1)));
  const score = (s, ctx) => {
    const v = toVector(ctx);
    const aff = affOf(s.id);
    if (!aff) return (M[s.id] || {})[v.form] || 0;       /* an older cache: form only */
    return gate(cellFor(aff, fitK(s), v));
  };
  return {
    candidates: ctx => sequences
      .map(s => ({ id: s.id, score: score(s, ctx), boldness: s.boldness }))
      .filter(c => c.score > 0).sort((a, b) => b.score - a.score),
    budget: ctx => BUDGETS[toVector(ctx).form] || DEFAULT_BUDGET,
    seq: id => byId[id] || null,
    facts: FACTS,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node readers/lights/preflight.test.js`
Expected: all checks pass (11 new). Then `node readers/lights/arranger.test.js` still passes unchanged (strings still work).

- [ ] **Step 5: Commit (when the hold lifts)**

```bash
git add readers/lights/preflight.js readers/lights/preflight.test.js
git commit -m "preflight: candidates() scores a context vector; old caches keep form-only"
```

---

### Task 5: regenerate the cache and prove nothing moved

**Files:**
- Regenerate: `readers/lights/arc4-head.matrix.json`

- [ ] **Step 1: Snapshot the old form table**

Run: `python3 -c "import json;d=json.load(open('readers/lights/arc4-head.matrix.json'));json.dump(d['matrix'],open('/tmp/matrix.form.before.json','w'),sort_keys=True)"`

- [ ] **Step 2: Regenerate**

Run: `node readers/lights/preflight.js readers/lights/arc4-head.layout.json`
Expected: the report prints STRONGEST BY CONTEXT as before and the file is rewritten.

- [ ] **Step 3: Verify the form table is unchanged and the new blocks exist**

Run:
```bash
python3 -c "import json;d=json.load(open('readers/lights/arc4-head.matrix.json'));json.dump(d['matrix'],open('/tmp/matrix.form.after.json','w'),sort_keys=True);print('affinity families:',sorted(d['affinity']),'| fit entries:',len(d['fit']),'| strongest_by_fact families:',sorted(d['report']['strongest_by_fact']))"
diff /tmp/matrix.form.before.json /tmp/matrix.form.after.json && echo "form table unchanged"
```
Expected: `form table unchanged`; affinity families `['doing','form','harmony','moment','presence','texture']`; fit entries 105.

- [ ] **Step 4: Run the whole suite**

Run: the Global Constraints suite line.
Expected: all green (the arranger still passes form strings; picks are unchanged).

- [ ] **Step 5: Commit (when the hold lifts)**

```bash
git add readers/lights/arc4-head.matrix.json
git commit -m "lights: re-enumerate the cache with per-family affinity (form table unchanged)"
```

---

### Task 6: the arranger builds one vector per bar (`plan.facts`)

**Files:**
- Modify: `readers/lights/arranger.js` (`lanesBlock`; new `factsBlock`; `plan()` after `const harmony = harmonyBlock(score);`; the `out` object)
- Test: `readers/lights/arranger.test.js`

**Interfaces:**
- Consumes: `Mu.subsectionsOf`, `Mu.momentsOf`, `Mu.perBar`, `Mu.lanesOf`, `Mu.stemLanesOf` (musical.js); `lanesBlock(score)` (now also `bass`); `harmonyBlock(score)`; `contextsFor`.
- Produces: `factsBlock(score, sections, contexts, lanes, harmony, subs, moments, bpb) -> { from_bar: number, vectors: (Vector|null)[] }` with one entry per bar from `from_bar` to the last section's end; `plan.facts` set to it when the score has sections. Each vector is `{ form, doing, presence?: string[], moment?: string[], texture?: string[], harmony?: string[] }`; `presence`, `texture`, `harmony` are present only when the score has the lanes/chords; `doing` is always present (`"holding"` when no subsection says otherwise); `moment` only on bars where a moment lands.

- [ ] **Step 1: Write the failing tests** (append before the summary loop in `arranger.test.js`; `MINI`, `SCORE`, `EN`, `format` and the levels loader are already in scope from earlier blocks)

```js
/* ---- facts: one context vector per bar, from the score alone ------------------ */
{
  const p = plan(MINI, EN, 42);
  const F = p.facts;
  ok("the plan carries facts anchored at the first bar", F && F.from_bar === 0 && Array.isArray(F.vectors) && F.vectors.length === 20, F && `${F.from_bar} x ${F.vectors.length}`);
  const v4 = F.vectors[4], v9 = F.vectors[9], v0 = F.vectors[0];
  ok("form comes from the section's context", v0.form === "intro" && v4.form === "drop" && F.vectors[16].form === "outro");
  ok("doing comes from the subsection covering the bar", v4.doing === "expanding" && F.vectors[8].doing === "easing" && F.vectors[12].doing === "peaking");
  ok("presence reads the stem lanes against the 0.3 threshold",
     v4.presence.includes("drums:in") && v4.presence.includes("bass:in") && v4.presence.includes("vocals:out") && v9.presence.includes("drums:out"), JSON.stringify(v9.presence));
  ok("texture bands read the normalised lanes (drop bars are narrow, busy, bright)",
     ["narrow", "busy", "bright"].every(t => v4.texture.includes(t)), JSON.stringify(v4.texture));
  ok("harmony reads minor/major and marks a change (Am->Am at bar 1 does not change; Am->C at bar 5 does)",
     v4.harmony.includes("minor") && F.vectors[5].harmony.includes("major") && F.vectors[5].harmony.includes("changing") && !F.vectors[1].harmony.includes("changing"), JSON.stringify([F.vectors[1].harmony, F.vectors[5].harmony]));
  ok("a moment lands on its bar with its weight band", v4.moment && v4.moment.includes("entrance") && v4.moment.includes("heavy") && F.vectors[8].moment.includes("pause") && F.vectors[8].moment.includes("firm"), JSON.stringify([v4.moment, F.vectors[8].moment]));
  ok("bars with no moment carry no moment family", F.vectors[1].moment === undefined);
  ok("a null lane bar says nothing in that band", !F.vectors[19].texture.some(t => t === "dull" || t === "bright"));
  /* a bare score: form only, so picks cannot move */
  const bare = plan(SCORE, EN, 42);
  ok("a score without the richer fields gives form-and-holding vectors only",
     bare.facts.vectors.every(v => v === null || (v.form && v.doing === "holding" && v.presence === undefined && v.texture === undefined && v.harmony === undefined && v.moment === undefined)));
  ok("facts are identical for the raw score and its format_v1 view",
     JSON.stringify(plan(format(require("./fixtures/mini_raw.js").RAW()), EN, 42).facts) === JSON.stringify(F));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/arranger.test.js 2>&1 | grep -v "^  pass"`
Expected: FAIL "the plan carries facts anchored at the first bar" then a TypeError reading `.form` of undefined (no `facts` yet). That crash is the missing feature.

- [ ] **Step 3: Add `bass` to `lanesBlock`** — in `lanesBlock`, after `if (lanes.vocals) out.vocals = lanes.vocals.map(c01);` add:

```js
    if (lanes.bass) out.bass = lanes.bass.map(c01);
```

- [ ] **Step 4: Add `factsBlock`** after `harmonyBlock`:

```js
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
    v.doing = (sub && sub.doing) ? sub.doing : "holding";
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
      const kinds = [...new Set(here.map(m => m.kind))];
      const w = Math.max(...here.map(m => (typeof m.weight === "number" ? m.weight : 0.5)));
      v.moment = [...kinds, weightBand(w)];
    }
    vectors.push(v);
  }
  return { from_bar, vectors };
}
```

- [ ] **Step 5: Build it in `plan()`** — after `const keyHue = harmony && harmony.key ? harmony.key.hue : null;` add:

```js
  const facts = factsBlock(score, sections, contexts, lanes, harmony, subs, moments, bpb);
```

and change the plan's return so `facts` travels with it: replace

```js
  const out = { seed: (seed || 0) >>> 0, grid: score.grid, contexts, assignments };
  if (lanes) out.lanes = lanes;
```

with

```js
  const out = { seed: (seed || 0) >>> 0, grid: score.grid, contexts, assignments };
  if (facts) out.facts = facts;
  if (lanes) out.lanes = lanes;
```

Also export it: `module.exports = { plan, contextsFor, sectionEnergyMean, energyReader, clashes, carve, factsBlock };`

- [ ] **Step 6: Run to verify it passes**

Run: `node readers/lights/arranger.test.js`
Expected: all checks pass (11 new). Check the MINI numbers if a band assertion fails: width lane `[0.8×4, 0.3×12, 0.6×4]` normalises 0.3 → 0 (narrow); pace `1.5` → 1 (busy); brightness `0.95` → 1 (bright); bar 19's brightness is `null` so no dull/bright band.

- [ ] **Step 7: Commit (when the hold lifts)**

```bash
git add readers/lights/arranger.js readers/lights/arranger.test.js
git commit -m "arranger: one context vector per bar (plan.facts) from the score's facts"
```

---

### Task 7: picks are made with vectors; CALMER/BOLDER retired; picks explained

**Files:**
- Modify: `readers/lights/arranger.js` (`plan()`: `pickFor`, the section loop, the variation block, assignment fields; the CLI printer; delete `CALMER` and `BOLDER`)
- Test: `readers/lights/arranger.test.js`

**Interfaces:**
- Consumes: `plan.facts.vectors` (Task 6); `V.candidates(vector)` (Task 4).
- Produces: a new pure helper `majorityVector(vectors, i0, i1, form, doing) -> Vector` (exported); `pickFor(vector, grp, exclude)`; par pieces, variations and head assignments carry `facts: Vector` (variations no longer carry `vcontext`).

- [ ] **Step 1: Write the failing tests** (append before the summary loop)

```js
/* ---- picks are made with vectors and say so ---------------------------------- */
{
  const { majorityVector } = require("./arranger.js");
  const vs = [
    { form: "drop", doing: "expanding", presence: ["drums:in", "bass:in"], texture: ["busy"], harmony: ["minor"] },
    { form: "drop", doing: "expanding", presence: ["drums:in", "bass:out"], texture: ["busy", "narrow"], harmony: ["major", "changing"] },
    { form: "drop", doing: "easing", presence: ["drums:out", "bass:out"], texture: ["sparse"], harmony: ["minor"] },
  ];
  const m = majorityVector(vs, 0, 3, "drop");
  ok("the majority doing wins", m.doing === "expanding", m.doing);
  ok("presence is decided per stem by majority", m.presence.includes("drums:in") && m.presence.includes("bass:out") && m.presence.length === 2, JSON.stringify(m.presence));
  ok("a texture band needs more than half the bars", m.texture.includes("busy") && !m.texture.includes("narrow") && !m.texture.includes("sparse"), JSON.stringify(m.texture));
  ok("harmony keeps the majority mode and never 'changing'", JSON.stringify(m.harmony) === JSON.stringify(["minor"]));
  ok("a doing override is honoured (a subsection's own word)", majorityVector(vs, 0, 3, "drop", "peaking").doing === "peaking");
  ok("a moment never belongs to a span vector", m.moment === undefined);

  const p = plan(MINI, EN, 42);
  const base = p.assignments.find(a => a.layer === "par" && a.seq_id && a.from.bar === 4 && !a.variation);
  ok("a base look carries the vector it was chosen with", base && base.facts && base.facts.form === "drop" && base.facts.doing && Array.isArray(base.facts.presence), JSON.stringify(base && base.facts));
  const vari = p.assignments.find(a => a.layer === "par" && a.variation && a.from.bar === 8);
  ok("a variation carries its own subsection's vector", vari && vari.facts.doing === "easing" && vari.facts.form === "drop", JSON.stringify(vari && vari.facts));
  ok("variations no longer step a context (no vcontext)", p.assignments.every(a => a.vcontext === undefined));
  const head = p.assignments.find(a => a.layer === "head" && a.from.bar === 4);
  ok("the head look carries the section vector too", head && head.facts && head.facts.form === "drop");
  ok("a plain score's looks carry form-and-holding vectors", plan(SCORE, EN, 42).assignments.filter(a => a.seq_id).every(a => a.facts && a.facts.form && a.facts.doing === "holding"));
  ok("no clashes with vector picks", clashes(p) === 0, `${clashes(p)}`);
  ok("the rich plan is still deterministic", JSON.stringify(plan(MINI, EN, 42)) === JSON.stringify(p));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/arranger.test.js 2>&1 | grep -v "^  pass"`
Expected: a TypeError that `majorityVector` is not a function (the missing export), then, once exported, FAILs on the `facts` fields.

- [ ] **Step 3: Add `majorityVector`** after `factsBlock`:

```js
/* the vector a SPAN of bars agrees on: form as given; doing by majority (or the
   caller's word, a subsection's own); each stem's presence by majority; a texture
   band only when more than half the bars carry it; harmony's mode by majority and
   never "changing" (that is a bar fact). Moments never belong to a span. */
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
  else { const c = count(x => (x.doing ? [x.doing] : [])); v.doing = span.length ? top(c) : "holding"; }
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
    const c = count(x => x.harmony.filter(f => f !== "changing"));
    v.harmony = (c.minor || 0) >= (c.major || 0) && (c.minor || c.major) ? ["minor"] : (c.major ? ["major"] : []);
  }
  return v;
}
```

- [ ] **Step 4: Use vectors in `plan()`**

Delete the `CALMER` and `BOLDER` constants (keep `LIFT`, `EASE`, `classify`: they still shape the variation's dynamics).

Change `pickFor`'s first parameter name to `vector` (its body already passes the value to `V.candidates`, which now accepts a vector):

```js
  const pickFor = (vector, grp, exclude) => {
    const all = V.candidates(vector);
```

At the top of the section loop, after `const secFrom = atBeat(sec.from), secTo = atBeat(sec.to);`, add the section's vector (the bar index helper needs `facts`):

```js
    const idx = bar => (facts ? bar - facts.from_bar : -1);
    const vectors = facts ? facts.vectors : [];
    const sectionVector = facts ? majorityVector(vectors, idx(sec.from.bar), idx(sec.to.bar), context) : { form: context, doing: "holding" };
```

Replace `const par = pickFor(context, "par");` with `const par = pickFor(sectionVector, "par");`.

In the variation block replace

```js
      const wantsOwn = par && !isFirst && inside.length > 1 && (cls !== "hold" || su.has_break);
      if (wantsOwn) {
        const vctx = cls === "ease" ? CALMER[context] : cls === "lift" ? BOLDER[context] : context;
        let pick = pickFor(vctx, "par", [par.id, lastVar]);
        if (!pick && vctx !== context) pick = pickFor(context, "par", [par.id, lastVar]);
```

with

```js
      const wantsOwn = par && !isFirst && inside.length > 1 && ((su.doing && su.doing !== "holding") || su.has_break);
      if (wantsOwn) {
        /* the subsection's own vector: its word for doing, the facts its bars agree on */
        const subVector = facts
          ? majorityVector(vectors, idx(barOf(su.f)), idx(barOf(su.t)), context, su.doing || "holding")
          : { form: context, doing: su.doing || "holding" };
        let pick = pickFor(subVector, "par", [par.id, lastVar]);
        if (!pick) pick = pickFor(sectionVector, "par", [par.id, lastVar]);
```

and in the pushed variation replace `context, vcontext: vctx,` with `context, facts: subVector,`.

In the base pieces push add `facts: sectionVector,` after `params: parParams,`.

Replace `const head = pickFor(context, "head");` with `const head = pickFor(sectionVector, "head");` and add `facts: sectionVector,` to the head assignment after its `params`.

Export the helper: add `majorityVector` to `module.exports`.

- [ ] **Step 5: Print the vector in the CLI** — in the `require.main === module` block, replace the `console.log("  " + (pos(a.from) ...` statement with:

```js
  const vec = f => f ? "[" + [f.form, f.doing, (f.presence || []).join("+"), (f.texture || []).join("+"), (f.harmony || []).join("+")].filter(Boolean).join("|") + "]" : "";
  for (const a of p.assignments)
    console.log("  " + (pos(a.from) + "-" + pos(a.to)).padEnd(11) +
      "  " + String(a.section || "").padEnd(11) + " " + a.layer.padEnd(9) + " -> " + String(a.seq_id || a.type).padEnd(28) +
      (a.variation ? " [var " + a.doing + "]" : a.moment ? " [" + a.moment + (a.what ? ": " + a.what : "") + "]" : "") +
      " " + vec(a.facts));
```

- [ ] **Step 6: Run to verify it passes**

Run: `node readers/lights/arranger.test.js`
Expected: all checks pass (13 new). Two earlier checks may now fail and need a look, not a blind edit: "a 12-bar drop with three subsections carries more than one PAR look" and "an easing subsection with a break gets its own look at its exact bars" depend on the base vocabulary offering a distinct look for the easing vector on the bare `RIG` (`EN`); with Task 3's anchors `travelling_pulse` (easing 0.7) and `breathe` (easing 0.8, but form drop 0 → vetoed) are the pool, so a distinct pick exists. If the pick collapses, the fix is an anchor value in Task 3, never a hard-coded id.

Then: `node readers/lights/arranger.js readers/lights/panel/scores/levels.score 3 | head -40` — every par and head line ends with a `[form|doing|presence|texture|harmony]` vector.

- [ ] **Step 7: Commit (when the hold lifts)**

```bash
git add readers/lights/arranger.js readers/lights/arranger.test.js
git commit -m "arranger: base looks and variations are drawn with fact vectors; CALMER/BOLDER retired"
```

---

### Task 8: the timeline carries the facts; parity holds

**Files:**
- Modify: `readers/lights/bake.js` (the two `writeFileSync` payloads)
- Test: `readers/lights/bake.test.js`

**Interfaces:**
- Consumes: `p.facts` (Task 6).
- Produces: `.lights.json` and `.frames.json` carry `facts: { from_bar, vectors }` unchanged from the plan.

- [ ] **Step 1: Write the failing test** (in `bake.test.js`, before `fs.rmSync(tmp, …)`; `baked` is the frames.json of `SCORE`, whose sections are intro bars 0–9 and drop bars 9–17 and which carries an entrance moment at bar 9)

```js
/* the timeline carries the per-bar facts the picks were made with */
{
  const F = baked.facts;
  ok("the baked timeline carries facts anchored like the plan", F && F.from_bar === 0 && F.vectors.length === 17, F && `${F.from_bar} x ${F.vectors.length}`);
  /* the fixture's only high-energy section is also its last, so its context is final_drop */
  ok("a bar in the drop says so", F.vectors[9].form === "final_drop" && F.vectors[9].moment.includes("entrance") && F.vectors[9].moment.includes("heavy"), JSON.stringify(F.vectors[9]));
  ok("the raw hub score bakes the same facts", JSON.stringify(rawBaked.facts) === JSON.stringify(F));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node readers/lights/bake.test.js 2>&1 | grep -v "^  pass"`
Expected: FAIL "the baked timeline carries facts…" then a TypeError on `F.vectors` (absent).

- [ ] **Step 3: Export it** — in `bake.js` add `facts: p.facts || null,` to both payloads: in the `--lights` block after `moments, looks,` and in the frames payload after `moments, looks,`.

- [ ] **Step 4: Run to verify it passes, then the whole suite and parity**

Run: `node readers/lights/bake.test.js` → all checks pass (3 new); then the Global Constraints suite line, including `python3 readers/lights/panel/protocol_bake.test.py` → `9 passed, 0 failed`.

- [ ] **Step 5: Bake levels and read the picks**

Run: `node readers/lights/bake.js readers/lights/panel/scores/levels.score 3 --lights /tmp/out.json && node readers/lights/arranger.js readers/lights/panel/scores/levels.score 3 | grep -c "\[drop\|\[final_drop\|\[intro\|\[build\|\[silence\|\[outro"`
Expected: the bake succeeds and every look line carries a vector (the count equals the number of par and head assignments).

- [ ] **Step 6: Commit (when the hold lifts)**

```bash
git add readers/lights/bake.js readers/lights/bake.test.js
git commit -m "bake: the timeline carries the per-bar facts"
```

---

## Acceptance for phase A (from the spec)

- Every base look and variation on levels is explained by its vector in the CLI (`node readers/lights/arranger.js readers/lights/panel/scores/levels.score 3`).
- `python3 readers/lights/panel/protocol_bake.test.py` green; every JS suite green; `clashes(plan)` is 0 on levels.
- A form-only vector gives exactly the form string's candidates, so scores without the richer fields plan as today.
