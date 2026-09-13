/* musical.js tests -- the shape-agnostic readers of a score's finer structure.
   Two score shapes reach the reader: the pipeline's raw file (parts, phrases,
   bars.*, moments with bar/beat) and the hub's format_v1 view (sections,
   layers.subsection, top-level lanes, curves, harmony). Every reader here must
   answer the same thing from either shape, or the show changes the day the
   data source does. Plain node idiom. */
"use strict";
const M = require("./musical.js");
const { format } = require("../../server/format/v1.js");   // the real formatter (Node 24 require(esm))

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const RAW = require("./fixtures/mini_raw.js").RAW();
const FMT = format(JSON.parse(JSON.stringify(RAW)));

/* ---- subsections: layers.subsection.spans == phrases ---------------------- */
{
  const a = M.subsectionsOf(RAW), b = M.subsectionsOf(FMT);
  ok("raw phrases become subsections", a.length === 5, `${a.length}`);
  ok("format_v1 layers.subsection reads identically", same(a, b));
  ok("a subsection has half-open bar/beat edges", a[1].from.bar === 4 && a[1].from.beat === 1 && a[1].to.bar === 8);
  ok("a subsection carries doing/energy/rise/has_break",
     a[2].doing === "easing" && a[2].energy === 0.8 && a[2].rise === -0.1 && a[2].has_break === true);
  ok("no phrases -> empty list", M.subsectionsOf({ grid: RAW.grid, sections: [] }).length === 0);
}

/* ---- moments: exact bar/beat, kind, weight, for_beats --------------------- */
{
  const a = M.momentsOf(RAW), b = M.momentsOf(FMT);
  ok("moments read from either shape identically", same(a, b) && a.length === 3);
  const ent = a.find(m => m.kind === "entrance");
  ok("an entrance keeps its exact bar/beat and weight", ent && ent.bar === 4 && ent.beat === 1 && ent.weight === 0.97);
  const pause = a.find(m => m.kind === "pause");
  ok("a pause keeps for_beats and what is still playing",
     pause && pause.bar === 8 && pause.beat === 3 && pause.for_beats === 4 && same(pause.still, ["bass"]));
  /* the session.js / events shape: at:{bar,beat}, kind, strength */
  const alt = M.momentsOf({ moments: [{ at: { bar: 3, beat: 2 }, kind: "drop", strength: 0.6 }] });
  ok("an {at, kind, strength} moment is read too", alt[0].bar === 3 && alt[0].beat === 2 && alt[0].kind === "drop" && alt[0].weight === 0.6);
  ok("no moments -> empty list", M.momentsOf({}).length === 0);
}

/* ---- texture lanes: per-bar, anchored, nulls kept -------------------------- */
{
  const a = M.lanesOf(RAW), b = M.lanesOf(FMT);
  ok("lanes read from either shape identically", same(a, b));
  ok("lanes are anchored at the grid's first bar", a.from_bar === 0, `${a.from_bar}`);
  ok("all five texture lanes are present", ["width", "air", "pump", "pace", "brightness"].every(k => Array.isArray(a[k]) && a[k].length === 20));
  ok("a null stays a null (a gap is not a zero)", a.brightness[19] === null);
  ok("no lanes -> null", M.lanesOf({ grid: RAW.grid }) === null);
}

/* ---- stem lanes ------------------------------------------------------------ */
{
  const a = M.stemLanesOf(RAW), b = M.stemLanesOf(FMT);
  ok("stem lanes read from either shape identically", same(a, b));
  ok("stem lanes carry drums/bass/vocals/other from the first bar",
     a.from_bar === 0 && a.lanes.drums[4] === 0.9 && a.lanes.drums[9] === 0.1 && a.lanes.vocals.length === 20);
}

/* ---- harmony: per-bar chords + key ------------------------------------------ */
{
  const a = M.harmonyOf(RAW), b = M.harmonyOf(FMT);
  ok("harmony reads from either shape identically", same(a, b));
  ok("harmony carries the per-bar chord names from the first bar", a.from_bar === 0 && a.chords[2] === "F" && a.chords[19] === null);
  ok("harmony carries the key", a.key.root === "A" && a.key.scale === "minor");
  ok("no chords -> null", M.harmonyOf({ key: { root: "C" } }) === null);
}

/* ---- chord -> hue: neighbours on the circle of fifths sit near each other ---- */
{
  const h = M.hueOfChord;
  ok("a chord name parses to a hue in 0..1", h("Am") >= 0 && h("Am") < 1 && h("C#m") >= 0 && h("Bb") >= 0);
  const d = (x, y) => Math.min(Math.abs(x - y), 1 - Math.abs(x - y));
  ok("C and G (a fifth apart) are hue-neighbours; C and F# are opposite",
     d(h("C"), h("G")) < 0.1 && d(h("C"), h("F#")) > 0.45, `${d(h("C"), h("G"))} ${d(h("C"), h("F#"))}`);
  ok("a minor chord is flagged minor", M.chordOf("Am").minor === true && M.chordOf("A").minor === false);
  ok("an unparseable chord gives null", h("N") === null && h(null) === null);
}

/* ---- per-song normalisation: p10..p90 -> 0..1, nulls kept ------------------- */
{
  const n = M.normalise([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null]);
  ok("the low tail clamps to 0 and the high tail to 1", n[0] === 0 && n[9] === 1);
  ok("the middle lands mid-range", n[4] > 0.3 && n[4] < 0.7, `${n[4]}`);
  ok("a null survives normalisation", n[10] === null);
  ok("a flat lane normalises to 0.5 everywhere (no false variation)", M.normalise([0.4, 0.4, 0.4]).every(v => v === 0.5));
}

/* ---- perBar: a reader over an anchored array -------------------------------- */
{
  const r = M.perBar(0, [10, 11, 12]);
  ok("perBar indexes from its anchor (bar 0 is values[0])", r(0) === 10 && r(2) === 12);
  ok("perBar holds the edges", r(-3) === 10 && r(9) === 12);
  ok("perBar of nothing reads null", M.perBar(0, null)(1) === null);
}


/* ---- tension: one value per beat, anchored at the first bar ---------------- */
{
  const a = M.tensionOf(RAW), b = M.tensionOf(FMT);
  ok("tension reads from either shape identically", JSON.stringify(a) === JSON.stringify(b));
  ok("tension is per beat from the first bar", a && a.from_bar === 0 && a.values.length === 80 && a.values[0] === 0.2);
  ok("no tension -> null", M.tensionOf({ grid: RAW.grid }) === null);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
