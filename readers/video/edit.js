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
  const index = JSON.parse(fs.readFileSync(
    path.join(ROOT, "assets", "INDEX.json"), "utf8"));
  const policy = POLICIES[policyId];
  if (!policy) { console.error("unknown policy " + policyId); process.exit(2); }

  const length = (map.song && map.song.length) ||
                 (map.beats && map.beats[map.beats.length - 1]) || 0;
  if (!length) { console.error("map has no length"); process.exit(2); }

  const ctx = {
    map: map, brief: brief, index: index, seed: seed, length_s: length,
    derive: DERIVE.make(map), slug: slug,
    intent: arg("intent", null)
  };
  const r = policy.run(ctx);

  const ir = {
    ir: "0.1",
    made_by: {
      how: "policy", who: "readers/video/policy_" + policy.id + ".js",
      label: policy.label, brief: briefId,
      map: path.relative(ROOT, mp), seed: seed,
      index: "assets/INDEX.json"
    },
    song: { slug: slug, length_s: +length.toFixed(3) },
    format: brief.format,
    timeline: r.timeline,
    holds: r.holds,
    budget: r.budget
  };
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
