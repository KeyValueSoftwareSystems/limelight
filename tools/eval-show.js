#!/usr/bin/env node
"use strict";
/* eval-show.js — judge a baked show against the music.
   ===========================================================================
   Every defect this checks for is one that actually shipped in raga-of-revenge
   and survived review, because a show file can be completely valid and still
   render darkness. The file parses, the baker prints a cheerful line, the tests
   pass, and the room is black through the biggest thirty seconds of the song.
   So the only honest check is on the FRAMES, against the RECORDING.

   The checks, and the bug each one exists to catch:

     reaches      every state and binding resolves.        13 of 20 states were
                  being dropped by the baker because they were numbered against
                  the designer's own plot instead of the song's sections.
     alive        no long dead stretch while the band plays. A `follow` binding
                  held the rig at 1% through the whole first chorus.
     intentional  every dark stretch is either a darkening cue or a real hole in
     breath       a blackout on loud music is one beat, never two
     smooth       the room does not switch off and on outside a designed hit
     head         the head glides (never snaps or shivers), ends its moves on beats, and never outshines the row except at the climax
                  the music. Blackouts were firing over a vocal at full voice,
                  because "silence" had been measured as gaps between drum hits.
     contained    a cue changes nothing outside its own span. `follow` darkened
                  the rig for 35 seconds after it ended.
     tracks       brightness correlates with what the band is doing.
     moves        the row is not one flat colour; travel cues actually travel.
     prepared     every drop has darkness in front of it.
     unstuck      no value held frozen for too long.
     palette      not overwhelmingly white.

   usage: node tools/eval-show.js <score> <show.json> [--rig arc4-head] [--deep]
*/
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const scoreFile = args[0], showFile = args[1];
const rig = opt("--rig", "arc4-head");
const deep = args.includes("--deep");
if (!scoreFile || !showFile) { console.error("usage: eval-show.js <score> <show.json> [--rig r] [--deep]"); process.exit(2); }

const REPO = path.dirname(__dirname);
const TMP = fs.mkdtempSync("/tmp/eval-show-");
const bake = (show, tag) => {
  const sf = path.join(TMP, tag + ".show.json"), lf = path.join(TMP, tag + ".lights.json");
  fs.writeFileSync(sf, JSON.stringify(show));
  execFileSync("node", [path.join(REPO, "portal", "baker.js"), scoreFile, sf, "--rig", rig, "--lights", lf],
    { stdio: ["ignore", "ignore", "pipe"] });
  return JSON.parse(fs.readFileSync(lf, "utf8"));
};

