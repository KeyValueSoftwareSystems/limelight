"use strict";
/* frame(position, plan, ctx) -> FRAME : the per-fixture picture at one musical instant.
   ---------------------------------------------------------------------------
   The plan says which SEQUENCES are active over which spans; frame turns the active
   ones into device-agnostic INTENTS per fixture and composes overlaps. It is a PURE
   function of (position, plan) -- no wall time -- so it scrubs, late-joins, and
   golden-frame tests, and tempo never perturbs it (the transport owns rate).

   Timing is locked to the MUSICAL beat, not to the gesture's own `at` units (those
   are loose across the LLM palette, and beat-locked lighting reads better anyway):
   a gesture declares WHAT (group, colours, pattern); frame decides WHEN from the
   beat. Intents are device-agnostic (par colour = [r,g,b]; head colour = a wheel
   name; level/pan/tilt/strobe/gobo/prism/spin); the drivers turn them into channels.
   The display gamma is applied later, at the wire, exactly once. */
const { groupsOf } = require("./preflight.js");

function resolveGroups(layout) {
  const g = groupsOf(layout);
  const ids = a => a.map(f => f.id);
  return { all_pars: ids(g.pars), inner: ids(g.inner), outer: ids(g.outer),
           arc: ids(g.arc), head: ids(g.movers), movers: ids(g.movers),
           strobers: ids(g.strobers) };
}

const scaleLevel = (intent, k) => {
  const o = {};
  for (const key of Object.keys(intent || {})) o[key] = intent[key];
  if (o.level != null) o.level = +(o.level * k).toFixed(3);
  return o;
};

/* one individual gesture -> { fixtureId: intent }, at musical phase `ph` */
function renderIndividual(gesture, ph, groups, k) {
  const out = {};
  const keys = gesture.keys || [];
  const target = groups[gesture.group] || [];

  /* the moving head: any head gesture (move, colour, gobo, prism, spin). Merge the
     keys' intents, animate pan across the bar if it has a range, and carry every
     head attribute through -- never drop gobo/prism/spin. */
  if (gesture.group === "head") {
    const merged = {};
    for (const x of keys) Object.assign(merged, x.intent || {});
    const pans = keys.map(x => x.intent && x.intent.pan).filter(v => v != null);
    const intent = {};
    for (const kk of ["colour", "gobo", "prism", "spin", "tilt"]) if (merged[kk] != null) intent[kk] = merged[kk];
    if (intent.colour === "spin") { intent.spin = true; delete intent.colour; }   // a spin, not a slot
    if (pans.length > 1) { const tri = Math.abs(((ph.phaseInBar * 2) % 2) - 1);
      intent.pan = +(Math.min(...pans) + (Math.max(...pans) - Math.min(...pans)) * tri).toFixed(3); }
    else if (pans.length === 1) intent.pan = pans[0];
    intent.level = +((merged.level != null ? merged.level : 1) * k).toFixed(3);
    for (const id of (groups.head || [])) out[id] = { ...intent };
    return out;
  }

  /* inner/outer alternation: swap which pair is lit each beat */
  if (gesture.pattern === "inner_outer_alternation" || keys.some(x => x.target)) {
    const onInner = (((ph.globalBeat % 2) + 2) % 2) === 0;   // positive modulo (bars may be 0-based)
    const litOf = t => keys.find(x => x.target === t && x.intent && x.intent.level > 0);
    const inK = litOf("inner"), outK = litOf("outer");
    for (const id of (groups.inner || [])) out[id] = onInner && inK ? scaleLevel(inK.intent, k) : { level: 0 };
    for (const id of (groups.outer || [])) out[id] = !onInner && outK ? scaleLevel(outK.intent, k) : { level: 0 };
    return out;
  }
  /* chase: one lamp of the arc per beat, walking left->right (or right->left) */
  if (gesture.group === "arc" && (gesture.stagger > 0 || gesture.direction)) {
    const arc = groups.arc || [];
    if (arc.length) {
      let step = ((ph.globalBeat % arc.length) + arc.length) % arc.length;   // positive modulo
      if (gesture.direction === "R2L") step = arc.length - 1 - step;
      const onK = keys[0] || { intent: { level: 1, colour: [1, 1, 1] } };
      arc.forEach((id, i) => { out[id] = i === step ? scaleLevel(onK.intent, k) : { level: 0 }; });
    }
    return out;
  }
  /* strobe */
  if (keys.some(x => x.intent && x.intent.strobe > 0)) {
    const s = keys.find(x => x.intent && x.intent.strobe > 0).intent;
    for (const id of target) out[id] = { strobe: s.strobe, level: +((s.level != null ? s.level : 1) * k).toFixed(3), colour: s.colour };
    return out;
  }
  /* hold (one key) or pulse (level breathes across the bar between key levels) */
  const first = keys[0] ? keys[0].intent : { level: 0 };
  let level = first.level != null ? first.level : 0.5;
  if (keys.length > 1 && gesture.repeat !== "hold") {
    const ls = keys.map(x => x.intent && x.intent.level).filter(v => v != null);
    if (ls.length) { const lo = Math.min(...ls), hi = Math.max(...ls);
      level = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph.phaseInBar)); }
  }
  for (const id of target) out[id] = { colour: first.colour, level: +(level * k).toFixed(3) };
  return out;
}

