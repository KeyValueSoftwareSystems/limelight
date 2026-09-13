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

/* A gesture with several colour keys (xfade_*) is a slow crossfade, not a static
   colour: interpolate across the colour keys by bar position, looping. `at` is
   read as bars (the only sensible reading for a slow morph); a single-colour
   gesture (hold/breathe) returns its one colour unchanged. */
const lerp = (a, b, f) => a + (b - a) * f;
function crossfadeColour(keys, ph) {
  const ck = (keys || []).filter(k => k.intent && k.intent.colour);
  if (ck.length <= 1) return colourOf(keys[0], keys);
  const period = ck[ck.length - 1].at || ck.length;
  const t = (((ph.globalBeat / (ph.bpb || 4)) % period) + period) % period;
  for (let i = 0; i < ck.length - 1; i++) {
    const a = ck[i].at != null ? ck[i].at : i, b = ck[i + 1].at != null ? ck[i + 1].at : i + 1;
    if (t >= a && t < b) {
      const f = (t - a) / ((b - a) || 1), A = ck[i].intent.colour, B = ck[i + 1].intent.colour;
      return [lerp(A[0], B[0], f), lerp(A[1], B[1], f), lerp(A[2], B[2], f)].map(v => +v.toFixed(3));
    }
  }
  return ck[ck.length - 1].intent.colour;
}

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
    // In breathe mode the level CURVE passes through: the active pair follows it and
    // the resting pair sits at the floor, so a sustained trade breathes like a wash.
    // (Holding the active pair and darkening the rest was binarising the curve.)
    const held = p.mode !== "breathe";
    const activeLvl = held ? +((p.peak != null ? p.peak : 1) * (p.intensity != null ? p.intensity : 1)).toFixed(3) : on;
    const restLvl = held ? 0 : flo;
    for (const id of (groups.inner || [])) out[id] = { colour: inC, level: onInner ? activeLvl : restLvl };
    for (const id of (groups.outer || [])) out[id] = { colour: outC, level: onInner ? restLvl : activeLvl };
    return out;
  }
  if (gesture.group === "arc" && (gesture.stagger > 0 || gesture.direction)) {
    const arc = groups.arc || [], n = arc.length || 1, dir = gesture.direction;
    const beat = ((ph.globalBeat % n) + n) % n;
    // where the head sits this step, by direction
    let head;
    if (dir === "R2L") head = n - 1 - beat;
    else if (dir === "bounce") {                       // L->R->L ping-pong, no repeated ends
      const span = 2 * (n - 1) || 1, q = ((ph.globalBeat % span) + span) % span;
      head = q < n ? q : span - q;
    } else if (dir === "random") {                     // deterministic per-beat scatter (seeded, so pure)
      const h = Math.sin((ph.globalBeat + 1) * 12.9898) * 43758.5453;
      head = Math.floor((h - Math.floor(h)) * n);
    } else head = beat;                                // L2R
    // rainbow: several colour keys -> the moving head cycles through them; else one colour
    const cols = keys.filter(k => k.intent && k.intent.colour).map(k => k.intent.colour);
    const headColour = cols.length > 1
      ? cols[((ph.globalBeat % cols.length) + cols.length) % cols.length] : (cols[0] || [1, 1, 1]);
    // comet: a single-colour chase whose level fades (a mid 0<level<1 key) trails a
    // tail BEHIND the head, in the travel direction, no wrap. A multi-colour chase
    // (rainbow) is NOT a comet -- it is one moving head that cycles colour; lighting
    // the whole arc at once while the colour cycles just smears the colours together.
    const comet = cols.length <= 1 && keys.some(k => k.intent && k.intent.level != null && k.intent.level > 0 && k.intent.level < 1);
    // the head is HELD bright for its whole step, not `on` (the hit-envelope, which
    // sags to the floor by the end of the beat and left a dim colour lingering an
    // extra step). Off positions are fully dark; a comet keeps its spatial tail.
    // breathe mode: the curve passes through (head follows it, the rest at the floor)
    const held = p.mode !== "breathe";
    const activeLvl = held ? +((p.peak != null ? p.peak : 1) * (p.intensity != null ? p.intensity : 1)).toFixed(3) : on;
    const restLvl = held ? 0 : flo;
    arc.forEach((id, i) => {
      let lvl;
      if (comet) {
        const d = dir === "R2L" ? i - head : head - i;  // >0 = behind the head
        lvl = d === 0 ? activeLvl : d === 1 ? Math.max(restLvl, activeLvl * 0.45) : d === 2 ? Math.max(restLvl, activeLvl * 0.18) : restLvl;
        if (d < 0) lvl = restLvl;
      } else {
        lvl = i === head ? activeLvl : restLvl;         // clean chase: only the head lit
      }
      out[id] = { colour: headColour, level: +lvl.toFixed(3) };
    });
    return out;
  }
  const c = crossfadeColour(keys, ph);
  // strobe sequences (group "strobers") carry a strobe rate on their keys; the
  // fixture does the flashing, so hold the level and set the strobe channel.
  // renderPar used to drop strobe entirely, so they rendered as a plain wash.
  const strobeVal = keys.reduce((m, k) => Math.max(m, (k.intent && k.intent.strobe) || 0), 0);
  const steady = +((p.peak != null ? p.peak : 1) * (p.intensity != null ? p.intensity : 1)).toFixed(3);
  for (const id of (groups[gesture.group] || groups.all_pars || [])) {
    out[id] = strobeVal > 0
      ? { colour: c, level: steady, strobe: +strobeVal.toFixed(2) }
      : { colour: c, level: on };
  }
  return out;
}

