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
    // pick the colour-bearing key for each side: a target often has two keys
    // (one carries the colour, the other just drops the level to 0), and taking
    // the first would miss the colour -- e.g. outer red instead of blue.
    const colourKey = t => keys.find(x => x.target === t && x.intent && x.intent.colour);
    const inC = colourOf(colourKey("inner"), keys);
    const outC = colourOf(colourKey("outer"), keys);
    // call-and-response: the active pair is HELD bright for its beat, the other sits
    // at the floor, and they trade each beat. (It used to spike on the hit-envelope
    // and dip to the floor between beats, so both pairs looked dim at once and the
    // alternation never read; it also forced both on for the downbeat.)
    // The off pair goes fully dark, not to the floor: at 12% dim red reads as off
    // but dim blue is still visibly on, so the floor made the trade look lopsided.
    const activeLvl = +((p.peak != null ? p.peak : 1) * (p.intensity != null ? p.intensity : 1)).toFixed(3);
    for (const id of (groups.inner || [])) out[id] = { colour: inC, level: onInner ? activeLvl : 0 };
    for (const id of (groups.outer || [])) out[id] = { colour: outC, level: onInner ? 0 : activeLvl };
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

/* ---- colour: harmony tints the gesture's colour toward the bar's chord ------ */
function rgb2hsv(c) {
  const r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const k = ((i % 6) + 6) % 6;
  const c = k === 0 ? [v, t, p] : k === 1 ? [q, v, p] : k === 2 ? [p, v, t] : k === 3 ? [p, q, v] : k === 4 ? [t, p, v] : [v, p, q];
  return c.map(x => +Math.max(0, Math.min(1, x)).toFixed(3));
}
/* rotate a saturated colour's hue toward the chord's; give a whitish one a cast.
   amount 0 leaves the colour exactly as the gesture drew it. */
function tint(colour, hue, amount, minor) {
  if (!Array.isArray(colour) || colour.length < 3 || hue === null || hue === undefined || !(amount > 0)) return colour;
  let [h, sat, v] = rgb2hsv(colour);
  if (minor) v *= 0.85;
  if (sat < 0.25) {                                 /* white-ish: a pastel cast */
    const target = hsv2rgb(hue, 1, v);
    return colour.map((c, i) => +(c * (1 - 0.5 * amount) + target[i] * 0.5 * amount).toFixed(3));
  }
  let d = hue - h; if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
  h = ((h + d * amount) % 1 + 1) % 1;
  return hsv2rgb(h, sat, v);
}

/* ---- per-bar modulation from the plan's texture lanes and harmony ------------
   Everything here is neutral (a no-op) when the plan carries no lanes/harmony, so
   a plain plan renders exactly as before. A null bar reads as the neutral middle. */