const score = JSON.parse(fs.readFileSync(scoreFile, "utf8"));
const show = JSON.parse(fs.readFileSync(showFile, "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "portal", "venues", rig, "manifest.json"), "utf8"));
const layout = JSON.parse(fs.readFileSync(path.join(REPO, "readers", "lights", manifest.layout_file), "utf8"));

/* ---- how to read a frame ------------------------------------------------ */
const profileOf = t => JSON.parse(fs.readFileSync(path.join(REPO, "readers", "lights", "drivers", "profiles", t + ".profile.json"), "utf8"));
const FIX = layout.fixtures.map(f => {
  const prof = profileOf(f.type);
  const roles = prof.channels.map(c => c.role);
  return { id: f.id, type: f.type, off: f.address - 1, roles,
           r: roles.indexOf("colour.r"), master: roles.indexOf("master"),
           head: roles.includes("pan") };
});
const PARS = FIX.filter(f => !f.head), HEADS = FIX.filter(f => f.head);
const lvlOf = (frame, f) => {
  if (f.r >= 0) {
    const c = Math.max(frame[f.off + f.r], frame[f.off + f.r + 1], frame[f.off + f.r + 2]) / 255;
    return f.master >= 0 && !f.head ? c : (f.master >= 0 ? (frame[f.off + f.master] / 255) * c : c);
  }
  return f.master >= 0 ? frame[f.off + f.master] / 255 : 0;
};
const parLv = (frame) => PARS.map(f => lvlOf(frame, f));
const headLv = (frame) => HEADS.map(f => f.master >= 0 ? frame[f.off + f.master] / 255 : 0);
const rigLv = (frame) => Math.max(0, ...parLv(frame), ...headLv(frame));

/* ---- what the band is doing, from the score ----------------------------- */
const iot = score.instruments_over_time || {};
const fine = score.stems_fine || score.stems_temporal || null;
const lanes = (fine && fine.stems) || iot.lanes || {};
const lwin = (fine && fine.window_s) || iot.window_s || 0.5;
const lkeys = Object.keys(lanes);
const bandAt = t => {
  if (!lkeys.length) return 0.5;
  const i = Math.max(0, Math.min(Math.round(t / lwin - 0.5), lanes[lkeys[0]].length - 1));
  let m = 0; for (const k of lkeys) { const v = lanes[k][i]; if (v > m) m = v; }
  return m;
};

/* The drum lane and the band's weight, derived from the instrument lanes rather
   than from score.layers -- a raw score has no layers (the formatter derives
   them), so reading layers made two checks silently skip themselves on exactly
   the files the baker actually consumes. A check that quietly does not run is
   worse than no check. */
const KIT = ["drums", "kick", "snare", "toms", "percussion", "congas", "tabla"];
const kitKeys = lkeys.filter(k => KIT.includes(k));
const drumsAt = t => {
  if (!kitKeys.length) return 0;
  const i = Math.max(0, Math.min(Math.round(t / lwin - 0.5), lanes[kitKeys[0]].length - 1));
  let m = 0; for (const k of kitKeys) { const v = lanes[k][i]; if (v > m) m = v; }
  return m;
};
/* the band's WEIGHT: how much is sounding at once, not the single loudest lane.
   A max across lanes saturates on one instrument and reports the quiet outro as
   the loudest stretch of the song. */
const weightAt = t => {
  if (!lkeys.length) return 0.5;
  const i = Math.max(0, Math.min(Math.round(t / lwin - 0.5), lanes[lkeys[0]].length - 1));
  let sum = 0; for (const k of lkeys) sum += lanes[k][i] || 0;
  return sum;
};
/* Every point where the drums step up AND STAY up: the drops.
   A naive threshold crossing found 167 of them in a 131-second song, because
   the lane flickers around any single level -- and a check that reports 167
   drops is not a check, it is noise that hides the two that matter. So: the
   lane is smoothed over a bar, a rise must clear a high bar and a fall must
   drop below a lower one (hysteresis), the loud state has to hold for four
   seconds to count, and two drops cannot be closer than eight. */
const dropTimes = (() => {
  const LEN2 = (score.song && score.song.length_s) || 131;
  const step = lwin;
  const smooth = [];
  for (let t = 0; t < LEN2; t += step) {
    let sum = 0, n = 0;
    for (let u = Math.max(0, t - 1); u <= t + 1; u += step) { sum += drumsAt(u); n++; }
    smooth.push({ t, v: n ? sum / n : 0 });
  }
  const HI = 0.26, LO = 0.14, HOLD = 4.0, APART = 8.0;
  const out = [];
  let on = false;
  for (let i = 0; i < smooth.length; i++) {
    const { t, v } = smooth[i];
    if (!on && v >= HI) {
      let held = 0;
      for (let j = i; j < smooth.length && smooth[j].v >= LO; j++) held = smooth[j].t - t;
      if (held >= HOLD && (!out.length || t - out[out.length - 1] >= APART)) out.push(t);
      on = true;
    } else if (on && v < LO) on = false;
  }
  return out;
})();

const BEATS = (score.beats || []).map(b => b.t).filter(x => typeof x === "number");
const DOWN = (score.beats || []).filter(b => b.downbeat).map(b => b.t);

/* ---- run ---------------------------------------------------------------- */
const L = bake(show, "full");
const F = L.frames, fps = L.fps, DUR = F.length / fps;
const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });

/* ---- where a cue sits, in seconds --------------------------------------
   A show may anchor in seconds (at_s, from_s/to_s) or in bars (at_bar/at_beat,
   from_bar/to_bar) -- the baker accepts both, so the eval must read both, or it
   reports a show full of cues as having none and then blames the show. The
   clock is the score's own tempo map, walked the way the protocol says. */
const gridOf = show.grid || score.grid || {};
const bpb = gridOf.beats_per_bar || 4;
const tempo = (gridOf.tempo && gridOf.tempo.length)
  ? [...gridOf.tempo].sort((a, b) => a.from_beat - b.from_beat)
  : [{ from_beat: 0, at_s: gridOf.first_beat_s || 0, bpm: gridOf.bpm || 120 }];
const secondsAtBar = (bar, beat = 1) => {
  const n = (bar - 1) * bpb + (beat - 1);
  let seg = tempo[0];
  for (const c of tempo) { if (c.from_beat <= n) seg = c; else break; }
  return seg.at_s + (n - seg.from_beat) * 60 / seg.bpm;
};
const beatSecs = () => 60 / (tempo[tempo.length - 1].bpm || 120);
const sectionsOf = score.sections || [];
const secSpan = i => {
  const sec = sectionsOf[i];
  if (!sec) return null;
  const a = sec.from_s != null ? sec.from_s : sec.start;
  const b = sec.to_s != null ? sec.to_s : sec.end;
  return a != null && b != null ? [a, b] : null;
};
/* returns [start, end] in seconds, or null when the cue cannot be placed */
function spanOf(c) {
  let a = null, b = null;
  if (c.from_s != null) a = c.from_s;
  else if (c.from_bar != null) a = secondsAtBar(c.from_bar, c.from_beat || 1);
  else if (c.at_s != null) a = c.at_s;
  else if (c.start_s != null) a = c.start_s;
  else if (c.at_bar != null) a = secondsAtBar(c.at_bar, c.at_beat || 1);
  else if (c.at && c.at.bar != null) a = secondsAtBar(c.at.bar, c.at.beat || 1);

  if (c.to_s != null) b = c.to_s;
  else if (c.to_bar != null) b = secondsAtBar(c.to_bar, c.to_beat || 1);

  const sec = c.section != null ? secSpan(c.section) : null;
  if (sec) { a = a == null ? sec[0] : Math.max(a, sec[0]); b = b == null ? sec[1] : Math.min(b, sec[1]); }
  if (a == null) return null;
  if (b == null) {
    const beats = c.for_beats ?? c.over_beats ?? (c.at && c.at.beats) ?? 2;
    b = a + beats * beatSecs();
  }
  return b > a ? [a, b] : null;
}

