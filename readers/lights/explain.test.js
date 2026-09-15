/* explain.js -- the arranger's reasoning for one window, as the presets tab
   reads it. The doc must say what the plan did (same seed, same picks), keep
   only the window, and put honest odds on every candidate. Plain node idiom. */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const { explain, explainRecipe, listRecipes, effectsOf } = require("./explain.js");
const { plan } = require("./arranger.js");
const { enumerate } = require("./preflight.js");
const { format } = require("../../server/format/v1.js");
const MINI = require("./fixtures/mini_raw.js").RAW;

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

const RIG = { rig: "arc4-head", fixtures: [
  { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
  { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
  { id: "head", type: "head13" } ] };
const EN = enumerate(RIG);

/* ---- the window: bars 4-7 of the mini song, the start of its drop ------------ */
{
  const doc = explain(MINI(), { from: 4, bars: 4, seed: 42, layout: RIG, palette: [] });
  ok("the doc names the window in bars", doc.window.from_bar === 4 && doc.window.bars === 4 && doc.window.to_bar === 8);
  /* 120 bpm, first beat at 1.0 s, first_bar 0 = bar base: bar 4 beat 1 is beat 12 -> 7.0 s */
  ok("seconds come from the protocol clock as bake.js lays them", doc.window.starts_at_s === 7 && doc.window.ends_at_s === 15, `${doc.window.starts_at_s}..${doc.window.ends_at_s}`);
  /* the mini song's one drop is its last high section, so the arranger calls it the final drop */
  ok("one fact vector per bar in the window", doc.bars.length === 4 && doc.bars.every((b, i) => b.bar === 4 + i && b.form === "final_drop"), JSON.stringify(doc.bars.map(b => [b.bar, b.form, b.doing])));
  ok("the bars carry the facts the plan read (doing, presence, texture, harmony)", doc.bars[0].doing === "expanding" && doc.bars[0].presence.includes("drums:in") && Array.isArray(doc.bars[0].texture) && Array.isArray(doc.bars[0].harmony));
  ok("the bar with the entrance carries the moment fact", Array.isArray(doc.bars[0].moment) && doc.bars[0].moment.includes("entrance"), JSON.stringify(doc.bars[0].moment));
  ok("only the sections the window touches are listed", doc.sections.length === 1 && doc.sections[0].name === "drop" && doc.sections[0].context === "final_drop", JSON.stringify(doc.sections.map(s => [s.name, s.context])));
  const kinds = doc.draws.map(d => d.kind);
  ok("a PAR look, a head look and the entrance one-shot are drawn in the window", kinds.includes("par") && kinds.includes("head") && kinds.includes("oneshot"), kinds.join(","));
  const B = q => (q.bar - 1) * 4 + ((q.beat || 1) - 1);   /* the window is beats 12..28 */
  ok("every draw touches the window", doc.draws.every(d => B(d.from) < 28 && B(d.to) > 12), JSON.stringify(doc.draws.map(d => [d.kind, d.from_bar, d.to_bar])));
  ok("nothing from outside the window leaks in (the easing variation at bar 8, the outro at 16)", doc.draws.every(d => B(d.from) < 28) && !doc.draws.some(d => d.kind === "variation"), JSON.stringify(doc.draws.map(d => [d.kind, d.from_bar])));
  ok("every draw has a pool with the chosen sequence in it and odds summing to one",
     doc.draws.every(d => d.pool.length && d.pool.some(c => c.id === d.chosen.id) && Math.abs(d.pool.reduce((s, c) => s + c.odds, 0) - 1) < 0.01));
  ok("pool entries say what the sequence is and where it plays", doc.draws.every(d => d.pool.every(c => c.kind && c.boldness && c.where)));
  const shot = doc.draws.find(d => d.kind === "oneshot");
  ok("a one-shot draw names its moment and slot", shot && shot.moment === "entrance" && ["before", "on", "span"].includes(shot.slot) && shot.fx, shot && JSON.stringify([shot.moment, shot.slot, shot.fx]));
  ok("the base look carved around a variation is one draw, not several pieces", doc.draws.filter(d => d.kind === "par").length === 1);
  ok("fixed effects (no draw) are listed separately", Array.isArray(doc.fixed) && doc.fixed.every(f => f.type) && doc.fixed.some(f => f.type === "modulate"), JSON.stringify([...new Set(doc.fixed.map(f => f.type))]));
  ok("likely is sorted strongest first with probabilities in (0, 1]", doc.likely.length > 0 && doc.likely.every((l, i) => l.p > 0 && l.p <= 1 && (i === 0 || doc.likely[i - 1].p >= l.p)));
  ok("every sequence drawn at this seed is marked drawn in likely", doc.draws.every(d => doc.likely.find(l => l.id === d.chosen.id && l.drawn)));
  ok("a sequence in no pool is not in likely", doc.likely.every(l => doc.draws.some(d => d.pool.some(c => c.id === l.id))));
  ok("the plan is the bake's plan: the chosen looks match plan() at the same seed",
     (() => { const p = plan(MINI(), EN, 42); return doc.draws.every(d => p.assignments.some(a => a.seq_id === d.chosen.id && a.from.bar === d.from_bar)); })());
  ok("no clashes, and the doc says so", doc.clashes === 0, String(doc.clashes));
}

/* ---- the hub's view explains identically to the raw file ------------------- */
{
  const a = explain(MINI(), { from: 1, bars: 20, seed: 7, layout: RIG, palette: [] });
  const b = explain(format(MINI()), { from: 1, bars: 20, seed: 7, layout: RIG, palette: [] });
  ok("format_v1 and raw give the same explanation", JSON.stringify(a) === JSON.stringify(b));
}

/* ---- likely: a remembered look is certain; odds accumulate across draws ------- */
{
  const LEVELS = require("./fromscore.js").load();
  const doc = explain(LEVELS, { from: 1, bars: 200, seed: 7 });
  const rem = doc.draws.filter(d => d.remembered);
  ok("levels: remembered looks are reported as such", rem.length > 0, `${rem.length}`);
  ok("levels: a remembered look is certain in likely", rem.every(d => doc.likely.find(l => l.id === d.chosen.id).p === 1));
  const multi = doc.likely.find(l => l.draws > 1 && l.best < 1 && !rem.some(d => d.chosen.id === l.id));
  ok("levels: a sequence in several pools is likelier than its best single draw", multi && multi.p > multi.best, multi && `${multi.id} p ${multi.p} best ${multi.best} in ${multi.draws}`);
}

/* ---- recipes: the list, the effects under test, the errors ------------------- */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "explain-"));
  const fixture = path.join(__dirname, "..", "..", "protocol", "levels.score");
  fs.writeFileSync(path.join(tmp, "whole-levels.json"), JSON.stringify({ name: "whole-levels", song: "levels", tests: "does it escalate?", find: "whole-song", effects: ["escalates", "speed-rises", "something-new"] }));
  fs.writeFileSync(path.join(tmp, "nowhere.json"), JSON.stringify({ name: "nowhere", song: "no-such-song-xyz", find: "whole-song", effect: "glides" }));
  fs.writeFileSync(path.join(tmp, "bad-finder.json"), JSON.stringify({ name: "bad-finder", song: "levels", find: "nope" }));
  const rows = listRecipes(tmp);
  ok("listRecipes reads every recipe and says where its score is", rows.length === 3 && rows.find(r => r.name === "whole-levels").score_path && rows.find(r => r.name === "nowhere").score_path === null, JSON.stringify(rows.map(r => [r.name, !!r.score_path])));
  const fx = effectsOf({ effects: ["escalates", "something-new"] });
  ok("effects under test carry their measurement, or say there is none yet", fx[0].measure === "each return bigger than the last" && fx[1].measure === null);
  ok("a single `effect` is read like `effects`", effectsOf({ effect: "glides" }).length === 1 && effectsOf({ effect: "glides" })[0].check === "never-still");
  const doc = explainRecipe(JSON.parse(fs.readFileSync(path.join(tmp, "whole-levels.json"), "utf8")), { seed: 7, scorePath: fixture });
  ok("a recipe explains through its finder", !doc.error && doc.window.why === "the whole song" && doc.recipe.effects.length === 3 && doc.recipe.tests === "does it escalate?", doc.error || doc.window.why);
  ok("the default seed is the panel's import default (3)", explainRecipe({ name: "x", song: "levels", find: "whole-song" }, { scorePath: fixture }).seed === 3);
  const miss = explainRecipe(JSON.parse(fs.readFileSync(path.join(tmp, "nowhere.json"), "utf8")), {});
  ok("a song with no score here is an error the page can show, with the recipe attached", miss.error && /no score/.test(miss.error) && miss.recipe.effects[0].name === "glides");
  const bad = explainRecipe(JSON.parse(fs.readFileSync(path.join(tmp, "bad-finder.json"), "utf8")), { scorePath: fixture });
  ok("an unknown finder is an error, not a crash", bad.error && /no finder called "nope"/.test(bad.error), bad.error);
  /* the CLI, as the panel runs it */
  const run = a => execFileSync("node", [path.join(__dirname, "explain.js"), ...a], { encoding: "utf8", stdio: "pipe" });
  /* the CLI resolves the score itself (findScore), so compare with a module call that does too */
  const cli = JSON.parse(run([path.join(tmp, "whole-levels.json"), "--seed", "7", "--json"]));
  const viaModule = explainRecipe(JSON.parse(fs.readFileSync(path.join(tmp, "whole-levels.json"), "utf8")), { seed: 7 });
  ok("the CLI emits exactly the module's doc, whole, however large", JSON.stringify(cli) === JSON.stringify(viaModule) && cli.draws.length > 20, `${cli.draws.length} draws, ${JSON.stringify(cli).length} bytes`);
  const human = run([path.join(tmp, "whole-levels.json"), "--seed", "7"]);
  ok("the human report shows draws with odds and the likely list", /DRAWS/.test(human) && /LIKELY IN THIS WINDOW/.test(human) && /\d+%/.test(human));
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
