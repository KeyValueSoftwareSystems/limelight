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

/* Scores are built, not committed, so look wherever they actually land: the hub's
   store first, then the one fixture that stays in the repo. Finding none is
   reported as exactly that -- not as a pass. A check that quietly skips itself
   when its input is missing is a check that can never fail, which is the trap
   this project keeps catching itself in. */
const dirs = [path.join(__dirname, "..", "hub", "files"),
              path.join(__dirname, "..", "scores"),
              __dirname];
const files = [];
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).sort())
    if (f.endsWith(".score") && !files.some(x => path.basename(x) === f))
      files.push(path.join(d, f));
}
const out = [];
const ok = (n, c, d) => out.push([!!c, n, d || ""]);

if (!files.length) {
  console.log("NO SCORES FOUND -- nothing was checked.\n  looked in: " +
              dirs.join(", ") + "\n  build or pull scores, then run this again.");
  process.exit(2);
}
ok("there are scores to check", files.length > 0, files.length + " songs");

let bases = {};
for (const f of files) {
  const name = path.basename(f).slice(0, -6);
  const sc = JSON.parse(fs.readFileSync(f, "utf8"));
  const s = Session(sc, { now: () => 1 });
  const g = sc.grid;

  /* A score either states its bar base or predates the field and means 1. Both are
     legal; what is never legal is a stated base that is not a whole number, because
     then every bar in the song is half a bar from where it says it is. */
  const stated = g.first_bar !== undefined && g.first_bar !== null;
  ok(`${name}: bar base is usable`, !stated || Number.isInteger(g.first_bar),
     stated ? "first_bar " + g.first_bar : "not stated, so 1");
  bases[stated ? g.first_bar : 1] = (bases[stated ? g.first_bar : 1] || 0) + 1;

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

if (files.length > 1)
  ok("both bar bases are represented, so this actually tests the thing",
     Object.keys(bases).length > 1, JSON.stringify(bases));

const bad = out.filter(r => !r[0]);
for (const [p, n, d] of out) if (!p) console.log(`  FAIL  ${n}   ${d}`);
console.log(bad.length ? `\n${bad.length} of ${out.length} FAILED`
                       : `\nall ${out.length} checks pass across ${files.length} songs`);
process.exit(bad.length ? 1 : 0);