const cues = [...(show.states || []).map(c => ({ ...c, kind: "state" })),
              ...(show.bindings || []).map(c => ({ ...c, kind: "binding" })),
              ...(show.gestures || []).map(c => ({ ...c, kind: "gesture" }))];

/* 1. reaches — every state and binding resolves to a real span ------------- */
{
  const nsec = (score.sections || []).length;
  const bad = cues.filter(c => c.kind !== "gesture").filter(c => {
    if (c.section != null && (c.section < 0 || c.section >= nsec)) return true;
    return spanOf(c) == null;
  });
  check("reaches", bad.length === 0,
    bad.length ? bad.length + " of " + cues.filter(c => c.kind !== "gesture").length + " never reach a lamp (first: " + bad[0].effect + " section " + bad[0].section + ")"
               : cues.filter(c => c.kind !== "gesture").length + " states/bindings all resolve");
}

/* 1b. supported — the venue can actually play what the show asks for -----
   A venue is a layout PLUS a folder of effect implementations, and the two can
   disagree. If an effect has no file here the baker quietly drops the cue and
   the room goes dark: `drive` is missing from club16-2head, so the chorus --
   the loudest thirty seconds of the song -- rendered black on that rig while
   passing every check on the desk rig. Silence is the failure mode, so it has
   to be asked about directly. */
{
  const dir = path.join(REPO, "portal", "venues", rig);
  const have = new Set(fs.readdirSync(dir).filter(f => f.endsWith(".js")).map(f => f.slice(0, -3)));
  const used = [...new Set(cues.map(c => c.effect))];
  const missing = used.filter(e => !have.has(e));
  check("supported", missing.length === 0,
    missing.length ? rig + " cannot play: " + missing.join(", ") + " — those cues render as darkness"
                   : "the venue implements all " + used.length + " effects this show uses");
}

/* 2. alive — no long dead stretch while the band is playing ---------------- */
{
  const OFF = 0.06, MAXDEAD = 2.5;
  let worst = 0, at = 0, run = 0, start = 0;
  for (let i = 0; i < F.length; i++) {
    const t = i / fps;
    const dead = rigLv(F[i]) < OFF && bandAt(t) > 0.25;
    if (dead) { if (run === 0) start = t; run += 1 / fps; if (run > worst) { worst = run; at = start; } }
    else run = 0;
  }
  check("alive", worst <= MAXDEAD,
    worst > 0.05 ? "longest dark-while-playing stretch " + worst.toFixed(1) + "s at " + at.toFixed(1) + "s (limit " + MAXDEAD + "s)"
                 : "never dark while the band plays");
}

/* 3. intentional — darkness is either a cue or a real hole ----------------- */
{
  const DARKENERS = new Set(["blackout", "hush", "cut", "strip"]);
  const dk = cues.filter(c => DARKENERS.has(c.effect)).map(spanOf).filter(Boolean)
    .map(([a, b]) => [a - 0.25, b + 0.35]);
  /* A show may open from black on purpose -- "the rig is at true zero until bar
     1" is a real decision, not an oversight -- so darkness before the first cue
     of the show is never counted against it. After the first cue, darkness has
     to be asked for. */
  const firstCue = Math.min(...cues.map(c => { const sp = spanOf(c); return sp ? sp[0] : Infinity; }));
  const covered = t => t < firstCue || dk.some(([a, b]) => t >= a && t <= b) || bandAt(t) < 0.20;
  let bad = 0, total = 0, firstAt = null;
  let run = 0, start = 0;
  for (let i = 0; i < F.length; i++) {
    const t = i / fps;
    if (rigLv(F[i]) < 0.06) {
      if (run === 0) start = t;
      run += 1 / fps;
    } else {
      if (run >= 0.5) { total++; if (!covered(start + run / 2)) { bad++; if (firstAt == null) firstAt = start; } }
      run = 0;
    }
  }
  check("intentional", bad === 0,
    bad ? bad + " of " + total + " dark stretches are not a cue and not a hole in the music (first at " + firstAt.toFixed(1) + "s)"
        : total + " dark stretches, every one deliberate");
}

