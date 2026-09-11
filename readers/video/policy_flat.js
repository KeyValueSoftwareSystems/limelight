// The control: what you get WITHOUT this project.
//
// No map. It is not given beats, downbeats, chapters, moments, spans, energy,
// accents or the pump envelope -- the whole point of the comparison is that
// this is what the same footage and the same song look like when nothing has
// measured the music. It cuts on a timer and picks clips in the order they came
// out of the catalogue.
//
// It is deliberately NOT a straw man. It gets:
//   - the same clips, the same window, the same output format
//   - the same NUMBER of cuts as the intelligent edit, so it is never losing
//     merely because it is slower or busier
//   - the same compiler and the same encoder
//
// What it does not get is any knowledge of where it is in the song. That
// difference, and nothing else, is what the A/B is measuring.
"use strict";
const ASSETS = require("./assets.js");

function run(ctx) {
  const { brief, index, seed } = ctx;
  const dur = ctx.length_s;
  const win = ctx.window || { from: 0, to: dur };
  const span = win.to - win.from;

  // Match the shot count of whatever it is being compared against, so pacing is
  // held constant and only placement differs.
  const shots = Math.max(2, parseInt(ctx.flatShots || "13", 10));
  const every = span / shots;

  // The SAME pool the intelligent policy gets, including the brief's subject
  // selection. Without this the control was drawing from assets/generated --
  // the synthetic answer-sheet clips of a disc moving over noise, which sort
  // first by clip_id -- and a comparison against test-harness footage measures
  // nothing at all.
  const pool = ASSETS.selectBySubject(
    ASSETS.shots(index, brief, undefined, ctx.described), brief, ctx.sem,
    undefined, brief.subject_min_shots || undefined);
  // The SAME chooser the intelligent policy uses.
  //
  // This was catalogue order -- alphabetical by clip_id, no fit, no continuity,
  // no variety -- and that was an unfair fight. Fit scoring, continuity and the
  // subject-variety penalty come from the BRIEF and the clip index; none of
  // them needs a map. Withholding them was handicapping the control with tools
  // it should have had, which proves nothing except that a crippled baseline
  // loses.
  //
  // The one thing it does not get is knowledge of WHERE IT IS IN THE SONG. It
  // cuts on a timer. That difference, and nothing else, is what the A/B is for.
  const timeline = [];
  const used = new Map();
  let prev = null, prevKin = null;
  // The timer walks, it does not index. Computing each start as `from + i*every`
  // while a slot could be SHORTENED left a gap between one shot's end and the
  // next one's start, and the compiler allocates frames across the gap -- so a
  // 1.58 s slot was rendered as 1.75 s and ran past the end of its shot. A
  // timeline has to be contiguous whatever decides its lengths.
  // The control gets the descriptions too.
  //
  // It already used them to skip leader and tail; it did not use them to HOLD.
  // So the intelligent edit was ending on a 2.86 s reveal and the control was
  // chopping the same shot at its timer, and the difference between the two
  // included "one of them can see". That is not the comparison this exists to
  // make. The A/B has exactly one variable -- whether the policy knows where it
  // is in the song -- and every other tool goes to both sides.
  const roleOf = (function () {
    const m = new Map();
    const d = ctx.described;
    if (d && d.shots) for (const r of d.shots)
      if (r.role) m.set(r.clip_id + "#" + r.shot, r.role);
    return m;
  })();

  let cursor = win.from;
  for (let i = 0; i < shots; i++) {
    const start = cursor;
    const end = i === shots - 1 ? win.to : Math.min(win.to, start + every);
    let want = end - start;
    if (want <= 0.05) break;
    // impact 0 and no mood: both are musical judgements and it has none.
    // A shot that cannot fill the slot is skipped here too. This is NOT a
    // musical judgement and giving it to the control is not a handicap on the
    // intelligent edit -- it is the same footage constraint both sides face.
    // Without it the control runs past the end of a shot and the ORIGINAL
    // editor's cuts get spliced into it, which would hand the A/B a difference
    // that has nothing to do with reading the music.
    // The control takes the next shot and, if it is too short for its slot,
    // SHORTENS THE SLOT -- it does not go looking for a better one.
    //
    // Rejecting a short shot burned it from the cursor, and once the film
    // stopped wrapping that starved the control to 5 shots against the
    // intelligent edit's 12. An A/B decided by which side ran out of footage
    // measures nothing about reading the music. Shortening is the same
    // mechanical concession the other policy gets from the footage; the timer
    // still decides where the cuts WANT to be, which is the whole difference
    // being tested.
    let s = null;
    if (brief.preserve_order) {
      const c2 = ASSETS.nextInOrder(pool, used, want, brief);
      if (c2) {
        s = c2;
        // A shot the film is built toward runs its own length here as well.
        // The timer still decides everything else, which is the whole
        // difference being tested.
        if (roleOf.get(c2.clip_id + "#" + c2.shot) === "hold") {
          want = Math.min(Math.max(want, c2.duration - 0.02), win.to - start);
        } else if (c2.duration + 0.02 < want) {
          want = Math.max(0.2, c2.duration - 0.02);
        }
      }
    } else {
      s = ASSETS.choose(pool, want, used, prev, brief, seed + i,
                        prevKin, false, 0, null, null, null);
    }
    if (!s) continue;
    (function () {
      const mk = s.clip_id + "#" + s.shot + "#" + (s.moment || 0);
      used.set(mk, (used.get(mk) || 0) + 1);
      used.set(s.clip_id, (used.get(s.clip_id) || 0) + 1);
    })();
    prev = s.clip_id + "#" + s.shot;
    prevKin = s.source_category;
    cursor = start + want;
    timeline.push({
      start: +start.toFixed(3), end: +(start + want).toFixed(3),
      clip_id: s.clip_id, shot: s.shot,
      in_s: ASSETS.inPoint(s, Math.min(want, s.duration)),
      because: { rule: "timer", salience: null,
                 not_a_musical_cut: "cut every " + every.toFixed(2) + "s; the "
                   + "music was not consulted",
                 evidence: ["no map"] }
    });
  }
  return {
    timeline: timeline, holds: [],
    budget: { allowed: shots, spent: shots - 1, why_underspent: null,
              note: "fixed interval, no map" }
  };
}
module.exports = { run: run, id: "flat", label: "no map: cut on a timer" };
