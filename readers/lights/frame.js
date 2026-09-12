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

/* the hard-hit envelope: a spike on the beat, a short hold, a fast fall -- the move
   the playbook says makes a 40fps stream feel like a hit rather than a flicker. */
const hitEnv = x => (x < 0.08 ? 1 : Math.max(0, 1 - (x - 0.08) / 0.30));

/* the PAR level for this instant, from the phase dynamics: contrast between a floor
   and a peak, shaped either as a per-beat hit or a per-bar breath. */
function parLevel(p, ph) {
  const floor = p.floor != null ? p.floor : 0, peak = p.peak != null ? p.peak : 1;
  const k = p.intensity != null ? p.intensity : 1;
  const shape = p.mode === "breathe"
    ? 0.5 + 0.5 * Math.sin(2 * Math.PI * ph.phaseInBar)
    : hitEnv(ph.phaseInBeat);
  return +((floor + (peak - floor) * shape) * k).toFixed(3);
}
const floorLevel = p => +((p.floor != null ? p.floor : 0) * (p.intensity != null ? p.intensity : 1)).toFixed(3);
const colourOf = (k, keys) => (k && k.intent && k.intent.colour) ||
  (keys[0] && keys[0].intent && keys[0].intent.colour) || [1, 1, 1];

/* render a PAR gesture: the gesture chooses WHICH pars + their colour; the phase
   dynamics choose the LEVEL. Off pars sit at the floor (never fully dark mid-drop). */
function renderPar(gesture, ph, groups, p) {
  const out = {}, keys = gesture.keys || [];
  const on = parLevel(p, ph), flo = floorLevel(p), downbeat = ph.beatInBar === 0;

  if (gesture.pattern === "inner_outer_alternation" || keys.some(x => x.target)) {
    const onInner = (((ph.globalBeat % 2) + 2) % 2) === 0;
    const inC = colourOf(keys.find(x => x.target === "inner"), keys);
    const outC = colourOf(keys.find(x => x.target === "outer"), keys);
    for (const id of (groups.inner || [])) out[id] = { colour: inC, level: (downbeat || onInner) ? on : flo };
    for (const id of (groups.outer || [])) out[id] = { colour: outC, level: (downbeat || !onInner) ? on : flo };
    return out;
  }
  if (gesture.group === "arc" && (gesture.stagger > 0 || gesture.direction)) {
    const arc = groups.arc || [];
    let step = ((ph.globalBeat % (arc.length || 1)) + (arc.length || 1)) % (arc.length || 1);
    if (gesture.direction === "R2L") step = arc.length - 1 - step;
    const c = colourOf(keys[0], keys);
    arc.forEach((id, i) => { out[id] = { colour: c, level: i === step ? on : flo }; });
    return out;
  }
  const c = colourOf(keys[0], keys);
  for (const id of (groups[gesture.group] || groups.all_pars || [])) out[id] = { colour: c, level: on };
  return out;
}

/* render a HEAD gesture: always moving (motion IS energy). Continuous multi-bar
   pan sweep whose speed rises with the phase; a tilt kick on the beat when lively;
   dimmer pulses subtly with the beat; colour/gobo/prism/spin carried from the gesture. */
function renderHead(gesture, ph, groups, p) {
  const out = {}, keys = gesture.keys || [], merged = {};
  for (const x of keys) Object.assign(merged, x.intent || {});
  const intent = {};
  for (const kk of ["colour", "gobo", "prism", "spin"]) if (merged[kk] != null) intent[kk] = merged[kk];
  if (intent.colour === "spin") { intent.spin = true; delete intent.colour; }

  const motion = p.motion != null ? p.motion : 0.5;
  const barPos = (ph.globalBeat + ph.phaseInBeat) / ph.bpb;
  const cycles = 0.5 + 1.5 * motion;                          // pan sweeps per bar
  const pans = keys.map(x => x.intent && x.intent.pan).filter(v => v != null);
  const pmin = pans.length ? Math.min(...pans) : 0.12, pmax = pans.length ? Math.max(...pans) : 0.88;
  intent.pan = +(((pmin + pmax) / 2) + ((pmax - pmin) / 2) * Math.sin(2 * Math.PI * cycles * barPos)).toFixed(3);
  const tilts = keys.map(x => x.intent && x.intent.tilt).filter(v => v != null);
  let tilt = tilts.length ? tilts[0] : 0.5;
  if (motion > 0.6) tilt = tilt + 0.12 * hitEnv(ph.phaseInBeat);       // tilt kick
  intent.tilt = +Math.max(0, Math.min(1, tilt)).toFixed(3);
  const dim = (p.headDim != null ? p.headDim : 1) * (0.85 + 0.15 * hitEnv(ph.phaseInBeat));
  intent.level = +dim.toFixed(3);
  for (const id of (groups.head || [])) out[id] = { ...intent };
  return out;
}

/* an assignment -> { fixtureId: intent }, dispatched by its layer (par vs head) */
function renderAssignment(a, seq, ph, groups) {
  const p = a.params || {}, isHead = a.layer === "head";
  if (!seq || !seq.gesture) {
    if (isHead) return renderHead({ group: "head", keys: [{ intent: { colour: "white" } }] }, ph, groups, p);
    return renderPar({ group: "all_pars", keys: [{ intent: { colour: [1, 1, 1] } }] }, ph, groups, p);
  }
  let g = seq.gesture;
  if (seq.kind === "compound" && Array.isArray(g.steps)) {
    const barInSec = ph.bar - a.from.bar;
    const step = g.steps.find(s => barInSec >= s.from && barInSec < s.to) || g.steps[g.steps.length - 1];
    g = step.gesture || step;
  } else if (seq.kind === "combination" && Array.isArray(g.parts)) {
    const out = {};
    for (const part of g.parts) {
      const pg = part.gesture || part;
      if (isHead && pg.group === "head") Object.assign(out, renderHead(pg, ph, groups, p));
      else if (!isHead && pg.group !== "head") Object.assign(out, renderPar(pg, ph, groups, p));
    }
    return out;
  }
  return (isHead || g.group === "head") ? renderHead(g, ph, groups, p) : renderPar(g, ph, groups, p);
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

  const isHead = f => f.type === "head13" || f.type === "head";
  const all = (make) => ({ position, fixtures: (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, intent: make(f) })) });

  /* contrast overrides take the whole rig for their beat */
  if (active.some(a => a.type === "white_blast"))
    return all(f => isHead(f) ? { colour: "white", level: 1, prism: true, pan: 0.5, tilt: 0.5 } : { colour: [1, 1, 1], level: 1 });
  if (active.some(a => a.type === "blackout"))
    return all(() => ({ level: 0 }));

  const perFixture = {};   // id -> [intent, ...] in priority order
  for (const a of active) {
    if (a.type) continue;                         // fx markers handled above
    const rendered = renderAssignment(a, library[a.seq_id], ph, groups);
    for (const id of Object.keys(rendered)) (perFixture[id] = perFixture[id] || []).push(rendered[id]);
  }

  const fixtures = (layout.fixtures || []).map(f => ({
    id: f.id, type: f.type,
    intent: perFixture[f.id] ? compose(perFixture[f.id]) : { level: 0 },
  }));
  return { position, fixtures };
}

module.exports = { frame, resolveGroups, renderPar, renderHead, parLevel, hitEnv, compose };