/* 3b. breath — a blackout on loud music is one beat, never two ------------- */
{
  /* Renjith heard "false blacks": stretches where the band is playing at full
     weight and the room is black for two beats. Every one of them was a cue we
     wrote on purpose, so `intentional` passed -- but the ear is right: when
     the music never goes quiet, a breath is one beat and anything longer reads
     as a fault. A dark stretch is allowed to run long only when the band is
     genuinely quiet under it. */
  const beatS = 60 / ((score.key_tempo && score.key_tempo.bpm) || 120);
  const LIMIT = 1.25 * beatS;
  let bad = 0, firstAt = null, longest = 0;
  let run = 0, start = 0;
  const judge = () => {
    if (run < 0.3) return;
    let sum = 0, n = 0;
    for (let u = start; u < start + run; u += 0.05) { sum += bandAt(u); n++; }
    const loud = n && sum / n > 0.45;
    if (loud && run > LIMIT) { bad++; if (firstAt == null) firstAt = start; longest = Math.max(longest, run); }
  };
  for (let i = 0; i < F.length; i++) {
    if (rigLv(F[i]) < 0.06) { if (run === 0) start = i / fps; run += 1 / fps; }
    else { judge(); run = 0; }
  }
  judge();
  check("breath", bad === 0,
    bad ? bad + " blackout(s) on loud music run longer than a beat (first at " + firstAt.toFixed(1) + "s, longest " + longest.toFixed(2) + "s; limit " + LIMIT.toFixed(2) + "s)"
        : "every blackout on loud music is a beat or less");
}

/* 3c. smooth — the room does not switch off and on outside a designed hit ----- */
{
  /* Renjith: "sudden shutting down and immediate re-lighting of lights". A DIP
     is the row losing more than 45% of its light within 100ms and having it
     back within 0.7s. Inside a darkening cue that is the design; anywhere else
     it is a seam -- a cue ending into a dim bed, a bed that flickers on the
     beat, an acceleration flicking on and off -- and it reads as a fault. */
  const DARKENERS = new Set(["blackout", "hush", "cut", "strip"]);
  const dk = cues.filter(c => DARKENERS.has(c.effect)).map(spanOf).filter(Boolean).map(([a, b]) => [a - 0.15, b + 0.35]);
  const rowLight = f => { const v = parLv(f); return v.reduce((x, y) => x + y, 0) / (v.length || 1); };
  const dips = [];
  for (let i = 4; i < F.length - 30; i++) {
    const before = rowLight(F[i - 4]), now = rowLight(F[i]);
    if (before > 0.2 && now < before * 0.55) {
      let rec = -1;
      for (let j = i + 1; j < i + 28 && j < F.length; j++) if (rowLight(F[j]) >= before * 0.7) { rec = j; break; }
      if (rec > 0) { const t = i / fps; if (!dk.some(([a, b]) => t >= a && t <= b)) dips.push(t); i = rec; }
    }
  }
  const LIMIT = 8;
  check("smooth", dips.length <= LIMIT,
    dips.length + " off-and-on dips outside a darkening cue (limit " + LIMIT + ")" +
    (dips.length ? "; first at " + dips.slice(0, 6).map(t => t.toFixed(1) + "s").join(", ") : ""));
}

