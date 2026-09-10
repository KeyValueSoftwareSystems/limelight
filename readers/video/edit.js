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

const POLICIES = {
  naive: require("./policy_naive.js"),
  rules: require("./policy_rules.js"),
  random: require("./policy_random.js"),
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

function main() {
  const slug = arg("slug");
  const briefId = arg("brief", "premium-restraint");
  const policyId = arg("policy", "rules");
  const seed = parseInt(arg("seed", "20260910"), 10);
  if (!slug) { console.error("--slug is required"); process.exit(2); }

  const mp = mapPath(slug);
  if (!mp) { console.error("no map for " + slug); process.exit(2); }
  const map = JSON.parse(fs.readFileSync(mp, "utf8"));
  const brief = JSON.parse(fs.readFileSync(
    path.join(ROOT, "briefs", briefId + ".json"), "utf8"));
  // A named clip set, or the default. Coherence lives here: a set is clips
  // from one world, and the chooser can only hold a world if it was given one.
  const setname = arg("set", null);
  const indexPath = arg("index", null) ||
    (setname ? path.join(ROOT, "assets", "stock", setname, "INDEX.json")
             : path.join(ROOT, "assets", "INDEX.json"));
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const policy = POLICIES[policyId];
  if (!policy) { console.error("unknown policy " + policyId); process.exit(2); }

  const length = (map.song && map.song.length) ||
                 (map.beats && map.beats[map.beats.length - 1]) || 0;
  if (!length) { console.error("map has no length"); process.exit(2); }

  const ctx = {
    map: map, brief: brief, index: index, seed: seed, length_s: length,
    derive: DERIVE.make(map), slug: slug, briefId: briefId,
    intent: arg("intent", null)
  };
  const r = policy.run(ctx);

  const ir = {
    ir: "0.1",
    made_by: {
      how: "policy", who: "readers/video/policy_" + policy.id + ".js",
      label: policy.label, brief: briefId,
      map: path.relative(ROOT, mp), seed: seed,
      index: path.relative(ROOT, indexPath)
    },
    song: { slug: slug, length_s: +length.toFixed(3) },
    format: brief.format,
    timeline: r.timeline,
    holds: r.holds,
    budget: r.budget
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
  const wantWin = arg("window", null) === null ? null : parseFloat(arg("window"));
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
  if (from !== null || to !== null) {
    const a = from === null ? 0 : from;
    const b = to === null ? length : to;
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
