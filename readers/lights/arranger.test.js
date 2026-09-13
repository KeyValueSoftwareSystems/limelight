/* Arranger tests -- a PAR look AND a head look for every section, with per-phase
   dynamics + drop-boundary blackout/blast. Pure in (score, seed). Plain node idiom. */
"use strict";
const { plan, energyReader } = require("./arranger.js");
const { enumerate } = require("./preflight.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

const RIG = { rig: "arc4-head", fixtures: [
  { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
  { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
  { id: "head", type: "head13" } ] };
const EN = enumerate(RIG);

const SCORE = {
  grid: { bpm: 120, first_beat_s: 0, beats_per_bar: 4, bars: 24 },
  sections: [
    { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, name: "steady" },
    { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: "building" },
    { from: { bar: 9, beat: 1 }, to: { bar: 13, beat: 1 }, name: "thinning out" },
    { from: { bar: 13, beat: 1 }, to: { bar: 17, beat: 1 }, name: "building" },
    { from: { bar: 17, beat: 1 }, to: { bar: 21, beat: 1 }, name: "steady" },
    { from: { bar: 21, beat: 1 }, to: { bar: 25, beat: 1 }, name: "thinning out" },
  ],
  energy: { per: "bar", from_bar: 1, values: [
    0.05, 0.06, 0.05, 0.07, 0.9, 0.85, 0.92, 0.88, 0.15, 0.12, 0.14, 0.13,
    0.4, 0.45, 0.5, 0.55, 0.95, 0.9, 0.97, 0.93, 0.2, 0.1, 0.08, 0.05] },
  parts: [{ from_bar: 13, to_bar: 16, feels: "building", rise: 0.2 }],
};

/* ---- the whole rig is alive: a PAR look AND a head look per section ------ */
{
  const p = plan(SCORE, EN, 42);
  const par = p.assignments.filter(a => a.layer === "par");
  const head = p.assignments.filter(a => a.layer === "head");
  ok("every section gets a PAR look", par.length === SCORE.sections.length, `${par.length}`);
  ok("every section gets a HEAD look", head.length === SCORE.sections.length, `${head.length}`);
  ok("every look names a sequence in the matrix",
     [...par, ...head].every(a => EN.matrix[a.seq_id]));
  ok("PAR looks carry phase dynamics (floor/peak/mode)",
     par.every(a => a.params.floor != null && a.params.peak != null && a.params.mode));
  ok("same (score, seed) yields an identical plan",
     JSON.stringify(plan(SCORE, EN, 42)) === JSON.stringify(plan(SCORE, EN, 42)));
}

/* ---- arc + contrast: final drop boldest, drops get blackout + blast ------ */
{
  const p = plan(SCORE, EN, 42);
  ok("contexts run intro .. final_drop .. outro",
     p.contexts[0] === "intro" && p.contexts.includes("final_drop") &&
     p.contexts[p.contexts.length - 1] === "outro", p.contexts.join(", "));
  const fd = p.assignments.find(a => a.layer === "par" && a.context === "final_drop");
  ok("the final drop's PAR look is boldest (intensity 1)", fd && fd.params.intensity === 1,
     fd && String(fd.params.intensity));
  ok("drops get a pre-drop blackout and a white blast",
     p.assignments.some(a => a.type === "blackout") && p.assignments.some(a => a.type === "white_blast"));
  const drop = p.assignments.find(a => a.layer === "par" && a.context === "drop");
  ok("a drop keeps a high floor (never dark between hits)", drop && drop.params.floor >= 0.5,
     drop && String(drop.params.floor));
  const intro = p.assignments.find(a => a.layer === "par" && a.context === "intro");
  ok("an intro breathes from a low floor", intro && intro.params.mode === "breathe" && intro.params.floor < 0.3);
}

/* ---- a different seed gives a different show ----------------------------- */
{
  const a = plan(SCORE, EN, 1).assignments.filter(x => x.layer === "par").map(x => x.seq_id).join(",");
  const b = plan(SCORE, EN, 999).assignments.filter(x => x.layer === "par").map(x => x.seq_id).join(",");
  ok("a different seed changes the PAR choices", a !== b, `${a}\n     ${b}`);
}

/* ---- the real levels score (smoke) -------------------------------------- */
{
  const LEVELS = require("./fromscore.js").load();
  const layout = require("./arc4-head.layout.json");
  const palette = require("./arc4-head.palette.json");
  const FULL = enumerate(layout, { palette });
  const p = plan(LEVELS, FULL, 7);
  const covered = layer => LEVELS.sections.every(sec =>
    p.assignments.some(a => a.layer === layer && a.seq_id && a.from.bar >= sec.from.bar && a.from.bar < sec.to.bar));
  ok("levels: every section has a PAR and a HEAD look", covered("par") && covered("head"));
  const fd = p.assignments.find(a => a.layer === "par" && a.context === "final_drop");
  ok("levels: the final drop's PAR look is boldest", fd && fd.params.intensity === 1);
}

/* ---- energy anchored at bar 0 is read at bar 0, not a bar late ----------- */
{
  // {from_bar: 0, values} -- the shape that made `from_bar || 1` misread bar 0.
  const er = energyReader({ energy: { per: "bar", from_bar: 0, values: [0.1, 0.2, 0.3] } });
  ok("0-based energy reads bar 1 as values[1] (not a bar late)", er(1) === 0.2, `${er(1)}`);
  ok("0-based energy reads bar 2 as values[2]", er(2) === 0.3, `${er(2)}`);
}

/* ---- format_v1 shape: rise embedded on the section, no top-level parts ----
   The score endpoint (format_v1) drops the top-level `parts` array and carries
   `rise` on each section instead. The build context must come from sec.rise. */
{
  const S = {
    grid: { bpm: 120, first_beat_s: 0, beats_per_bar: 4, bars: 16 },
    sections: [
      { from: { bar: 1, beat: 1 },  to: { bar: 5, beat: 1 },  name: "opening" },
      { from: { bar: 5, beat: 1 },  to: { bar: 9, beat: 1 },  name: "rising", rise: 0.2 },
      { from: { bar: 9, beat: 1 },  to: { bar: 13, beat: 1 }, name: "steady" },
      { from: { bar: 13, beat: 1 }, to: { bar: 17, beat: 1 }, name: "peak" },
    ],
    energy: { per: "bar", from_bar: 1, values: [
      0.05, 0.05, 0.05, 0.05, 0.30, 0.32, 0.31, 0.33,
      0.30, 0.30, 0.30, 0.30, 0.90, 0.90, 0.90, 0.90] },
    // no `parts` -- exactly what the score endpoint returns
  };
  const p = plan(S, EN, 42);
  ok("format_v1: an embedded section rise drives the build context (no parts array)",
     p.contexts[1] === "build", p.contexts.join(", "));
}


/* =========================================================================
   The full structure of a score: subsections, moments, texture lanes, harmony.
   ========================================================================= */
const { clashes } = require("./arranger.js");
const { format } = require("../../server/format/v1.js");
const MINI = require("./fixtures/mini_raw.js").RAW();
const bpb4 = p => (p.bar - 1) * 4 + ((p.beat || 1) - 1);
const within = (a, sec) => bpb4(a.from) >= bpb4(sec.from) && bpb4(a.to) <= bpb4(sec.to);

/* ---- subsections: a long section is several looks, not one ---------------- */
{
  const p = plan(MINI, EN, 42);
  const drop = p.sections ? p.sections[1] : { from: { bar: 4, beat: 1 }, to: { bar: 16, beat: 1 } };
  const pars = p.assignments.filter(a => a.layer === "par" && a.seq_id && within(a, drop));
  const looks = new Set(pars.map(a => a.seq_id));
  ok("a 12-bar drop with three subsections carries more than one PAR look",
     looks.size >= 2, [...looks].join(", "));
  ok("the drop's first subsection keeps the base look (the section's identity)",
     pars.some(a => a.from.bar === 4 && !a.variation));
  ok("an easing subsection with a break gets its own look at its exact bars",
     pars.some(a => a.variation && a.from.bar === 8 && a.to.bar === 12), JSON.stringify(pars.map(a => [a.from.bar, a.to.bar, a.seq_id, !!a.variation])));
  ok("a variation is a different sequence from the base it interrupts",
     pars.filter(a => a.variation).every(v => !pars.some(b => !b.variation && b.seq_id === v.seq_id)));
  const intro = p.assignments.filter(a => a.layer === "par" && a.seq_id && a.from.bar < 4);
  ok("a section with one subsection keeps exactly one PAR look", intro.length === 1, `${intro.length}`);
  ok("every subsection is represented by a modulation over its span",
     p.assignments.filter(a => a.type === "modulate").length === 5);
  ok("no two concurrent sequence assignments share a fixture attribute", clashes(p) === 0, `${clashes(p)}`);
  ok("the head keeps one continuous look per section (continuity)",
     p.assignments.filter(a => a.layer === "head" && a.seq_id && within(a, drop)).length === 1);
}

/* ---- moments punctuate at their exact bar/beat, scaled by weight ----------- */
{
  const p = plan(MINI, EN, 42);
  const blast = p.assignments.find(a => a.type === "white_blast");
  ok("a heavy entrance (weight .97) blasts on its exact bar/beat",
     blast && blast.from.bar === 4 && blast.from.beat === 1 && blast.to.bar === 4 && blast.to.beat === 2, JSON.stringify(blast));
  ok("the blast carries the moment's weight as its strength", blast && blast.params.strength === 0.97);
  const black = p.assignments.find(a => a.type === "blackout");
  ok("a heavy entrance holds its breath on the beat before", black && black.from.bar === 3 && black.from.beat === 4 && black.to.bar === 4 && black.to.beat === 1, JSON.stringify(black));
  ok("no fabricated drop-boundary blackout/blast when the score has moments",
     p.assignments.filter(a => a.type === "white_blast").length === 1 && p.assignments.filter(a => a.type === "blackout").length === 1);
  const pause = p.assignments.find(a => a.type === "pause");
  ok("a pause spans exactly its for_beats from its bar/beat",
     pause && pause.from.bar === 8 && pause.from.beat === 3 && pause.to.bar === 9 && pause.to.beat === 3, JSON.stringify(pause));
  ok("a pause carries its weight and what is still playing", pause && pause.params.strength === 0.5 && pause.params.still[0] === "bass");
  const hook = p.assignments.find(a => a.type === "hook");
  ok("a hook spans its for_beats", hook && hook.from.bar === 6 && hook.to.bar === 8 && hook.params.strength === 0.7, JSON.stringify(hook));
  const light = plan({ ...MINI, moments: [{ bar: 12, beat: 1, is: "accent", what: "the band", weight: 0.4 }] }, EN, 42);
  const lb = light.assignments.find(a => a.type === "white_blast");
  ok("a light moment (weight .4) flashes but does not hold its breath",
     lb && lb.params.strength === 0.4 && !light.assignments.some(a => a.type === "blackout"));
  const noise = plan({ ...MINI, moments: [{ bar: 12, beat: 1, is: "change", what: "narrows", weight: 0.1 }] }, EN, 42);
  ok("a negligible moment (weight .1) is ignored", !noise.assignments.some(a => a.type === "white_blast"));
}

/* ---- texture lanes and harmony ride in the plan, per bar --------------------- */
{
  const p = plan(MINI, EN, 42);
  ok("the plan carries normalised texture lanes anchored at the first bar",
     p.lanes && p.lanes.from_bar === 0 && ["width", "pump", "pace", "brightness", "air"].every(k => Array.isArray(p.lanes[k]) && p.lanes[k].length === 20));
  ok("lane values are 0..1 or null", ["width", "pump", "pace"].every(k => p.lanes[k].every(v => v === null || (v >= 0 && v <= 1))));
  ok("a null bar stays null in the plan", p.lanes.brightness[19] === null);
  ok("the plan carries per-bar presence from the stem lanes (drums drop out at bar 9)",
     p.lanes.drums && p.lanes.drums[9] < 0.3 && p.lanes.drums[8] > 0.5);
  ok("the plan carries a per-bar harmony hue", p.harmony && p.harmony.from_bar === 0 && p.harmony.hue.length === 20 && p.harmony.hue[19] === null);
  ok("neighbouring bars with different chords get different hues", p.harmony.hue[4] !== p.harmony.hue[5]);
  ok("a minor chord is flagged", p.harmony.minor[0] === true && p.harmony.minor[5] === false);
  const q = plan(MINI, EN, 999);
  const hueA = p.assignments.find(a => a.layer === "par").params.hue, hueB = q.assignments.find(a => a.layer === "par").params.hue;
  ok("the base hue comes from the key, so it does not change with the seed", hueA === hueB && hueA === p.harmony.key.hue, `${hueA} ${hueB}`);
  const bare = plan(SCORE, EN, 1), bare2 = plan(SCORE, EN, 2);
  ok("without harmony the hue is still seeded (today's behaviour)",
     bare.assignments.find(a => a.layer === "par").params.hue !== bare2.assignments.find(a => a.layer === "par").params.hue);
  ok("a score without lanes or chords has no texture lanes or harmony (only growth from its rise)",
     !bare.harmony && (!bare.lanes || Object.keys(bare.lanes).every(k => k === "from_bar" || k === "grow")));
}

/* ---- the raw score and its format_v1 view plan identically ------------------ */
{
  const a = plan(MINI, EN, 42), b = plan(format(require("./fixtures/mini_raw.js").RAW()), EN, 42);
  ok("format_v1 and raw shapes give byte-identical plans", JSON.stringify(a) === JSON.stringify(b));
  ok("the rich plan is still deterministic", JSON.stringify(plan(MINI, EN, 42)) === JSON.stringify(a));
  ok("a different seed still changes the rich plan", JSON.stringify(plan(MINI, EN, 7)) !== JSON.stringify(a));
}

/* ---- levels, the real score: sections vary inside, moments land exactly ------ */
{
  const LEVELS = require("./fromscore.js").load();
  const FULL = enumerate(require("./arc4-head.layout.json"), { palette: require("./arc4-head.palette.json") });
  const p = plan(LEVELS, FULL, 3);
  const firstDrop = LEVELS.sections.find(s => s.name === "drop");
  const looks = new Set(p.assignments.filter(a => a.layer === "par" && a.seq_id && within(a, firstDrop)).map(a => a.seq_id));
  ok("levels: the first drop (16 bars) holds several distinct PAR looks", looks.size >= 2, [...looks].join(", "));
  const pause = p.assignments.find(a => a.type === "pause");
  ok("levels: the bar-51 pause lands at bar 51 beat 1 for 8 beats",
     pause && pause.from.bar === 51 && pause.from.beat === 1 && pause.to.bar === 53 && pause.to.beat === 1, JSON.stringify(pause));
  ok("levels: the bar-9 drums entrance blasts at bar 9 beat 1",
     p.assignments.some(a => a.type === "white_blast" && a.from.bar === 9 && a.from.beat === 1));
  ok("levels: no concurrent sequence assignments clash on a fixture attribute", clashes(p) === 0, `${clashes(p)}`);
  ok("levels: harmony hue follows the chord bar by bar (C#m / A alternate in the drop)",
     p.harmony && p.harmony.hue[9] !== p.harmony.hue[10] && p.harmony.hue[9] === p.harmony.hue[11]);
}


/* ---- pace -> subdivision: half / normal / double time, per subsection ---------- */
{
  const M2 = require("./fixtures/mini_raw.js").RAW();
  /* intro lazy, drop busy (4-7), ordinary (8-11), busy again (12-15), outro lazy */
  M2.bars.pace = [0.2, 0.2, 0.2, 0.2, 1.8, 1.9, 1.8, 1.7, 1.0, 1.1, 0.9, 1.0, 1.8, 1.8, 1.9, 1.8, 0.1, 0.1, 0.1, 0.1];
  const p = plan(M2, EN, 42);
  const sd = p.lanes && p.lanes.subdiv;
  ok("the plan carries a per-bar subdivision from the pace lane", Array.isArray(sd) && sd.length === 20, JSON.stringify(sd));
  ok("a lazy intro runs at half time", sd && sd[0] === 0.5 && sd[3] === 0.5);
  ok("a busy drop subsection runs at double time", sd && sd[4] === 2 && sd[7] === 2);
  ok("an ordinary subsection runs at normal time", sd && sd[8] === 1 && sd[11] === 1);
  ok("the speed changes only at subsection boundaries (constant within one)",
     sd && sd.slice(4, 8).every(v => v === 2) && sd.slice(8, 12).every(v => v === 1) && sd.slice(12, 16).every(v => v === 2));
  ok("a lazy outro runs at half time", sd && sd[16] === 0.5);
  const drop = p.assignments.find(a => a.layer === "par" && a.from.bar === 4);
  ok("a section's rate param is its subdivision (no longer a seeded draw)",
     drop && drop.params.rate === 2 && plan(M2, EN, 7).assignments.find(a => a.layer === "par" && a.from.bar === 4).params.rate === 2, drop && String(drop.params.rate));
  /* context clamps */
  const M3 = require("./fixtures/mini_raw.js").RAW();
  M3.bars.pace = [3, 3, 3, 3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 3, 3, 3, 3];
  const q = ((plan(M3, EN, 42).lanes || {}).subdiv) || [];
  ok("an intro never runs at double time, however busy", q[0] === 1, `${q[0]}`);
  ok("a drop never drops to half time, however sparse", q[4] === 1 && q[8] === 1, `${q[4]}`);
  /* absence */
  const M4 = require("./fixtures/mini_raw.js").RAW(); delete M4.bars.pace;
  ok("without a pace lane there is no subdivision (today's timing)", !plan(M4, EN, 42).lanes.subdiv);
  ok("format_v1 and raw still plan identically with pace", JSON.stringify(plan(M2, EN, 42)) === JSON.stringify(plan(format(JSON.parse(JSON.stringify(M2))), EN, 42)));
}

/* ---- facts: one context vector per bar, from the score alone ------------------ */
{
  const p = plan(MINI, EN, 42);
  const F = p.facts;
  ok("the plan carries facts anchored at the first bar", F && F.from_bar === 0 && Array.isArray(F.vectors) && F.vectors.length === 20, F && `${F.from_bar} x ${F.vectors.length}`);
  const v4 = F.vectors[4], v9 = F.vectors[9], v0 = F.vectors[0];
  ok("form comes from the section's context", v0.form === "intro" && v4.form === "final_drop" && F.vectors[16].form === "outro");
  ok("doing comes from the subsection covering the bar", v4.doing === "expanding" && F.vectors[8].doing === "easing" && F.vectors[12].doing === "peaking");
  ok("presence reads the stem lanes against the 0.3 threshold",
     v4.presence.includes("drums:in") && v4.presence.includes("bass:in") && v4.presence.includes("vocals:out") && v9.presence.includes("drums:out"), JSON.stringify(v9.presence));
  ok("texture bands read the normalised lanes (drop bars are narrow, busy, bright)",
     ["narrow", "busy", "bright"].every(t => v4.texture.includes(t)), JSON.stringify(v4.texture));
  ok("harmony reads minor/major and marks a change (Am->Am at bar 1 does not change; Am->C at bar 5 does)",
     v4.harmony.includes("minor") && F.vectors[5].harmony.includes("major") && F.vectors[5].harmony.includes("changing") && !F.vectors[1].harmony.includes("changing"), JSON.stringify([F.vectors[1].harmony, F.vectors[5].harmony]));
  ok("a moment lands on its bar with its weight band", v4.moment && v4.moment.includes("entrance") && v4.moment.includes("heavy") && F.vectors[8].moment.includes("pause") && F.vectors[8].moment.includes("firm"), JSON.stringify([v4.moment, F.vectors[8].moment]));
  ok("bars with no moment carry no moment family", F.vectors[1].moment === undefined);
  ok("a null lane bar says nothing in that band", !F.vectors[19].texture.some(t => t === "dull" || t === "bright"));
  /* a bare score: form only, so picks cannot move */
  const bare = plan(SCORE, EN, 42);
  ok("a score without the richer fields (no subsection layer at all) stays silent on every family but form",
     bare.facts.vectors.every(v => v === null || Object.keys(v).join(",") === "form"));
  ok("facts are identical for the raw score and its format_v1 view",
     JSON.stringify(plan(format(require("./fixtures/mini_raw.js").RAW()), EN, 42).facts) === JSON.stringify(F));
}

/* ---- picks are made with vectors and say so ---------------------------------- */
{
  const { majorityVector } = require("./arranger.js");
  const vs = [
    { form: "drop", doing: "expanding", presence: ["drums:in", "bass:in"], texture: ["busy"], harmony: ["minor"] },
    { form: "drop", doing: "expanding", presence: ["drums:in", "bass:out"], texture: ["busy", "narrow"], harmony: ["major", "changing"] },
    { form: "drop", doing: "easing", presence: ["drums:out", "bass:out"], texture: ["sparse"], harmony: ["minor"] },
  ];
  const m = majorityVector(vs, 0, 3, "drop");
  ok("the majority doing wins", m.doing === "expanding", m.doing);
  /* final review, Finding 1: a plurality is not a majority. A span whose bars do
     three (or four) things in turn is not doing one of them -- it stays silent on
     the family rather than letting an alphabetical tie-break reweight the draw. */
  const vsTie = [
    { form: "drop", doing: "expanding" }, { form: "drop", doing: "easing" }, { form: "drop", doing: "peaking" },
  ];
  const tie = majorityVector(vsTie, 0, 3, "drop");
  ok("a span with no majority doing stays silent on the family", !("doing" in tie), JSON.stringify(tie));
  ok("presence is decided per stem by majority", m.presence.includes("drums:in") && m.presence.includes("bass:out") && m.presence.length === 2, JSON.stringify(m.presence));
  ok("a texture band needs more than half the bars", m.texture.includes("busy") && !m.texture.includes("narrow") && !m.texture.includes("sparse"), JSON.stringify(m.texture));
  ok("harmony keeps the majority mode and never 'changing'", JSON.stringify(m.harmony) === JSON.stringify(["minor"]));
  ok("a doing override is honoured (a subsection's own word)", majorityVector(vs, 0, 3, "drop", "peaking").doing === "peaking");
  ok("a moment never belongs to a span vector", m.moment === undefined);
  /* Task 7 review, item 3: a span mixing a vector that carries harmony with one
     that doesn't must not throw, and still yields the majority mode */
  const vsMixed = [{ form: "drop", harmony: ["minor"] }, { form: "drop" }, { form: "drop", harmony: ["minor"] }];
  let mixed;
  try { mixed = majorityVector(vsMixed, 0, 3, "drop"); } catch (e) { mixed = e; }
  ok("a span mixing a vector with harmony and one without does not throw",
     !(mixed instanceof Error), mixed instanceof Error ? mixed.message : "");
  ok("...and yields the majority mode", !(mixed instanceof Error) && JSON.stringify(mixed.harmony) === JSON.stringify(["minor"]));

  const p = plan(MINI, EN, 42);
  const base = p.assignments.find(a => a.layer === "par" && a.seq_id && a.from.bar === 4 && !a.variation);
  /* MINI's one high-energy section is also its last, so its context is final_drop.
     Its bars 4-15 do expanding/easing/peaking four bars each -- a three-way tie, so
     the section vector says nothing about doing and the pick rests on the rest. */
  ok("a base look carries the vector it was chosen with",
     base && base.facts && base.facts.form === "final_drop" && !("doing" in base.facts) && Array.isArray(base.facts.presence),
     JSON.stringify(base && base.facts));
  const vari = p.assignments.find(a => a.layer === "par" && a.variation && a.from.bar === 8);
  ok("a variation carries its own subsection's vector", vari && vari.facts.doing === "easing" && vari.facts.form === "final_drop", JSON.stringify(vari && vari.facts));
  ok("variations no longer step a context (no vcontext)", p.assignments.every(a => a.vcontext === undefined));
  const head = p.assignments.find(a => a.layer === "head" && a.from.bar === 4);
  ok("the head look carries the section vector too",
     head && head.facts && head.facts.form === "final_drop" && !("doing" in head.facts), JSON.stringify(head && head.facts));
  ok("a plain score's looks carry form-only vectors (no subsection layer, so no doing)",
     plan(SCORE, EN, 42).assignments.filter(a => a.seq_id).every(a => a.facts && Object.keys(a.facts).join(",") === "form"));
  ok("no clashes with vector picks", clashes(p) === 0, `${clashes(p)}`);
  ok("the rich plan is still deterministic", JSON.stringify(plan(MINI, EN, 42)) === JSON.stringify(p));

  /* facts read from the score must be vocabulary words (Task 6 review) */
  const MINI2 = require("./fixtures/mini_raw.js").RAW();
  MINI2.phrases[1].doing = "grooving";
  ok("a doing word outside the vocabulary falls back to holding",
     plan(MINI2, EN, 42).facts.vectors[4].doing === "holding", plan(MINI2, EN, 42).facts.vectors[4].doing);

  /* Task 7 review, Finding 1: a bare score's picks must not move against the
     form-string path -- "doing" is a fact family only when the score has a
     subsection layer at all; a score that cannot speak to it stays silent. */
  const EN0 = { sequences: EN.sequences, matrix: EN.matrix };   /* an old-shape cache: view scores form-only */
  const picksOf = pl => pl.assignments.filter(a => a.seq_id).map(a => a.layer + ":" + a.seq_id).join(",");
  for (const seed of [1, 42])
    ok(`a score without richer fields draws exactly the picks the form string gave (seed ${seed})`,
       picksOf(plan(SCORE, EN0, seed)) === picksOf(plan(SCORE, EN, seed)),
       `${picksOf(plan(SCORE, EN0, seed))}\n     ${picksOf(plan(SCORE, EN, seed))}`);

  /* Task 7 review, Finding 2: an unknown doing word must not reach wantsOwn/subVector
     unfiltered -- it is silence ("holding"), not a fact worth its own look or a
     published vocabulary violation. */
  const MINI3 = require("./fixtures/mini_raw.js").RAW();
  MINI3.phrases[3].doing = "grooving";   /* bars 12-15 */
  const p3 = plan(MINI3, EN, 42);
  ok("an unknown doing word never surfaces in a variation's facts",
     !p3.assignments.some(a => a.facts && a.facts.doing === "grooving"));
  const vari3 = p3.assignments.find(a => a.layer === "par" && a.variation && a.from.bar === 12);
  ok("a variation drawn at that subsection's bars carries 'holding', not the unknown word",
     !vari3 || vari3.facts.doing === "holding", vari3 && vari3.facts.doing);
}


/* ---- phase B: moments draw one-shots from the matrix; old caches keep the fixed fx -- */
{
  const p = plan(MINI, EN, 42);
  const blast = p.assignments.find(a => a.type === "white_blast");
  ok("the heavy entrance is a matrix-chosen one-shot (impact) at its exact bar/beat",
     blast && blast.seq_id === "impact" && blast.from.bar === 4 && blast.from.beat === 1 && blast.params.strength === 0.97, JSON.stringify(blast));
  const black = p.assignments.find(a => a.type === "blackout");
  ok("its breath is a one-shot the beat before", black && black.seq_id === "breath" && black.from.bar === 3 && black.from.beat === 4, JSON.stringify(black));
  const pause = p.assignments.find(a => a.type === "pause");
  ok("the pause is the hush one-shot for its for_beats", pause && pause.seq_id === "hush" && pause.from.bar === 8 && pause.to.bar === 9 && pause.to.beat === 3 && pause.params.still[0] === "bass", JSON.stringify(pause));
  const hook = p.assignments.find(a => a.type === "hook");
  ok("the hook is the hook_lift one-shot", hook && hook.seq_id === "hook_lift" && hook.from.bar === 6 && hook.to.bar === 8, JSON.stringify(hook));
  ok("a one-shot carries the moment vector it was chosen with", blast && blast.facts && blast.facts.moment && blast.facts.moment.includes("entrance") && blast.facts.moment.includes("heavy"));
  /* the same rich cache with the one-shots removed: the looks must not move */
  const old = plan(MINI, { ...EN, sequences: EN.sequences.filter(s => s.kind !== "oneshot") }, 42);
  const ob = old.assignments.find(a => a.type === "white_blast");
  ok("without one-shots in the cache the fixed effects still fire", ob && !ob.seq_id && ob.from.bar === 4 && old.assignments.some(a => a.type === "pause" && !a.seq_id));
  const legacy = plan(MINI, { sequences: EN.sequences.filter(s => s.kind !== "oneshot"), matrix: EN.matrix }, 42);
  ok("an old-shape cache (form only) still fires the fixed effects too", legacy.assignments.some(a => a.type === "white_blast" && !a.seq_id));
  ok("one-shots do not move the section picks (same seed, same looks)",
     JSON.stringify(p.assignments.filter(a => a.layer === "par" || a.layer === "head").map(a => a.seq_id)) === JSON.stringify(old.assignments.filter(a => a.layer === "par" || a.layer === "head").map(a => a.seq_id)));
  ok("still no clashes", clashes(p) === 0);
}


/* ---- memory: repeated material gets its look back ------------------------------ */
{
  const R = {
    grid: { bpm: 120, first_beat_s: 0, beats_per_bar: 4, bars: 24 },
    sections: [
      { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, name: "verse", like: "A" },
      { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: "drop", like: "B", repeat: "B" },
      { from: { bar: 9, beat: 1 }, to: { bar: 13, beat: 1 }, name: "verse", like: "A", repeat: "A" },
      { from: { bar: 13, beat: 1 }, to: { bar: 17, beat: 1 }, name: "drop", like: "B", repeat: "B" },
      { from: { bar: 17, beat: 1 }, to: { bar: 21, beat: 1 }, name: "bridge", like: "C" },
      { from: { bar: 21, beat: 1 }, to: { bar: 25, beat: 1 }, name: "drop", like: "B", repeat: "B" },
    ],
    energy: { per: "bar", from_bar: 1, values: [0.3, 0.3, 0.3, 0.3, 0.9, 0.9, 0.9, 0.9, 0.3, 0.3, 0.3, 0.3, 0.9, 0.9, 0.9, 0.9, 0.4, 0.4, 0.4, 0.4, 0.95, 0.95, 0.95, 0.95] },
  };
  const p = plan(R, EN, 5);
  const look = (bar, layer) => p.assignments.find(a => a.layer === layer && a.seq_id && a.from.bar === bar);
  ok("the second drop wears the first drop's PAR look", look(13, "par").seq_id === look(5, "par").seq_id, `${look(5, "par").seq_id} vs ${look(13, "par").seq_id}`);
  ok("and the same head look", look(13, "head").seq_id === look(5, "head").seq_id);
  ok("the final drop keeps the drop's look too (bolder dynamics, same pattern)", look(21, "par").seq_id === look(5, "par").seq_id && look(21, "par").params.intensity >= look(5, "par").params.intensity);
  ok("the returning verse wears the first verse's look", look(9, "par").seq_id === look(1, "par").seq_id);
  ok("the bridge, new material, is its own draw (memory keyed by the score's like label)", look(17, "par").facts.form && look(17, "par").remembered === undefined);
  ok("a repeat says so", look(13, "par").remembered === "B");
  ok("memory is deterministic", JSON.stringify(plan(R, EN, 5)) === JSON.stringify(p));
  const LEVELS = require("./fromscore.js").load();
  const FULL = enumerate(require("./arc4-head.layout.json"), { palette: require("./arc4-head.palette.json") });
  const q = plan(LEVELS, FULL, 3);
  const drops = LEVELS.sections.filter(s => s.name === "drop");
  const dropLooks = new Set(drops.map(d => q.assignments.find(a => a.layer === "par" && a.seq_id && !a.variation && a.from.bar === d.from.bar).seq_id));
  ok("levels: the three drops share one base PAR look", dropLooks.size === 1, [...dropLooks].join(","));
}

/* ---- growth: a section rises across itself; tension rides per beat --------------- */
{
  const p = plan(MINI, EN, 42);
  ok("the plan carries the per-beat tension, normalised", p.tension && p.tension.from_bar === 0 && p.tension.values.length === 80 && p.tension.values.every(v => v === null || (v >= 0 && v <= 1)));
  ok("a rising section grows: its grow lane climbs from start to end", p.lanes.grow && p.lanes.grow[4] < p.lanes.grow[15], `${p.lanes.grow[4]} -> ${p.lanes.grow[15]}`);
  ok("a falling section (outro, rise -0.3) sinks", p.lanes.grow[16] > p.lanes.grow[19]);
  ok("a flat section sits at the middle", p.lanes.grow[0] === 0.5 && p.lanes.grow[3] === 0.5);
  ok("format_v1 carries the same tension and growth", JSON.stringify(plan(format(require("./fixtures/mini_raw.js").RAW()), EN, 42)) === JSON.stringify(p));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