/* 3d. head — smooth, deliberate, landing on beats, never the brightest thing except at the climax --- */
{
  /* Renjith, twice: first "moving in all sorts of directions and has no stable
     rhythm", then, after it was made still, "completely bland ... what we want
     to avoid is jittery movements, it just has to be cohesive and smooth". So
     the head may move as much as the music asks, but: it never turns faster
     than 5 of its 7 units a frame (a glide, never a snap), it never reverses
     direction twice inside one beat (no shiver), every visible move ends within
     a sixth of a beat before a beat, and outside the climax and the impacts its
     level stays at or under 75%. Motion in the dark is not counted. */
  const head = HEADS[0];
  if (!head) { check("head", true, "no moving head on this rig"); }
  else {
    const panCh = head.off + head.roles.indexOf("pan"), tiltCh = head.off + head.roles.indexOf("tilt");
    const lit = f => headLv(f)[0] > 0.05;
    const beatS = 60 / ((score.key_tempo && score.key_tempo.grid_bpm) || 120);
    const CLIMAX = [97.76, 109.76];
    const impactSpans = cues.filter(c => c.effect === "impact").map(spanOf).filter(Boolean).map(([a, b]) => [a - 0.05, b + 0.05]);
    let litN = 0, fast = 0, shiver = 0, badLand = 0, segs = 0, bright = 0, moving = 0;
    let inMove = false, moveStart = 0, lastDir = 0, lastRev = -9, stillRun = 0, moveEnd = 0, panAtStart = 0, panAtEnd = 0;
    for (let i = 1; i < F.length; i++) {
      const t = i / fps;
      if (!lit(F[i]) || !lit(F[i - 1])) { inMove = false; lastDir = 0; stillRun = 0; continue; }
      litN++;
      const dp = F[i][panCh] - F[i - 1][panCh], dm = Math.abs(dp) + Math.abs(F[i][tiltCh] - F[i - 1][tiltCh]);
      /* any change is motion; a glide at two units a frame rounds to a one-unit step
         now and then and must not read as a stop. A move has ENDED only after
         three unchanged frames. */
      const mv = dm >= 1;
      if (mv) moving++;
      if (dm > 5.5) fast++;
      stillRun = mv ? 0 : stillRun + 1;
      const dir = dp > 0 ? 1 : dp < 0 ? -1 : 0;
      if (dir && lastDir && dir !== lastDir) { if (t - lastRev < beatS) shiver++; lastRev = t; }
      if (dir) lastDir = dir;
      if (mv && !inMove) { moveStart = t; panAtStart = F[i - 1][panCh]; }
      if (mv) { inMove = true; moveEnd = t; panAtEnd = F[i][panCh]; }
      else if (inMove && stillRun >= 3) {
        inMove = false;
        /* a crawl of a few units (a six-second glide across a quarter of the room) is not a move anyone sees */
        if (moveEnd - moveStart >= 0.1 && Math.abs(panAtEnd - panAtStart) >= 6) {
          segs++;
          const nextBeat = BEATS.find(x => x >= moveEnd - 0.06);
          if (nextBeat == null || nextBeat - moveEnd > beatS / 6) badLand++;
        }
      }
      const inClimax = t >= CLIMAX[0] && t < CLIMAX[1];
      const inImpact = impactSpans.some(([a, b]) => t >= a && t <= b);
      if (!inClimax && !inImpact && headLv(F[i])[0] > 0.76) bright++;
    }
    const brightPct = litN ? 100 * bright / litN : 0, movPct = litN ? 100 * moving / litN : 0;
    check("head", fast === 0 && shiver === 0 && badLand === 0 && brightPct <= 2,
      "moving " + movPct.toFixed(0) + "% of its lit time; " + fast + " frames at snap speed (want 0); " + shiver + " reversals within a beat of the last (want 0); " +
      segs + " moves, " + badLand + " not ending on a beat; over 75% outside the climax and impacts in " + brightPct.toFixed(1) + "% of lit frames (want <= 2%)");
  }
}

/* 4. contained — a cue changes nothing outside its own span ---------------- */
{
  const suspects = (show.bindings || []).map((c, i) => ({ c, i, list: "bindings" }))
    .concat(deep ? (show.states || []).map((c, i) => ({ c, i, list: "states" })) : []);
  let worst = 0, who = null;
  for (const { c, i, list } of suspects) {
    const without = { ...show, [list]: show[list].filter((_, j) => j !== i) };
    const W = bake(without, list + i).frames;
    const sp = spanOf(c) || [0, DUR];
    const a = sp[0], b = sp[1];
    let mx = 0, mxT = 0;
    for (let k = 0; k < F.length; k++) {
      const t = k / fps;
      if (t >= a - 0.2 && t <= b + 0.6) continue;           /* inside, plus a short tail */
      const d = Math.abs(rigLv(F[k]) - rigLv(W[k]));
      if (d > mx) { mx = d; mxT = t; }
    }
    if (mx > worst) { worst = mx; who = c.effect + " (" + a.toFixed(1) + "-" + b.toFixed(1) + "s) still changes " + mxT.toFixed(1) + "s by " + mx.toFixed(2); }
  }
  check("contained", worst <= 0.12,
    worst > 0.02 ? who : (suspects.length ? suspects.length + " cues stay inside their span" : "nothing to test"));
}

/* 5. tracks — brightness follows the band --------------------------------- */
{
  const xs = [], ys = [];
  for (let t = 0; t < DUR; t += 0.5) {
    const i = Math.round(t * fps); if (i >= F.length) break;
    xs.push(bandAt(t)); ys.push(rigLv(F[i]));
  }
  const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  const r = num / Math.sqrt(dx * dy || 1);
  check("tracks", r >= 0.15, "brightness vs the band: r = " + r.toFixed(2) + " (want >= 0.15)");
}

