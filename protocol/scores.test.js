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

/* Scores are built, not committed, so look wherever they actually land. The
   pipeline's own output comes first and everything else is a fallback: hub/files
   is a gitignored local store of whatever was last uploaded, and preferring it
   meant this suite validated old copies on a machine that had them and fresh
   ones on a machine that did not. Twenty-one of twenty-eight songs were checked
   in a shape three fields behind what the pipeline actually writes, and a score
   that JSON.parse cannot read sat in scores/ while this printed 28 songs pass.
   Finding none is reported as exactly that -- not as a pass. A check that
   quietly skips itself when its input is missing is a check that can never
   fail, which is the trap this project keeps catching itself in; a check that
   quietly reads a different, older input is the same trap wearing a hat. */
const dirs = [path.join(__dirname, "..", "scores"),
              path.join(__dirname, "..", "hub", "files"),
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

/* The same song sitting in two places in two shapes is how a reader ends up
   reading a score three fields behind the one the page shows. Said out loud
   rather than failed, because hub/files is a local store and being behind is
   not by itself a broken build. */
{
  const behind = [];
  for (const f of files) {
    const name = path.basename(f);
    for (const d of dirs) {
      const other = path.join(d, name);
      if (other === f || !fs.existsSync(other)) continue;
      let a, b;
      try { a = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
      try { b = JSON.parse(fs.readFileSync(other, "utf8")); } catch { continue; }
      const gap = Object.keys(a).filter(k => !(k in b));
      if (gap.length) behind.push(`${name.slice(0, -6)} in ${path.basename(d)} lacks ${gap.join(", ")}`);
    }
  }
  if (behind.length) {
    console.log(`  note  ${behind.length} stale copies are not what was checked:`);
    for (const line of behind.slice(0, 6)) console.log(`          ${line}`);
    if (behind.length > 6) console.log(`          ... and ${behind.length - 6} more`);
  }
}

let bases = {};
for (const f of files) {
  const name = path.basename(f).slice(0, -6);
  let sc;
  try {
    sc = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    /* NaN is what Python writes for a mean of nothing and is not JSON. One
       score in the library carried it and no reader written in JavaScript
       could open that song at all. One unreadable score must not stop the
       other twenty-seven from being checked. */
    ok(`${name}: the score file is valid JSON`, false, String(e.message).slice(0, 70));
    continue;
  }
  const s = Session(sc, { now: () => 1 });
  const g = sc.grid;

  /* A song whose vocal stem is present for a good part of its length has a
     voice line. This exists because a variable named sung held the vocal
     envelope and a later block reused the name for the lyrics, so every score
     rebuilt that night came out with voice.notes = 0. Nothing crashed and
     melody stayed non-empty, because the lead instrument still contributed
     notes -- only the singing was gone, and only this would have said so. */
  {
    const lane = ((sc.bars || {}).vocals || []).filter(x => x != null);
    const live = lane.filter(x => x > 0.12).length / Math.max(1, lane.length);
    if (lane.length && live > 0.3) {
      const notes = (sc.voice && sc.voice.notes) || 0;
      ok(`${name}: the voice is present for ${Math.round(live * 100)}% of bars, so it has a line`,
         notes > 0, `voice.notes ${notes}`);
    }
  }

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