/* render a HEAD gesture: the head FOLLOWS ITS KEYFRAMES and USES THE WHOLE ROOM.
   Keys carry pan/tilt (and colour/gobo/prism) at `at` beats. The palette's paths
   are timid (pan .3-.7, tilt .42-.55), so musical MOTION sets the EXTENT the path is
   stretched to about its own centre: a drift near the wall in an intro, the full
   540/180-degree travel in a drop (0.5 is the wall; the driver's aim anchors put 0
   and 1 at the ends of travel). The path clock runs at a speed set by motion, but
   never faster than the wire can follow (half the travel per beat, easing peak
   included): a room-wide move is a phrase-scale move, a beat-scale one is a kick.
   The head eases through the poses, looping (a loop that does not close is closed
   back to its first pose); discrete attributes step on the musical beat. A gesture
   with fewer than two positions roams a room-scale figure so it is never still. */
const EXTENT_MIN = 0.10;           // share of the travel a path spans at motion 0
const MAX_TRAVEL_PER_BEAT = 0.5;   // normalised pan+tilt per beat the wire's slew can follow
const TILT_KICK = 0.08;
function renderHead(gesture, ph, groups, p) {
  const out = {}, keys = gesture.keys || [];
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const motion = p.motion != null ? p.motion : 0.5;
  const beatPos = ph.globalBeat + ph.phaseInBeat;            // real musical beats
  const speed = 0.5 + motion;                                // path beats per musical beat, before the wire cap
  const E = clamp01(EXTENT_MIN + (1 - EXTENT_MIN) * motion * motion);

  /* keys in `at` order (beats); a key without pan/tilt carries the last pose forward */
  const ks = keys.map((k, i) => ({ at: k.at != null ? k.at : i, intent: k.intent || {} })).sort((a, b) => a.at - b.at);
  const poses = [];
  let lastPan = null, lastTilt = null;
  for (const k of ks) {
    if (k.intent.pan != null) lastPan = k.intent.pan;
    if (k.intent.tilt != null) lastTilt = k.intent.tilt;
    poses.push({ at: k.at, pan: lastPan, tilt: lastTilt });
  }
  const firstPan = poses.find(q => q.pan != null), firstTilt = poses.find(q => q.tilt != null);
  for (const q of poses) { if (q.pan == null) q.pan = firstPan ? firstPan.pan : null; if (q.tilt == null) q.tilt = firstTilt ? firstTilt.tilt : null; }
  const distinct = new Set(poses.map(q => q.pan + "/" + q.tilt)).size;
  const loops = (gesture.repeat || "loop") === "loop";

  let pan, tilt, period = 0, rate = speed;
  if (poses.length >= 2 && distinct >= 2 && firstPan && firstTilt && ks[ks.length - 1].at > 0) {
    /* stretch about the gesture's own centre, per axis, never shrinking an authored span */
    const pans = poses.map(q => q.pan), tilts = poses.map(q => q.tilt);
    const pmin = Math.min(...pans), pmax = Math.max(...pans), tmin = Math.min(...tilts), tmax = Math.max(...tilts);
    const cp = (pmin + pmax) / 2, ct = (tmin + tmax) / 2;
    const kp = pmax - pmin > 1e-6 ? Math.max(1, E / (pmax - pmin)) : 1;
    const kt = tmax - tmin > 1e-6 ? Math.max(1, E / (tmax - tmin)) : 1;
    const sp = poses.map(q => ({ at: q.at, pan: clamp01(cp + (q.pan - cp) * kp), tilt: clamp01(ct + (q.tilt - ct) * kt) }));
    /* a loop that does not end where it began is closed back to its first pose */
    const last = sp[sp.length - 1], first = sp[0];
    if (loops && (Math.abs(last.pan - first.pan) > 1e-6 || Math.abs(last.tilt - first.tilt) > 1e-6)) {
      const step = sp.length > 1 ? (last.at - first.at) / (sp.length - 1) : 1;
      sp.push({ at: last.at + Math.max(step, 1e-6), pan: first.pan, tilt: first.tilt });
    }
    period = sp[sp.length - 1].at;
    /* the wire cap: slow the clock so the steepest eased segment stays under it */
    let steep = 0;
    for (let i = 0; i < sp.length - 1; i++) {
      const travel = Math.abs(sp[i + 1].pan - sp[i].pan) + Math.abs(sp[i + 1].tilt - sp[i].tilt);
      steep = Math.max(steep, travel / Math.max(sp[i + 1].at - sp[i].at, 1e-6));
    }
    const peak = steep * (Math.PI / 2) * speed;               // the cosine ease peaks at pi/2 x the mean slope
    rate = peak > MAX_TRAVEL_PER_BEAT ? speed * (MAX_TRAVEL_PER_BEAT / peak) : speed;
    const t = loops ? (((beatPos * rate) % period) + period) % period : Math.min(beatPos * rate, period);
    let i = 0;
    while (i < sp.length - 2 && !(t >= sp[i].at && t < sp[i + 1].at)) i++;
    const a = sp[i], b = sp[i + 1];
    const f = clamp01((t - a.at) / ((b.at - a.at) || 1));
    const e = 0.5 - 0.5 * Math.cos(Math.PI * f);              // ease in/out: kind to a mechanical head
    pan = a.pan + (b.pan - a.pan) * e;
    tilt = a.tilt + (b.tilt - a.tilt) * e;
    /* an axis the gesture holds still (a pan-only sweep) takes the room figure
       instead, scaled by motion, so neither axis is ever dead in a drop */
    const bars = beatPos / ph.bpb;
    if (pmax - pmin <= 1e-6) pan = clamp01(pan + (E / 2) * Math.sin(2 * Math.PI * bars / 2));
    if (tmax - tmin <= 1e-6) tilt = clamp01(tilt + (E / 2) * 0.8 * Math.sin(2 * Math.PI * bars / 3));
  } else {
    /* the default: a room-scale figure about the gesture's pose (or the wall), pan
       over two bars and tilt over three, so the head is never still */
    const cp = firstPan ? firstPan.pan : 0.5, ct = firstTilt ? firstTilt.tilt : 0.5;
    const bars = beatPos / ph.bpb;
    pan = clamp01(cp + (E / 2) * Math.sin(2 * Math.PI * bars / 2));
    tilt = clamp01(ct + (E / 2) * 0.8 * Math.sin(2 * Math.PI * bars / 3));
  }
  if (motion > 0.6) tilt = tilt + TILT_KICK * hitEnv(ph.phaseInBeat);       // tilt kick

  /* discrete attributes: the latest key at or before the path time of the LAST
     MUSICAL BEAT (looping), so a mechanical wheel/gobo change lands on a beat where
     the hit hides it, never mid-beat; before the first such key, the first that has it */
  const beatFloor = Math.floor(beatPos + 1e-9);
  const tq = period > 0 ? (loops ? (((beatFloor * rate) % period) + period) % period : Math.min(beatFloor * rate, period)) : 0;
  const intent = {};
  for (const kk of ["colour", "gobo", "prism", "spin"]) {
    let v = null;
    for (const k of ks) if (k.at <= tq + 1e-9 && k.intent[kk] != null) v = k.intent[kk];
    if (v == null) { const k0 = ks.find(k => k.intent[kk] != null); if (k0) v = k0.intent[kk]; }
    if (v != null) intent[kk] = v;
  }
  if (intent.colour === "spin") { intent.spin = true; delete intent.colour; }
  if (intent.colour == null && !intent.spin) intent.colour = "white";   /* not wheel position 0 */

  intent.pan = +clamp01(pan).toFixed(3);
  intent.tilt = +clamp01(tilt).toFixed(3);
  const dim = (p.headDim != null ? p.headDim : 1) * (0.85 + 0.15 * hitEnv(ph.phaseInBeat));
  intent.level = +dim.toFixed(3);
  for (const id of (groups.head || [])) out[id] = { ...intent };
  return out;
}