/* 6. moves — the row is not one flat colour ------------------------------- */
{
  let lit = 0, flat = 0;
  for (const f of F) {
    const v = parLv(f); const mx = Math.max(...v), mn = Math.min(...v);
    if (mx > 0.06) { lit++; if (mx - mn < 0.03) flat++; }
  }
  const pct = lit ? 100 * flat / lit : 100;
  check("moves", pct <= 70, pct.toFixed(0) + "% of lit frames have all pars identical (want <= 70%)");

  /* and a cue that says it travels must actually travel */
  /* A run may cross the row several times inside one bar, so "which lamp peaked
     first" is meaningless across the whole span -- lamp 1's brightest moment can
     belong to the second pass. Instead the centre of brightness across the row
     is tracked frame by frame and each pass is judged on its own: it must drift
     the way the cue says. This is measuring the thing a person in the room sees
     -- light moving across the wall -- rather than a proxy for it. */
  /* `chase` IS a travelling effect and was not being checked at all -- the test
     looked only for trade's `travel` flag, so a show whose whole build is chase
     reported "0 of 0 travel cues" and passed without verifying a single wave. */
  const travellers = (show.gestures || []).filter(g => g.travel || g.effect === "chase").map(g => {
    const sp = spanOf(g); return sp ? { ...g, from_s: sp[0], to_s: sp[1] } : null;
  }).filter(Boolean);
  let ok = 0; const why = [];
  for (const g of travellers) {
    /* Follow the BRIGHTEST LAMP, which is what an eye in the room follows.
       The centre of brightness looked like the right measure and is not: a
       travelling bump has a tail, and the tail drags the centre backwards while
       the bump itself is still moving forward -- a run that visibly crosses the
       row left to right scored a backward bias. The brightest lamp has no tail.
       A step of more than one lamp is the bump wrapping round to start again,
       which is not travel in either direction, so it is not counted. */
    /* Follow the ODD LAMP OUT, not the brightest lamp. In a colour wave the
       brightness is nearly constant by design -- what travels is a hue -- so
       "brightest" flickered to whichever untouched lamp happened to peak while
       the moving colour was between two lamps, and a wave that visibly crossed
       the row scored as going nowhere. The eye follows the lamp that is unlike
       its neighbours; so does this. For a plain brightness run the odd one out
       IS the brightest, so nothing is lost. */
    let fwd = 0, back = 0, prev = null;
    for (let t = g.from_s; t < g.to_s; t += 1 / fps) {
      const f = F[Math.round(t * fps)];
      const rgb = PARS.map(p => p.r >= 0 ? [f[p.off + p.r], f[p.off + p.r + 1], f[p.off + p.r + 2]] : [0, 0, 0]);
      const v = parLv(f);
      if (Math.max(...v) < 0.12) { prev = null; continue; }
      const med = [0, 1, 2].map(c => { const xs = rgb.map(x => x[c]).sort((a, b) => a - b); return (xs[1] + xs[2]) / 2; });
      const dist = rgb.map(x => Math.hypot(x[0] - med[0], x[1] - med[1], x[2] - med[2]));
      const at = dist.indexOf(Math.max(...dist));
      if (Math.max(...dist) < 40) { prev = null; continue; }   // no lamp stands out: nothing is travelling this frame
      if (prev != null) {
        const d = at - prev;
        if (d === 1) fwd++; else if (d === -1) back++;
      }
      prev = at;
    }
    const total = fwd + back;
    const bias = total > 0 ? (fwd - back) / total : 0;
    const want = g.direction === "rl" ? -1 : 1;
    /* Two steps with nothing against them is a crossing. Four lamps give at
       most three transitions, so demanding three rejected honest one-beat runs
       whose span clipped a transition -- the check was stricter than the rig
       can be. */
    if ((total >= 3 && bias * want >= 0.3) || (total >= 2 && bias * want === 1)) ok++;
    else why.push(g.from_s.toFixed(1) + "s " + (g.direction || "lr")
      + " (" + fwd + " steps forward, " + back + " back)");
  }
    check("travel", ok === travellers.length,
      ok + " of " + travellers.length + " travel cues cross the row the way they say"
      + (why.length ? " — " + why.join(", ") : ""));
}

/* 7. prepared — every drop has darkness in front of it -------------------- */
{
  /* the nearest downbeat, not the next one: a drop detected at 49.9s belongs to
     the downbeat at 49.75s, and looking forward found 51.7s and measured the
     wrong bar entirely. */
  const drops = dropTimes.map(t => DOWN.reduce((a, x) => Math.abs(x - t) < Math.abs(a - t) ? x : a, DOWN[0]));
  let ready = 0;
  for (const d of drops) {
    let minBefore = 1;
    for (let t = d - 0.9; t < d - 0.05; t += 1 / fps) {
      const i = Math.round(t * fps); if (i < 0 || i >= F.length) continue;
      minBefore = Math.min(minBefore, rigLv(F[i]));
    }
    const after = rigLv(F[Math.min(F.length - 1, Math.round((d + 0.06) * fps))]);
    if (minBefore < 0.15 && after > 0.5) ready++;
  }
  if (drops.length) check("prepared", ready === drops.length,
    ready + " of " + drops.length + " drops land in an empty room");
}

