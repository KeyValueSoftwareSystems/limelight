#!/usr/bin/env node
// map + brief + clips -> video IR.
//
//   node readers/video/edit.js --slug levels --brief premium-restraint \
//        --policy rules --out renders/levels.premium.rules.ir.json
//
// The policy is chosen here rather than compiled in, so that the naive
// baseline, the rules policy and the LLM policy all receive byte-identical
// inputs. If they were each given their own loader, a difference between two
// edits could be a difference in what they were shown.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const DERIVE = require(path.join(ROOT, "readers", "src", "derive.js"));
const BRIEF = require("./brief.js");
const INFER = require("./infer.js");

const POLICIES = {
  naive: require("./policy_naive.js"),
  rules: require("./policy_rules.js"),
  random: require("./policy_random.js"),
  flat:   require("./policy_flat.js"),
  llm:   require("./policy_llm.js")
};

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function mapPath(slug) {
  const dirs = (process.env.LIMELIGHT_MAPS || "synth/maps/amal").split(":");
  for (const d of dirs) {
    for (const n of [slug + ".full.map.json", slug + ".map.json"]) {
      const p = path.join(ROOT, d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// Where a shot ends in its source file. The policy works in pool entries; the
// trim works in IR entries, which carry only clip_id and a shot number.
function shotBounds(index, clipId, shot) {
  const c = (index.clips || []).find(function (x) { return x.clip_id === clipId; });
  if (!c || !c.shots || shot < 0 || shot >= c.shots.length) return null;
  return c.shots[shot];
}

function main() {
  const slug = arg("slug");
  const briefId = arg("brief", "premium-restraint");
  const policyId = arg("policy", "rules");
  const seed = parseInt(arg("seed", "20260910"), 10);
  if (!slug) { console.error("--slug is required"); process.exit(2); }

  const mp = mapPath(slug);
  if (!mp) { console.error("no map for " + slug); process.exit(2); }
  const map = JSON.parse(fs.readFileSync(mp, "utf8"));
  const written = JSON.parse(fs.readFileSync(
    path.join(ROOT, "briefs", briefId + ".json"), "utf8"));
  // A named clip set, or the default. Coherence lives here: a set is clips
  // from one world, and the chooser can only hold a world if it was given one.
  // `--set product` is the name of a folder, and asking the writer of a
  // three-line brief to know it is the same leak as asking them for
  // cuts_per_minute. `auto`, or saying nothing at all, asks assets/match.py
  // which pile of footage the brief's own words mean. The answer is cached per
  // brief because it costs a CLIP text pass, and it cannot change unless the
  // brief or the footage does.
  let setname = arg("set", null), matchedSubject = null;
  {
    const cacheP = path.join(ROOT, "assets", "stock", ".matched.json");
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cacheP, "utf8")); } catch (e) {}
    // An explicitly named --set is never replaced. The matcher is asked here
    // for the SUBJECT, which a named set still needs; the choice of pile was
    // already made by whoever typed it.
    //
    // This overwrote it. apple5c has no SEMANTIC.json, so the matcher could not
    // find it, fell back to its best-scoring set, and cached `fivec` under the
    // key `recut-5c@apple5c`. Every run after that silently cut the Apple
    // re-cut from a different pile of footage than the one named on the command
    // line, and said nothing.
    const named = arg("set", null);
    const explicit = !!named && named !== "auto";
    const ckey = briefId + "@" + (setname || "auto");
    if (cache[ckey]) {
      const c = cache[ckey];
      if (!explicit) setname = typeof c === "string" ? c : c.set;
      matchedSubject = typeof c === "string" ? null : c.subject;
    } else if (true) {
      const py = ["work/audio/bin/python", "work/moss/bin/python", "python3"]
        .map(function (x) { return path.join(ROOT, x); })
        .find(function (x) { return fs.existsSync(x); }) || "python3";
      // A named --set still has a subject. Only the choice of pile was already
      // made, and the film still has to be ABOUT something or it is a montage.
      // Resolving the subject only on `--set auto` meant every blind candidate
      // run, which names its set, silently had no subject at all -- and
      // `arrival: early` and `arrival: late` rendered byte-identical files.
      const margs = [path.join(ROOT, "assets", "match.py"), "--brief", briefId, "--quiet"];
      if (setname && setname !== "auto") margs.push("--for-set", setname);
      const r = require("child_process").spawnSync(py, margs,
        { cwd: ROOT, encoding: "utf8" });
      let pick = null, subject = null;
      try {
        const j = JSON.parse((r.stdout || "").trim().split("\n").pop());
        pick = j.set; subject = j.subject;
      } catch (e) { pick = (r.stdout || "").trim().split("\n").pop(); }
      if (r.status === 0 && pick) {
        if (!explicit) setname = pick;
        cache[ckey] = { set: pick, subject: subject };
        try { fs.writeFileSync(cacheP, JSON.stringify(cache, null, 1) + "\n"); } catch (e) {}
        matchedSubject = subject;
        console.error("set: " + pick + " (matched from the brief's own words)");
        if (subject) console.error("subject: " + subject);
      } else if (!explicit) {
        console.error("set: could not match, falling back to the default index");
        setname = null;
      }
    }
  }
  const indexPath = arg("index", null) ||
    (setname ? path.join(ROOT, "assets", "stock", setname, "INDEX.json")
             : path.join(ROOT, "assets", "INDEX.json"));
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  // Decide what the brief left unsaid, BEFORE the words become numbers -- the
  // inference picks words, so it has to happen while words are still the
  // currency. A brief that names a thing keeps it; silence gets an answer
  // measured from this song and this footage rather than a constant.
  // The subject the matcher named, unless the writer named one. It is a
  // measurement about the footage, not a word the writer should have to know.
  // Only when the writer named nothing. A brief that already lists its subject
  // has said what the film is about, and the matcher's single word must not
  // quietly replace it -- that is the same rule as every other inference here,
  // and skipping it changed all three held-out edits.
  if (written.subject_word === undefined && !written.subject && matchedSubject)
    written.subject_word = matchedSubject;
  const inferred = INFER.infer(written, map, index, BRIEF);
  // Words in, numbers out. An explicit key always beats the preset it came from.
  const brief = BRIEF.expand(written);
  // Semantic rows, if the set has them. Optional on purpose: a set without
  // them still works, it just cannot be selected by subject.
  const semPath = indexPath.replace(/INDEX\.json$/, "SEMANTIC.json");
  const sem = fs.existsSync(semPath)
    ? JSON.parse(fs.readFileSync(semPath, "utf8")) : null;
  const policy = POLICIES[policyId];
  if (!policy) { console.error("unknown policy " + policyId); process.exit(2); }

  const length = (map.song && map.song.length) ||
                 (map.beats && map.beats[map.beats.length - 1]) || 0;
  if (!length) { console.error("map has no length"); process.exit(2); }

  const ctx = {
    map: map, brief: brief, index: index, seed: seed, length_s: length,
    derive: DERIVE.make(map), slug: slug, briefId: briefId,
    intent: arg("intent", null),
    flatShots: arg("shots", null),
    sem: sem
  };

  // A window, for short form. The policy has ALREADY reasoned over the whole
  // song -- that is the argument of this project and it is not weakened here.
  // What changes is only how much of the result is exported. A four-minute
  // montage is not something anybody watches; a person asked whether they would
  // watch one on Instagram and the honest answer was no, and length was the
  // first reason of four.
  let from = arg("from", null) === null ? null : parseFloat(arg("from"));
  let to = arg("to", null) === null ? null : parseFloat(arg("to"));

  // --window <seconds> lets the MAP choose the excerpt instead of a person.
  // Slide a window over the candidate moments, take the one carrying the most
  // total strength, and start it on a downbeat so the excerpt begins where a
  // bar does. Picking it by ear would work too, and would be one more thing
  // tuned to one song by somebody who had already heard it.
  // `--window auto`, and how long a film SHOULD be.
  //
  // Every excerpt this lane has produced was some length a person typed. 26
  // seconds, for the 5C re-cut, because I picked 268 as an endpoint and never
  // went back -- and it was actively wrong: that film holds 30.6 s of usable
  // material, so a 26 s edit was never the constraint anybody thought it was.
  //
  // With the order preserved there is a defensible answer. The film is as long
  // as its footage lasts once through. Past that it must repeat, and repetition
  // is the thing that reads as a mistake. So `auto` asks the footage, and the
  // map still chooses WHERE that span sits in the song.
  let wantWin = arg("window", null) === null ? null : parseFloat(arg("window"));
  if (arg("window", null) === "auto" || (wantWin !== null && !isFinite(wantWin))) {
    const floorS = ((brief.budgets || {}).min_shot_s) || 0.5;
    const usable = (index.clips || []).reduce(function (acc, c) {
      return acc.concat((c.shots || []).filter(function (sh) {
        return sh.end - sh.start >= floorS; })); }, []);
    const material = usable.reduce(function (t, sh) { return t + (sh.end - sh.start); }, 0);
    wantWin = Math.max(6, Math.min(length, +material.toFixed(2)));
    console.error("window: " + wantWin.toFixed(1) + "s, the length of the footage " +
                  "once through (" + usable.length + " usable shots)");
  }
  // --arc frames a BUILD AND THE DROP IT LEADS INTO, rather than the busiest
  // window. Density is not shape: taking the thirty seconds with the most going
  // on guarantees thirty flat seconds, which is what "no build-up and eventual
  // climax" describes. A build span and the drop at its end is an arc the map
  // already found; this only frames it, putting the drop `arcAt` of the way
  // through so there is payoff left after it.
  const arcAt = arg("arc", null) === null ? null : parseFloat(arg("arc") || "0.68");
  if (wantWin && arcAt !== null && from === null && to === null) {
    const builds = (map.spans || []).filter(function (sp) { return sp.kind === "build"; });
    const drops = (map.moments || []).filter(function (m2) {
      return m2.kind === "drop" || m2.kind === "stop";
    });
    let best = null, bestScore = -1;
    for (const b of builds) {
      const d = drops.find(function (m2) {
        return m2.at >= b.to - 0.5 && m2.at <= b.to + 2.0;
      });
      if (!d) continue;
      const lead = Math.min(b.to - b.from, wantWin * arcAt);
      const score = lead * (d.size || 0.8);
      if (score > bestScore) { bestScore = score; best = { b: b, d: d }; }
    }
    if (best) {
      const downs2 = (map.downbeats && map.downbeats.length)
        ? map.downbeats : (map.beats || []);
      let st = Math.max(0, Math.min(best.d.at - wantWin * arcAt, length - wantWin));
      if (downs2.length) {
        st = downs2.reduce(function (a, c) {
          return Math.abs(c - st) < Math.abs(a - st) ? c : a;
        }, downs2[0]);
      }
      from = st;
      to = Math.min(length, st + wantWin);
      console.error(`arc: build ${best.b.from.toFixed(1)}-${best.b.to.toFixed(1)} ` +
                    `into ${best.d.kind}@${best.d.at.toFixed(2)}; window ` +
                    `${from.toFixed(2)}-${to.toFixed(2)}, drop at ` +
                    `${(100 * (best.d.at - from) / (to - from)).toFixed(0)}% through`);
    }
  }

  if (wantWin && from === null && to === null) {
    const RULES = POLICIES.rules;
    const cands = RULES.candidates(map, length, ctx.derive);
    const downs = (map.downbeats && map.downbeats.length)
      ? map.downbeats : (map.beats || []);
    let bestStart = 0, bestScore = -1;
    for (const d of downs) {
      if (d + wantWin > length) break;
      let sc = 0;
      for (const c of cands) {
        if (c.t >= d && c.t < d + wantWin) sc += c.strength;
      }
      // A small pull toward starting just before something big, so the excerpt
      // opens on a rise rather than in the middle of one.
      const lead = cands.find(function (c) {
        return c.t > d && c.t < d + 6 && c.strength >= 0.8;
      });
      if (lead) sc += 0.5;
      if (sc > bestScore) { bestScore = sc; bestStart = d; }
    }
    from = bestStart;
    to = Math.min(length, bestStart + wantWin);
    console.error(`window: ${from.toFixed(2)}s -> ${to.toFixed(2)}s ` +
                  `(strength ${bestScore.toFixed(2)}, chosen from the map)`);
  }

  // The window is known BEFORE the policy runs.
  //
  // It still decides WHERE to cut across the whole song -- that is the
  // look-ahead this project argues for and it is untouched. What changed is
  // footage ALLOCATION. Rationing 13 clips over 109 shots of a four-minute
  // song and then exporting thirty seconds meant the strongest shot in the set
  // had already been spent seven times and was over its reuse cap by the time
  // the climax arrived, so the drop got the weakest picture available. Footage
  // now goes to the slots that will actually be seen.
  if (from !== null || to !== null) {
    ctx.window = { from: from === null ? 0 : from, to: to === null ? length : to };
  }
  const r = policy.run(ctx);

  const ir = {
    ir: "0.1",
    made_by: {
      how: "policy", who: "readers/video/policy_" + policy.id + ".js",
      label: policy.label, brief: briefId,
      map: path.relative(ROOT, mp), seed: seed,
      index: path.relative(ROOT, indexPath),
      semantic: sem ? path.relative(ROOT, semPath) : null,
      // The render side of the recipe. render.py reads made_by.motion and
      // falls back to its own DEFAULTS when it is absent -- and it was ALWAYS
      // absent, so every brief rendered at effects_per_minute 7 whatever it
      // asked for. `effects: none` and `effects: loud` produced byte-identical
      // files, which is how three of six blind candidates came out with the
      // same md5. The effects word has been inert since it was written.
      motion: Object.assign({}, (brief.effects || {}),
                            (brief.render || {}))
    },
    song: { slug: slug, length_s: +length.toFixed(3) },
    // What the writer did not say, and what the system decided instead.
    inferred: inferred,
    format: brief.format,
    timeline: r.timeline,
    holds: r.holds,
    // Why the edit has the shape it has when the footage, not the music,
    // decided. Dropped silently by the first version of this assembly, which
    // made a policy that was recording its reasons look like one that was not.
    aligned_to_source: r.aligned_to_source || null,
    footage_cuts: r.footage_cuts || [],
    shots_too_short: r.shots_too_short || [],
    unfilled_slots: r.unfilled_slots || [],
    budget: r.budget
  };

  if (from !== null || to !== null) {
    let a = from === null ? 0 : from;
    const b = to === null ? length : to;
    // An excerpt begins where a cut begins.
    //
    // A window start lands wherever it lands, which is almost never on one of
    // the policy's edges, so the opening slot arrives as a fragment of whatever
    // shot was already running. On Holocene that was 0.81 s in front of a film
    // whose other shots run five and seven seconds -- against a brief asking
    // for 2.4 s minimum -- and it was the first thing a person watching it
    // said was wrong.
    //
    // The fold below cannot always rescue it: absorbing a fragment needs
    // footage before the next shot's in-point or after the first one's end, and
    // on Holocene neither existed. So do not make the fragment. Move the start
    // to the cut, and the audio moves with it, because render.py takes its
    // offset from this same window.
    if (from !== null) {
      const floorS = ((brief.budgets || {}).min_shot_s) || 0.5;
      const head = r.timeline.find(function (e) { return e.end > a && e.start <= a; });
      if (head && head.end - a < floorS && head.end < b) {
        ir.window_moved = { from: +a.toFixed(3), to: +head.end.toFixed(3),
          why: "starting here would have opened on a " +
               (head.end - a).toFixed(2) + "s fragment of a shot already "
               + "running, under the brief's " + floorS + "s minimum" };
        a = head.end;
      }
    }
    const kept = [];
    for (const e of ir.timeline) {
      if (e.end <= a + 1e-6 || e.start >= b - 1e-6) continue;
      const s0 = Math.max(e.start, a), e0 = Math.min(e.end, b);
      if (e0 - s0 < 0.12) continue;
      kept.push(Object.assign({}, e, {
        start: +(s0 - a).toFixed(3),
        end: +(e0 - a).toFixed(3),
        // The in-point moves with the trim so the same frames are shown.
        in_s: +(e.in_s + (s0 - e.start)).toFixed(3)
      }));
    }
    // Trimming to the window can clip the last entry to a stub. The policy
    // already folds runts, but it folds them in SONG time, before this cut --
    // which is why a 0.33 s tail survived a stated minimum of 0.55 s.
    const minShot = ((brief.budgets || {}).min_shot_s) || 0.5;
    // The FIRST entry, for the same reason as the last and with the same fix.
    // Trimming to a window clips the opening slot to wherever the window
    // starts, which has nothing to do with where the music wants a cut. On
    // Holocene it produced a 0.81 s flash in front of a film whose other shots
    // run five and seven seconds, against a brief asking for a 2.4 s minimum --
    // and that flash was the first thing a person watching it noticed.
    //
    // Absorb it into the shot after, which means that shot must start earlier
    // in its own source. Only if the footage goes back that far; otherwise the
    // runt is kept and says why, because an opening that jumps is better than
    // one that splices in a cut from somewhere else.
    if (kept.length > 1) {
      const first = kept[0], second = kept[1];
      if (first.end - first.start < minShot) {
        // Two ways to absorb it, and the footage decides which. Pull the
        // SECOND shot back to the window edge, which needs frames before its
        // in-point; or let the FIRST shot run over the second, which needs
        // frames after its own. Trying only the first way left the flash in
        // place on Holocene for want of 0.35 s.
        const shB = shotBounds(index, second.clip_id, second.shot);
        const back = second.in_s - (second.start - first.start);
        const shA = shotBounds(index, first.clip_id, first.shot);
        const need = first.in_s + (second.end - first.start);
        if (!shB || back >= shB.start - 1e-6) {
          second.start = first.start;
          second.in_s = +back.toFixed(3);
          kept.shift();
        } else if (!shA || need <= shA.end + 1e-6) {
          first.end = second.end;
          kept.splice(1, 1);
        } else {
          ir.runt_kept_head = { at: first.start,
            is_s: +(first.end - first.start).toFixed(3),
            why: "neither neighbour has the footage: pulling the next shot back " +
                 "needs " + (shB.start - back).toFixed(2) + "s before its in-point, " +
                 "and running the first one on needs " + (need - shA.end).toFixed(2) +
                 "s past the end of its shot" };
        }
      }
    }
    if (kept.length > 1) {
      const last = kept[kept.length - 1];
      const prev2 = kept[kept.length - 2];
      if (last.end - last.start < minShot) {
        // Folding GROWS the shot before it, and a shot cannot be grown past the
        // footage behind it. The first version of this fold just moved the end,
        // which pushed the previous shot 0.23 s beyond its source shot and put
        // one of the original editor's cuts inside it -- the runt was gone and
        // an uninvited cut had taken its place.
        const sh = shotBounds(index, prev2.clip_id, prev2.shot);
        const grown = prev2.in_s + (last.end - prev2.start);
        if (!sh || grown <= sh.end + 1e-6) {
          prev2.end = last.end;
          kept.pop();
        } else {
          ir.runt_kept = { at: last.start, is_s: +(last.end - last.start).toFixed(3),
            why: "folding it into the shot before would run that shot " +
                 (grown - sh.end).toFixed(2) + "s past the end of its source" };
        }
      }
    }
    ir.timeline = kept;
    ir.holds = (ir.holds || [])
      .filter(function (h) { return h.end > a && h.start < b; })
      .map(function (h) {
        return Object.assign({}, h, {
          start: +(Math.max(h.start, a) - a).toFixed(3),
          end: +(Math.min(h.end, b) - a).toFixed(3)
        });
      });
    ir.song.length_s = +(b - a).toFixed(3);
    ir.song.window = { from: +a.toFixed(3), to: +b.toFixed(3),
      note: "the policy reasoned over the whole song; this is an excerpt of the result" };
  }

  const out = arg("out");
  const text = JSON.stringify(ir, null, 1) + "\n";
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
    fs.writeFileSync(path.resolve(ROOT, out), text);
    const cuts = Math.max(0, ir.timeline.length - 1);
    console.error(`${slug} / ${briefId} / ${policy.id}: ${ir.timeline.length} shots, ` +
                  `${cuts} cuts (budget ${r.budget.allowed}), ${r.holds.length} holds -> ${out}`);
  } else {
    process.stdout.write(text);
  }
}
main();