function modulationAt(plan, bar) {
  const m = { gain: 1, floorK: 1, motion: 0, outerK: 1, whiten: 0, headK: 1, strobeK: 1,
              drumsOut: false, hue: null, minor: null, sure: 0 };
  const read = (blk, k, dflt) => {
    const v = blk && blk[k];
    if (!Array.isArray(v) || !v.length) return dflt;
    let i = Math.round(bar) - (blk.from_bar || 0);
    i = Math.max(0, Math.min(v.length - 1, i));
    const x = v[i];
    return (x === null || x === undefined) ? dflt : x;
  };
  const L = plan.lanes;
  if (L) {
    const width = read(L, "width", 0.5), pace = read(L, "pace", 0.5), pump = read(L, "pump", 0.5),
          bright = read(L, "brightness", 0.5), air = read(L, "air", 0.5), density = read(L, "density", 0.5),
          drums = read(L, "drums", null), vocals = read(L, "vocals", null);
    m.outerK = 0.55 + 0.45 * width;                 /* narrow image -> the arc closes to the inner pair */
    m.motion += 0.5 * (pace - 0.5);                 /* busy bars move the head faster */
    m.floorK = 1 - 0.5 * (pump - 0.5);              /* a deeper duck -> a lower floor -> a harder hit */
    m.whiten += Math.max(0, 0.3 * (bright - 0.5));  /* a bright bar whitens the colour */
    m.gain *= (0.9 + 0.2 * bright) * (0.9 + 0.2 * density);
    m.headK *= 0.9 + 0.2 * air;                     /* an open sound opens the head */
    m.strobeK *= 0.7 + 0.6 * air;
    if (drums !== null) m.drumsOut = drums < 0.3;   /* no drums, no strobe accent */
    if (vocals !== null && vocals >= 0.3) { m.headK *= 1.15; m.motion -= 0.15; }   /* the head listens */
  }
  const H = plan.harmony;
  if (H) {
    m.hue = read(H, "hue", null);
    m.minor = read(H, "minor", null);
    const sure = read(H, "sure", null);
    m.sure = typeof sure === "number" ? sure : (m.hue !== null ? 0.8 : 0);
  }
  return m;
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

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const top = type => active.filter(a => a.type === type).sort((x, y) => (y.priority || 0) - (x.priority || 0))[0] || null;
  const strengthOf = a => (a && a.params && typeof a.params.strength === "number") ? clamp01(a.params.strength) : 1;

  /* contrast overrides take the whole rig for their beat, scaled by the moment's weight */
  const blast = top("white_blast");
  if (blast) {
    const sf = strengthOf(blast), lvl = +(0.5 + 0.5 * sf).toFixed(3);
    return all(f => isHead(f)
      ? { colour: "white", level: lvl, ...(sf >= 0.7 ? { prism: true } : {}), pan: 0.5, tilt: 0.5 }
      : { colour: [1, 1, 1], level: lvl });
  }
  if (top("blackout"))
    return all(() => ({ level: 0 }));

  /* the bar's texture + harmony, and the span modifiers riding on the base */
  const mod = modulationAt(plan, ph.bar);
  const mods = active.filter(a => a.type === "modulate");
  const gainMod = mods.reduce((g, a) => g * (a.params && a.params.gain != null ? a.params.gain : 1), 1);
  const motionMod = mods.reduce((t, a) => t + (a.params && a.params.motion != null ? a.params.motion : 0), 0) + mod.motion;
  const hook = top("hook"), pause = top("pause");
  const hookK = hook ? 1 + 0.3 * strengthOf(hook) : 1;
  const pauseK = pause ? 1 - 0.85 * strengthOf(pause) : 1;        /* a hush, not a blackout */
  const pauseHeadK = pause ? 1 - 0.7 * strengthOf(pause) : 1;

  const perFixture = {};   // id -> [intent, ...] in priority order
  for (const a of active) {
    if (a.type) continue;                         // fx markers and modifiers handled elsewhere
    const p = a.params || {};
    let tuned = p;
    if (a.layer === "head") {
      tuned = { ...p, motion: pause ? 0.3 : clamp01((p.motion != null ? p.motion : 0.5) + motionMod),
                headDim: (p.headDim != null ? p.headDim : 1) * mod.headK * pauseHeadK };
    } else {
      const peak = p.peak != null ? p.peak : 1, floor = p.floor != null ? p.floor : 0;
      tuned = { ...p, floor: +Math.min(peak, floor * mod.floorK).toFixed(3) };
    }
    /* a carved base piece keeps its section's origin so a scripted compound does not restart */
    const rendered = renderAssignment({ ...a, params: tuned, from: a.origin || a.from }, library[a.seq_id], ph, groups);
    for (const id of Object.keys(rendered)) (perFixture[id] = perFixture[id] || []).push(rendered[id]);
  }

  const fixtures = (layout.fixtures || []).map(f => ({
    id: f.id, type: f.type,
    intent: perFixture[f.id] ? compose(perFixture[f.id]) : { level: 0 },
  }));

  /* overlapping aspects that ride on a distinct attribute of the base look:
     drums -> a strobe pop on the downbeat (quiet while the drums are out);
     build/bright -> whiten the PAR colour; harmony -> tint it; width -> close the
     arc; subsections/hook/pause -> level; hook -> the head's prism. */
  const accent = top("accent_strobe"), whiten = top("whiten");
  const whitenAmt = clamp01((whiten ? (whiten.params.amount || 0.3) : 0) + mod.whiten);
  const outer = new Set(groups.outer || []);
  const tintAmt = clamp01(0.6 * mod.sure);
  for (const fx of fixtures) {
    if (isHead(fx)) {
      if (fx.intent.level != null) fx.intent.level = +clamp01(fx.intent.level).toFixed(3);
      if (hook && strengthOf(hook) >= 0.5 && fx.intent.level > 0) fx.intent.prism = true;
      continue;
    }
    if (fx.type !== "par7") continue;
    if (Array.isArray(fx.intent.colour)) {
      fx.intent.colour = tint(fx.intent.colour, mod.hue, tintAmt, mod.minor === true);
      if (whitenAmt > 0) fx.intent.colour = fx.intent.colour.map(c => +(c + (1 - c) * whitenAmt).toFixed(3));
    }
    if (fx.intent.level != null) {
      const k = mod.gain * gainMod * hookK * pauseK * (outer.has(fx.id) ? mod.outerK : 1);
      fx.intent.level = +clamp01(fx.intent.level * k).toFixed(3);
    }
    if (accent && !pause && !mod.drumsOut && ph.beatInBar === 0 && ph.phaseInBeat < 0.22)
      fx.intent.strobe = +clamp01((accent.params.strength || 0.8) * mod.strobeK).toFixed(2);
  }
  return { position, fixtures };
}

module.exports = { frame, resolveGroups, renderPar, renderHead, parLevel, hitEnv, compose, tint, modulationAt };