/* 7b. payoff — the drop must beat the build that led into it -------------
   A show can pass every other check and still be backwards. Here the eight bars
   BEFORE the drop peaked at 0.89 with the head sweeping and the row wide open,
   and the drop itself sat at 0.41 with the head almost dark -- the biggest
   moment in the song rendered as the flattest, dimmest stretch of the show. No
   check caught it, because nothing was black and the overall correlation with
   the music was fine. Loudness is not the only axis: a drop has to win on
   brightness, on how far apart the lamps are, and on how much the head moves,
   or the room feels the build and then feels nothing. */
{
  const win = (a, b) => {
    let lv = 0, sp = 0, mv = 0, n = 0, prev = null;
    for (let t = a; t < b; t += 1 / fps) {
      const i = Math.round(t * fps); if (i < 0 || i >= F.length) continue;
      const f = F[i], v = parLv(f);
      /* spread is how DIFFERENT the lamps look, not only how different their
         levels are. Two pairs at the same brightness in red and blue is a
         strongly varied picture and used to score as flat. */
      const hueSpread = (() => { const hs = PARS.map(p => { if (p.r < 0) return 0; const r = f[p.off + p.r], g = f[p.off + p.r + 1], b = f[p.off + p.r + 2]; const m = Math.max(r, g, b) || 1; return m < 25 ? null : (r - b) / m; }).filter(x => x != null); return hs.length ? Math.max(...hs) - Math.min(...hs) : 0; })();
      lv += Math.max(...v); sp += Math.max(Math.max(...v) - Math.min(...v), 0.5 * hueSpread);
      const hp = HEADS.length && HEADS[0].roles.indexOf("pan") >= 0 ? f[HEADS[0].off + HEADS[0].roles.indexOf("pan")] : 0;
      if (prev != null) mv += Math.abs(hp - prev);
      prev = hp; n++;
    }
    return n ? { lv: lv / n, sp: sp / n, mv: mv / n } : { lv: 0, sp: 0, mv: 0 };
  };
  const drops = dropTimes;
  const bad = [];
  for (const d of drops) {
    const before = win(d - 8, d - 0.5), after = win(d + 0.5, d + 8);
    const wins = [after.lv >= before.lv * 0.95, after.sp >= before.sp * 0.8, after.mv >= before.mv * 0.6]
      .filter(Boolean).length;
    if (wins < 2) bad.push(d.toFixed(1) + "s (before: level " + before.lv.toFixed(2)
      + " spread " + before.sp.toFixed(2) + "; after: " + after.lv.toFixed(2) + " / " + after.sp.toFixed(2) + ")");
  }
  if (drops.length) check("payoff", bad.length === 0,
    bad.length ? bad.length + " of " + drops.length + " drops are weaker than the build before them — " + bad.slice(0, 3).join("; ")
               : drops.length + " drops all land bigger than the build before them");
}

/* 7c. climax — the show's biggest moment sits where the music's is ------
   Measured as: find the show's brightest couple of seconds, then ask how heavy
   the band is right there, as a rank against the rest of the song.

   This started as "compare the brightest eight seconds to the heaviest eight
   seconds" and that was wrong in a way worth recording: two beats of blackout
   in front of the biggest hit in the song drag that window's AVERAGE down, so
   the check punished the show for preparing its own climax properly. A peak is
   a moment, not an average, and the question is only whether the lights are
   biggest where the music is. */
{
  const win = 2.0;
  let bestT = 0, bestV = -1;
  for (let t = 0; t + win < DUR; t += 0.25) {
    let v = 0, n = 0;
    for (let u = t; u < t + win; u += 1 / fps) { const i = Math.round(u * fps); if (i < F.length) { v += rigLv(F[i]); n++; } }
    if (n && v / n > bestV) { bestV = v / n; bestT = t; }
  }
  /* how heavy is the band there, ranked against every other moment? */
  const all = [];
  for (let t = 0; t < DUR; t += 0.5) all.push(weightAt(t));
  const sorted = [...all].sort((x, y) => x - y);
  /* The band's weight at its heaviest within three seconds either side of the
     show's brightest moment. A designer lands the climax a hair EARLY -- the
     room is already blazing when the biggest kick arrives -- and the exact two
     seconds of peak light can sit a beat or two before the exact two seconds of
     peak sound without anyone in the room feeling a mismatch. Demanding the
     same two seconds punished the right instinct. */
  let hereW = 0;
  for (let u = bestT - 3; u < bestT + win + 3; u += 0.5) hereW = Math.max(hereW, weightAt(Math.max(0, u)));
  const rank = sorted.filter(v => v <= hereW).length / sorted.length;
  check("climax", rank >= 0.6,
    "the show is biggest at " + bestT.toFixed(0) + "s, where the band is heavier than "
    + (100 * rank).toFixed(0) + "% of the song (want 60%+)");
}

