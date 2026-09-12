#!/usr/bin/env node
/* What the protocol actually hands you, for one song at one moment.
   ---------------------------------------------------------------------------
   Written to be handed to somebody who has to build against this and was not
   in the room when it was designed. Run it, read it, then write a consumer.

     node protocol/sample.js                 levels, at the second drop
     node protocol/sample.js levels 35       levels, at bar 35
     node protocol/sample.js levels 35 4000  ... with four seconds of lead
     node protocol/sample.js levels 35 4000 --json

   What this does NOT give you is a frame, a fixture, a channel or a byte. The
   protocol answers questions about music; deciding what a lamp does about the
   answer is the reader's job, and deciding which wire carries it is yours. */
"use strict";
const fs = require("fs"), path = require("path");
const { Session } = require("./session.js");

const a = process.argv.slice(2).filter(x => x !== "--json");
const asJson = process.argv.includes("--json");
const song = a[0] || "levels";
const lead = +(a[2] || 4000);

const score = JSON.parse(fs.readFileSync(
  path.join(__dirname, `score.${song}.json`), "utf8"));

let clock = 0;
const s = Session(score, { now: () => clock });

/* default to the second drop, because a song's most interesting instant is
   rarely bar one */
const drops = (score.moments || []).filter(m => m.kind === "drop");
const bar = a[1] ? +a[1] : (drops[1] ? drops[1].at.bar : 9);
s.seek(s.secondsAt(bar, 1));
s.play();

const now = s.now();
const coming = s.next(lead);

if (asJson) {
  console.log(JSON.stringify({ score: score.score, grid: score.grid,
                               now, coming }, null, 1));
  process.exit(0);
}

const pad = (x, n) => String(x).padEnd(n);
const rpad = (x, n) => String(x).padStart(n);

console.log(`
${score.song.title || score.score}   —   what the protocol gives you
${"=".repeat(72)}

THE SCORE IS THREE NUMBERS. Every beat is derived from these; none of them
change when somebody plays the record faster.

   bpm            ${score.grid.bpm}
   first beat     ${score.grid.first_beat_s} s   (the only second in the whole file)
   beats per bar  ${score.grid.beats_per_bar}

WHERE WE ARE — bar ${now.position.bar} beat ${Math.floor(now.position.beat)}, which is ${now.seconds.toFixed(3)} s into this recording.

   phase through this beat   ${now.phase.toFixed(3)}     (0 exactly on the beat)
   next beat in              ${now.to_next_beat_ms} ms      (your clock, at rate ${now.rate.toFixed(2)})
`);

console.log(`WHAT IS TRUE HERE — five layers at once, and they overlap on purpose.\n`);
for (const k of Object.keys(now.sections)) {
  const v = now.sections[k];
  let what = "—";
  if (Array.isArray(v)) what = v.length ? v.map(x => x.name).join(" + ") : "—";
  else if (v) what = v.name ? v.name + (v.repeat ? ` #${v.repeat}` : "") : `phrase ${v.index}`;
  let u = null; try { u = s.until(k) } catch (e) {}
  console.log(`   ${pad(k, 10)} ${pad(what, 26)}` +
    (u ? `ends in ${rpad(u.bars, 6)} bars = ${rpad(u.in_ms, 6)} ms` : ""));
}

console.log(`
WHAT IS COMING — in the next ${lead} ms of YOUR clock. Beats, section
boundaries and moments, each with the lead time you have to act on it.
`);
for (const e of coming.slice(0, 14)) {
  const label = e.layer ? e.what + (e.name && e.name !== e.what ? ` (${e.name})` : "")
                        : (e.accent ? "the one" : "beat");
  console.log(`   +${rpad(e.in_ms, 5)} ms   ${pad(label, 30)} bar ${e.bar} beat ${e.beat}`);
}
if (coming.length > 14) console.log(`   … and ${coming.length - 14} more`);

console.log(`
THE ONE THING TO BUILD AGAINST
${"-".repeat(72)}
Everything in the "bar / beat" column is fixed. Everything in the "ms" column
is a conversion into your clock, done on your machine, and it changes when the
tempo does. So hold your queue in bars and beats and convert at the last
moment; anything you commit to a wall-clock deadline goes stale the instant
somebody moves the tempo slider.

Not here, and not coming: frames, fixtures, channels, DMX. The protocol answers
questions about music. What a lamp does about the answer is the reader's job.
`);