/* an assignment -> { fixtureId: intent }, dispatched by its layer (par vs head) */
/* `ph` is the real musical clock (the head, compound steps, downbeats); `phk` is
   the PAR PATTERN clock -- the same clock run at the bar's subdivision (half,
   normal or double time), so hits, trades, chases and breath follow the pace. */
function renderAssignment(a, seq, ph, groups, phk) {
  const p = a.params || {}, isHead = a.layer === "head";
  phk = phk || ph;
  if (!seq || !seq.gesture) {
    if (isHead) return renderHead({ group: "head", keys: [{ intent: { colour: "white" } }] }, ph, groups, p);
    return renderPar({ group: "all_pars", keys: [{ intent: { colour: [1, 1, 1] } }] }, phk, groups, p);
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
      else if (!isHead && pg.group !== "head") Object.assign(out, renderPar(pg, phk, groups, p));
    }
    return out;
  }
  return (isHead || g.group === "head") ? renderHead(g, ph, groups, p) : renderPar(g, phk, groups, p);
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
function modulationAt(plan, bar, beatInBar, bpb) {
  const m = { gain: 1, floorK: 1, motion: 0, outerK: 1, whiten: 0, headK: 1, strobeK: 1, subdiv: 1,
              drumsOut: false, hue: null, minor: null, sure: 0 };
  /* an ABSENT lane is no information (undefined: the factor is skipped); a null
     bar inside a present lane is the neutral middle (dflt) */
  const read = (blk, k, dflt) => {
    const v = blk && blk[k];
    if (!Array.isArray(v) || !v.length) return undefined;
    let i = Math.round(bar) - (blk.from_bar || 0);
    i = Math.max(0, Math.min(v.length - 1, i));
    const x = v[i];
    return (x === null || x === undefined) ? dflt : x;
  };
  const L = plan.lanes;
  if (L) {
    const width = read(L, "width", 0.5), pace = read(L, "pace", 0.5), pump = read(L, "pump", 0.5),
          bright = read(L, "brightness", 0.5), air = read(L, "air", 0.5), density = read(L, "density", 0.5),
          drums = read(L, "drums", null), vocals = read(L, "vocals", null), subdiv = read(L, "subdiv", 1);
    if (width !== undefined) m.outerK = 0.55 + 0.45 * width;          /* narrow image -> the arc closes to the inner pair */
    if (pace !== undefined) m.motion += 0.5 * (pace - 0.5);           /* busy bars move the head faster */
    if (pump !== undefined) m.floorK = 1 - 0.5 * (pump - 0.5);        /* a deeper duck -> a lower floor -> a harder hit */
    if (bright !== undefined) { m.whiten += Math.max(0, 0.3 * (bright - 0.5)); m.gain *= 0.9 + 0.2 * bright; }  /* a bright bar whitens */
    if (density !== undefined) m.gain *= 0.9 + 0.2 * density;
    if (air !== undefined) { m.headK *= 0.9 + 0.2 * air; m.strobeK *= 0.7 + 0.6 * air; }   /* an open sound opens the head */
    if (drums !== undefined && drums !== null) m.drumsOut = drums < 0.3;   /* no drums, no strobe accent */
    if (vocals !== undefined && vocals !== null && vocals >= 0.3) { m.headK *= 1.15; m.motion -= 0.15; }   /* the head listens */
    /* the PAR pattern clock: events per beat (0.5 half time, 1, 2 double time) */
    if (subdiv !== undefined && typeof subdiv === "number" && subdiv > 0) m.subdiv = Math.max(0.25, Math.min(4, subdiv));
    /* growth: a rising section climbs across itself (0.5 = at rest) */
    const grow = read(L, "grow", 0.5);
    if (grow !== undefined) { m.gain *= 0.8 + 0.4 * grow; m.motion += 0.3 * (grow - 0.5); }
  }
  /* tension: the score's per-beat wind-up lifts level and motion toward a release */
  const T = plan.tension;
  if (T && Array.isArray(T.values) && T.values.length) {
    let i = (Math.round(bar) - (T.from_bar || 0)) * (bpb || 4) + (beatInBar || 0);
    i = Math.max(0, Math.min(T.values.length - 1, i));
    const t = typeof T.values[i] === "number" ? T.values[i] : 0.5;
    m.gain *= 0.85 + 0.3 * t;
    m.motion += 0.3 * (t - 0.5);
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

  const clamp01 = v => Math.max(0, Math.min(1, v));
  const top = type => active.filter(a => a.type === type).sort((x, y) => (y.priority || 0) - (x.priority || 0))[0] || null;
  const strengthOf = a => (a && a.params && typeof a.params.strength === "number") ? clamp01(a.params.strength) : 1;

  const blast = top("white_blast"), blackout = top("blackout");

  /* the bar's texture + harmony, and the span modifiers riding on the base */
  const mod = modulationAt(plan, ph.bar, ph.beatInBar, bpb);
  /* the PAR pattern clock: the musical clock run at the bar's subdivision. At a
     bar line B*k is whole for k in {0.5,1,2}, so a speed change re-aligns on the
     downbeat with no glitch. k = 1 is the real clock, byte for byte. */
  const k = mod.subdiv || 1;
  let phk = ph;
  if (k !== 1) {
    const Bk = (ph.globalBeat + ph.phaseInBeat) * k, fl = Math.floor(Bk + 1e-9);
    phk = { ...ph, globalBeat: fl, phaseInBeat: Math.max(0, Bk - fl), beatInBar: ((fl % bpb) + bpb) % bpb,
            phaseInBar: (((Bk / bpb) % 1) + 1) % 1 };
  }
  const mods = active.filter(a => a.type === "modulate");
  /* ramps (a rise signal): grow toward full across the span, weight-scaled */
  let rampGain = 1, rampMotion = 0, rampWhiten = 0;
  for (const a of active.filter(x => x.type === "ramp")) {
    const span = Math.max(1e-6, at(a.to) - at(a.from));
    const prog = clamp01((here - at(a.from)) / span), w = a.params && a.params.weight != null ? clamp01(a.params.weight) : 0.5;
    rampGain *= 1 + 0.35 * w * prog; rampMotion += 0.3 * w * prog; rampWhiten += 0.25 * w * prog;
  }
  const gainMod = mods.reduce((g, a) => g * (a.params && a.params.gain != null ? a.params.gain : 1), 1) * rampGain;
  const motionMod = mods.reduce((t, a) => t + (a.params && a.params.motion != null ? a.params.motion : 0), 0) + mod.motion + rampMotion;
  const hook = top("hook"), pause = top("pause");
  const hookK = hook ? 1 + 0.3 * strengthOf(hook) : 1;
  const pauseK = pause ? 1 - 0.85 * strengthOf(pause) : 1;        /* a hush, not a blackout */
  const pauseHeadK = pause ? 1 - 0.7 * strengthOf(pause) : 1;

  const headIds = new Set(groups.head || []);
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
    const rendered = renderAssignment({ ...a, params: tuned, from: a.origin || a.from }, library[a.seq_id], ph, groups, phk);
    /* a layer drives its own fixtures only: `strobers` is every fixture that can
       strobe, head included, and a PAR look must never put strobe on the head */
    for (const id of Object.keys(rendered)) {
      if ((a.layer === "head") !== headIds.has(id)) continue;
      (perFixture[id] = perFixture[id] || []).push(rendered[id]);
    }
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
  const whitenAmt = clamp01((whiten ? (whiten.params.amount || 0.3) : 0) + mod.whiten + rampWhiten);
  const outer = new Set(groups.outer || []);
  const tintAmt = clamp01(0.6 * mod.sure);
  for (const fx of fixtures) {
    if (isHead(fx)) {
      if (fx.intent.level != null) fx.intent.level = +clamp01(fx.intent.level).toFixed(3);
      if (hook && strengthOf(hook) >= 0.5 && fx.intent.level > 0) fx.intent.prism = true;
      /* a pause parks the head low: tilt sinks toward the wall spot with its weight */
      if (pause && fx.intent.tilt != null) fx.intent.tilt = +(fx.intent.tilt * Math.max(0, 1 - 1.6 * strengthOf(pause))).toFixed(3);
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

  /* contrast overrides take the whole rig for their beat, scaled by the moment's
     weight. They are about LIGHT, not aim: the head keeps the pose its own look
     gave it, so the wire never lurches to pan 0 / tilt 0 on a dark beat. */
  if (blast || blackout) {
    const sf = blast ? strengthOf(blast) : 0, lvl = blast ? +(0.5 + 0.5 * sf).toFixed(3) : 0;
    for (const fx of fixtures) {
      if (isHead(fx)) {
        /* a HEAVY hit (an entrance, weight .9+) is the one deliberate snap: centre
           stage, prism open -- a few frames of travel inside the aim window */
        const pose = {};
        if (fx.intent.pan != null) pose.pan = fx.intent.pan;
        if (fx.intent.tilt != null) pose.tilt = fx.intent.tilt;
        if (blast && sf >= 0.9) { pose.pan = 0.5; pose.tilt = 0.5; }
        fx.intent = blast ? { colour: "white", level: lvl, ...(sf >= 0.7 ? { prism: true } : {}), ...pose } : { ...pose, level: 0 };
      } else {
        fx.intent = blast ? { colour: [1, 1, 1], level: lvl } : { level: 0 };
      }
    }
  }
  return { position, fixtures };
}

module.exports = { frame, resolveGroups, renderPar, renderHead, parLevel, hitEnv, compose, tint, modulationAt };