/* 8. unstuck — nothing frozen ------------------------------------------- */
{
  let run = 0, worst = 0, at = 0, prev = null;
  for (let i = 0; i < F.length; i++) {
    const v = parLv(F[i]).map(x => Math.round(x * 50)).join(",");
    if (v === prev && rigLv(F[i]) > 0.06) { run += 1 / fps; if (run > worst) { worst = run; at = i / fps - run; } }
    else run = 0;
    prev = v;
  }
  check("unstuck", worst <= 2.0, worst > 0.05 ? "held one picture for " + worst.toFixed(1) + "s at " + at.toFixed(1) + "s (limit 2.0s)" : "never freezes");
}

/* 9. palette -------------------------------------------------------------- */
{
  let lit = 0, white = 0;
  for (const f of F) {
    let any = false, allWhite = true;
    for (const p of PARS) {
      if (p.r < 0) continue;
      const r = f[p.off + p.r], g = f[p.off + p.r + 1], b = f[p.off + p.r + 2], m = Math.max(r, g, b);
      if (m > 20) { any = true; if (Math.min(r, g, b) < m * 0.8) allWhite = false; }
    }
    if (any) { lit++; if (allWhite) white++; }
  }
  const pct = lit ? 100 * white / lit : 0;
  check("palette", pct <= 35, pct.toFixed(0) + "% of lit frames are near-white (want <= 35%)");
}

/* 10. vocabulary — is the show saying enough different things? -----------
   A show built from three effects is bland however well each one is placed.
   The measure is not "use everything": forcing all twenty-four is its own
   failure, because an effect used where the music does not ask for it reads as
   noise. What matters is that the rig has a real range and that no single span
   is a monoculture. */
{
  const used = new Set(cues.map(c => c.effect));
  const avail = (manifest.supported_effects || []).length || used.size;
  check("vocabulary", used.size >= 6,
    used.size + " of " + avail + " effects used" + (used.size < 6 ? " — too few; the show will read as one idea" : ""));
}

/* 11. balance — is any one effect doing all the work? -------------------
   An effect that covers most of the show stops being an effect and becomes the
   wallpaper. The signature move of a show should land a handful of times; the
   thirtieth time, nobody sees it. Measured on TIME COVERED, not on cue count,
   because one state across half the song matters more than ten quick hits. */
{
  const held = new Map();
  let span = 0;
  for (const c of cues) {
    const sp = spanOf(c);
    if (!sp) continue;
    const [a, b] = sp;
    const d = Math.max(0, b - a);
    held.set(c.effect, (held.get(c.effect) || 0) + d);
    span += d;
  }
  const rank = [...held.entries()].sort((a, b) => b[1] - a[1]);
  const topShare = span > 0 ? rank[0][1] / span : 0;
  check("balance", topShare <= 0.45,
    rank.length ? rank[0][0] + " holds " + (100 * topShare).toFixed(0) + "% of all cue time (limit 45%)"
                + "; next " + rank.slice(1, 3).map(r => r[0] + " " + (100 * r[1] / span).toFixed(0) + "%").join(", ")
                : "no cues");
}

/* 12. density — enough punctuation, and not so much it is noise ---------
   Too few marked moments and the room never reacts to the song; too many and
   nothing is a moment any more. Also checks the longest stretch with nothing
   placed at all, which is where an audience stops watching the lights. */
{
  const g = (show.gestures || []).map(x => { const sp = spanOf(x); return sp ? sp[0] : null; })
    .filter(x => x != null).sort((a, b) => a - b);
  const perMin = g.length / (DUR / 60);
  let gap = g.length ? g[0] : DUR, at = 0;
  for (let i = 1; i < g.length; i++) if (g[i] - g[i - 1] > gap) { gap = g[i] - g[i - 1]; at = g[i - 1]; }
  if (g.length && DUR - g[g.length - 1] > gap) { gap = DUR - g[g.length - 1]; at = g[g.length - 1]; }
  const ok = perMin >= 6 && perMin <= 90 && gap <= 20;
  check("density", ok,
    perMin.toFixed(0) + " moments per minute (want 6-90); longest stretch with nothing placed "
    + gap.toFixed(1) + "s at " + at.toFixed(1) + "s (limit 20s)");
}

/* ---- report ------------------------------------------------------------- */
const pad = n => n.padEnd(13);
console.log("\nEVAL  " + path.basename(showFile) + "  on " + rig + "  (" + DUR.toFixed(1) + "s, " + F.length + " frames)");
console.log("");
for (const r of results) console.log("  " + (r.pass ? " ok " : "FAIL") + "  " + pad(r.name) + r.detail);
const failed = results.filter(r => !r.pass);
console.log("");
console.log("  " + (results.length - failed.length) + " of " + results.length + " checks pass" + (failed.length ? "  —  " + failed.map(f => f.name).join(", ") : ""));
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
