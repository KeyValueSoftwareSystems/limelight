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
  ok("no form table, no cell -- however rich the vector",
     cellFor({ doing: { easing: 1 } }, 1, { form: "drop", doing: "easing" }) === 0,
     `${cellFor({ doing: { easing: 1 } }, 1, { form: "drop", doing: "easing" })}`);
  ok("cells are rounded to four decimals", String(cellFor(A, 1, { form: "drop", doing: "easing" })).replace("0.", "").length <= 4);
  ok("an out-of-vocabulary form is a veto, not a shrug",
     cellFor({ form: { drop: 0.8 }, doing: { peaking: 0.9 } }, 1, { form: "chorus" }) === 0);
  ok("_default does not apply to form", cellFor({ form: { drop: 0.8, _default: 0.5 } }, 1, "intro") === 0);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
