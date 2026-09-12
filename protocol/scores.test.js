/* Every score in the library, checked against the library that reads it.
   ---------------------------------------------------------------------------
   Written because of a bug that nothing would have caught: bar numbering starts
   at 0 on some songs and 1 on others, and this library used to assume 1 and
   shift anything that disagreed. That is a one-bar error on four songs out of
   seventeen, and a one-bar error is a show that lights a beat early all night
   and never explains itself.

   The lesson from how it was found matters as much as the fix. The function
   that chose the phrase origin scored boundaries against themselves, so it
   agreed with whatever they already did. A check that consults only the thing
   it is checking will always pass. So this file checks the library against the
   SCORE -- two different writers -- and never against its own output. */
"use strict";
const fs = require("fs"), path = require("path");
const { Session } = require("./session.js");

const dir = path.join(__dirname, "..", "scores");
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);
const files = fs.readdirSync(dir).filter(f => f.endsWith(".score")).sort();

ok("there are scores to check", files.length > 0, files.length + " songs");

let bases = {};
for (const f of files) {
  const name = f.slice(0, -6);
  const sc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const s = Session(sc, { now: () => 1 });
  const g = sc.grid;

  ok(`${name}: says where its bars start`,
     g.first_bar !== undefined && g.first_bar !== null, "first_bar " + g.first_bar);
  bases[g.first_bar] = (bases[g.first_bar] || 0) + 1;

  /* the round trip that the old code failed: a bar the SCORE names, turned into
     seconds and back, must come out as the same bar */
  const parts = sc.parts || [];
  let drift = 0, worst = null;
  for (const p of parts) {
    const back = s.positionAt(s.secondsAt(p.from_bar, 1));
    if (back.bar !== p.from_bar) { drift++; worst = `${p.role} ${p.from_bar} -> ${back.bar}`; }
  }
  ok(`${name}: every section lands on the bar the score names`, drift === 0,
     drift ? `${drift} of ${parts.length} shifted, e.g. ${worst}` : `${parts.length} sections`);

  /* the section a listener is in must be one the score actually lists */
  if (parts.length) {
    const mid = s.secondsAt(parts[Math.floor(parts.length / 2)].from_bar, 1);
    s.seek(mid);
    const fm = s.now().sections.form;
    ok(`${name}: reports a section that exists`,
       !!fm && parts.some(p => p.role === fm.name), fm ? fm.name : "none");
  }

  /* role is the bare word and nth carries the occurrence -- matching on a role
     string that had the number baked in used to miss every drop after the first */
  const numbered = parts.filter(p => /\s\d+$/.test(String(p.role)));
  ok(`${name}: role carries no occurrence number`, numbered.length === 0,
     numbered.map(p => p.role).join(", "));
}

ok("both bar bases are represented, so this actually tests the thing",
   Object.keys(bases).length > 1, JSON.stringify(bases));

const bad = out.filter(r => !r[0]);
for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
console.log(bad.length ? `\n${bad.length} of ${out.length} FAILED`
                       : `\nall ${out.length} checks pass across ${files.length} songs`);
process.exit(bad.length ? 1 : 0);