/* an assignment (individual | compound | combination) -> { fixtureId: intent } */
function renderAssignment(a, seq, ph, groups) {
  const k = a.params && a.params.intensity != null ? a.params.intensity : 1;
  if (!seq || !seq.gesture) {   // base sequence with no gesture: a plain hold
    const out = {}; for (const id of (groups.all_pars || [])) out[id] = { colour: [1, 1, 1], level: +(0.5 * k).toFixed(3) };
    return out;
  }
  const gesture = seq.gesture;
  if (seq.kind === "compound" && Array.isArray(gesture.steps)) {
    const barInSec = ph.bar - a.from.bar;                 // which scripted step are we in
    const step = gesture.steps.find(s => barInSec >= s.from && barInSec < s.to) ||
                 gesture.steps[gesture.steps.length - 1];
    return renderIndividual(step.gesture || step, ph, groups, k);
  }
  if (seq.kind === "combination" && Array.isArray(gesture.parts)) {
    const out = {};
    for (const part of gesture.parts) Object.assign(out, renderIndividual(part.gesture || part, ph, groups, k));
    return out;
  }
  return renderIndividual(gesture, ph, groups, k);
}

/* compose several intents on one fixture: higher priority wins colour/motion,
   level is the max (glow adds, it does not cancel) */
function compose(intents) {
  const r = {}; let level = 0;
  for (const it of intents) {
    for (const key of Object.keys(it)) if (key !== "level") r[key] = it[key];
    if (it.level != null) level = Math.max(level, it.level);
  }
  r.level = +level.toFixed(3);
  return r;
}

function frame(position, plan, ctx) {
  const layout = ctx.layout, library = ctx.library || {};
  const bpb = (plan.grid && plan.grid.beats_per_bar) || ctx.bpb || 4;
  const groups = resolveGroups(layout);

  const beatInBar = Math.floor(position.beat) - 1;
  const phaseInBeat = position.beat - Math.floor(position.beat);
  const ph = { bpb, bar: position.bar, beat: position.beat, beatInBar, phaseInBeat,
    globalBeat: (position.bar - 1) * bpb + beatInBar,
    phaseInBar: (beatInBar + phaseInBeat) / bpb };

  const at = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);
  const here = at(position);
  const active = (plan.assignments || [])
    .filter(a => at(a.from) <= here && here < at(a.to))
    .sort((x, y) => (x.priority || 0) - (y.priority || 0));

  const perFixture = {};   // id -> [intent, ...] in priority order
  for (const a of active) {
    const rendered = renderAssignment(a, library[a.seq_id], ph, groups);
    for (const id of Object.keys(rendered)) (perFixture[id] = perFixture[id] || []).push(rendered[id]);
  }

  const fixtures = (layout.fixtures || []).map(f => ({
    id: f.id, type: f.type,
    intent: perFixture[f.id] ? compose(perFixture[f.id]) : { level: 0 },
  }));
  return { position, fixtures };
}

module.exports = { frame, resolveGroups, renderIndividual, compose };
