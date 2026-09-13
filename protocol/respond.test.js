/* The request contract, checked. Sebastian writes the real responder; these are
   the things it has to keep true whoever writes it. */
"use strict";
const { respond } = require("./respond.js");
const fs_ = require("fs"), path_ = require("path");
function scoreFile() {
  const built = path_.join(__dirname, "..", "scores", "levels.score");
  return built;
}
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

{
  const r = respond({ score: "levels", fields: ["downbeats"] });
  ok("grid comes back even when nobody asked for it", !!r.grid);
  ok("a field nobody asked for is not sent", !r.beats && !r.energy && !r.sections,
     Object.keys(r).join(", "));
  ok("the response says which version it gave", r.version !== undefined, "v" + r.version);
}
{
  const r = respond({ score: "levels", fields: ["downbeats", "tempo_curve"] });
  ok("an unknown field is reported rather than ignored silently",
     r.ignored && r.ignored.fields.includes("tempo_curve"),
     JSON.stringify(r.ignored && r.ignored.fields));
}
{
  const r = respond({ score: "levels", fields: ["beats", "downbeats", "energy"],
                      window: { from_bar: 33, bars: 8 } });
  ok("a window clips the beats", r.beats.count === 32, r.beats.count + " beats");
  ok("and the downbeats", r.downbeats.count === 8, r.downbeats.count + " downbeats");
  ok("a window does not renumber -- bar 33 is still bar 33",
     r.beats.list[0][0] === 33, JSON.stringify(r.beats.list[0]));
  ok("energy is clipped and says where it now starts",
     r.energy.from_bar === 33 && r.energy.values.length === 8,
     `from ${r.energy.from_bar}, ${r.energy.values.length} values`);
}
{
  /* 36 sits inside the drop that starts at 33, so a section really does begin
     before the window. Asking from 33 tested nothing: it is a section start. */
  const r = respond({ score: "levels", fields: ["sections"],
                      window: { from_bar: 36, bars: 8 } });
  const names = r.sections.map(s => `${s.name} ${s.from.bar}-${s.to.bar}`);
  ok("a section that starts before the window still comes back",
     r.sections.some(s => s.from.bar < 36), names.join(", "));
  ok("because a consumer asking for 8 bars needs to know it is inside a longer drop",
     r.sections.some(s => s.to.bar > 44));
}
{
  const r = respond({ score: "levels", version: 99, fields: ["grid"] });
  ok("asking for a version that does not exist is an error, not a silent swap",
     !!r.error, r.error);
}
{
  const r = respond({ score: "nope" });
  ok("an unknown score says what there is", !!r.error && Array.isArray(r.have),
     (r.have || []).join(", "));
}

{
  /* a score pulled with --profile carries one; the response must carry it too,
     asked for or not. A temporary score file beside the others, removed after. */
  const fs = require("fs"), path = require("path");
  const tmp = path.join(__dirname, "withprofile.score");
  const base = JSON.parse(fs_.readFileSync(scoreFile(), "utf8"));
  const profile = { user: "muzammil", colours: [{ name: "red", hex: "#ff0000" }] };
  fs.writeFileSync(tmp, JSON.stringify({ ...base, score: "withprofile", profile }));
  try {
    const r = respond({ score: "withprofile", fields: ["grid"] });
    ok("a score with a profile answers with it, asked for or not",
       r.profile && r.profile.user === "muzammil" && r.profile.colours[0].hex === "#ff0000", JSON.stringify(r.profile));
    const plain = respond({ score: "levels", fields: ["grid"] });
    ok("a score without one answers without", !("profile" in plain));
  } finally {
    fs.unlinkSync(tmp);
  }
}

for (const [p, n, d] of out) console.log(`  ${p ? "pass" : "FAIL"}  ${n}${d ? "   " + d : ""}`);
const bad = out.filter(r => !r[0]).length;

/* Everything the pipeline learns has to reach a reader, and four fields added
   in one sitting did not: ticks, melody_phrases, and repeats_as and trades on
   a section. They were computed, written to the score, drawn on the page, and
   dropped by the formatter -- the quietest way there is for work to be lost. */
{
  const fs2 = require("fs"), path2 = require("path");
  const said = respond({ score: "levels", want: "v1" });
  const doc = said && (said.score || said.body || said);
  const want = ["ticks", "melody_phrases", "chord_changes"];
  const gone = want.filter(k => doc[k] == null);
  ok("the fast lane and the tune's lines reach a reader", gone.length === 0,
     gone.length ? `dropped: ${gone.join(", ")}` : want.join(", "));
  const first = (doc.sections || [])[0] || {};
  ok("a section says which section it is a repeat of", "repeats_as" in first,
     `section carries: ${Object.keys(first).join(" ")}`);
  const traded = (doc.sections || []).filter(x => x.trades).length;
  ok("a section that trades back and forth says so", traded > 0,
     `${traded} of ${(doc.sections || []).length} sections trade`);
}

console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
