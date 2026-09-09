/* Three pars, and one question per lamp.
   ----------------------------------------------------------------------------
   Renjith's rig, 9 Sept. recipe_beat.js proved that five pars can read as locked
   to the music, and then every recipe after it added six things at once, so when
   the show looked wrong nobody could say which of the six was wrong.

   This is the smallest rig that can still carry MEANING rather than just time.
   Three lamps, and each lamp's brightness and colour is driven by exactly ONE
   named thing from the map. Nothing is layered. If the left lamp is assigned to
   the beat and it looks late, the grid is late -- there is no chase, no bed and
   no anticipation dip to blame.

   The assignment is DATA, not code: it arrives in KNOB as JSON, so trying a new
   idea is a URL and not an edit. That is what makes this a bench you can argue
   with instead of a recipe you have to trust.

   Pre-flight says three pars carry 8 of the 10 dimensions Levels asks for. The
   two it cannot carry are `place`, which needs a mover, and `shock`, which needs
   a strobe. Everything the field-pricing measured as valuable -- structure,
   loudness, the drops -- is intensity and timing, and three lamps do those
   perfectly. So this rig can say everything we have proven matters.

   Obeys the one rule: every driver below is a pure function of t. No state, no
   memory, no "since the last". Ask for t twice, get the same answer. */

const DEFAULT = { l:["beat","chapter"], c:["energy","chapter"], r:["moment","harmony"] };
let AS = DEFAULT;
try { if (KNOB) { const p = (typeof KNOB === "string") ? JSON.parse(KNOB) : KNOB;
                  if (p && p.l && p.c && p.r) AS = p; } } catch (e) {}

const DECAY = Math.max(0.055, PER * 0.22);
const BAR_S = 4 * PER;

/* last entry at or before t, by binary search -- a lookup into the map's history,
   never a memory of having played it */
function before(arr, t){
  let lo = 0, hi = arr.length - 1, k = -1;
  while (lo <= hi){ const mi = (lo + hi) >> 1; if (arr[mi] <= t){ k = mi; lo = mi + 1 } else hi = mi - 1 }
  return k;
}
function pulse(arr, t, decay){
  if (!arr || !arr.length) return 0;
  const k = before(arr, t);
  return k < 0 ? 0 : Math.exp(-(t - arr[k]) / (decay || DECAY));
}
function enAt(t){
  if (!EN || !EN.length) return 0.5;
  let k = -1;
  for (let i = 0; i < EN.length; i++){ const a = Array.isArray(EN[i]) ? EN[i][0] : EN[i].at;
                                        if (a <= t) k = i; else break }
  if (k < 0) return Array.isArray(EN[0]) ? EN[0][1] : EN[0].v;
  const g = i => Array.isArray(EN[i]) ? EN[i] : [EN[i].at, EN[i].v];
  const [t0, v0] = g(k);
  if (k + 1 >= EN.length) return v0;
  const [t1, v1] = g(k + 1);
  const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return v0 + (v1 - v0) * Math.max(0, Math.min(1, u));
}
function chIdx(t){ let k = -1; for (let i = 0; i < CH.length; i++){ if (CH[i][0] <= t) k = i; else break } return k }
function chName(t){ const k = chIdx(t); return k < 0 ? "intro" : CH[k][1] }

/* a level per chapter name -- the smallest possible structural read */
const CH_LEVEL = { intro:0.22, verse:0.55, break:0.10, build:0.75, drop:1.00,
                   quiet:0.06, stop:0.00, outro:0.30, chorus:0.85, inst:0.60 };

/* the moments this rig can see: a flash that decays over one bar */
const MOM_T = (MO || []).filter(m => m.kind === "drop" || m.kind === "stop").map(m => m.at);

/* the sidechain shape, measured rather than assumed: how far the mix has
   recovered since the last kick */
function pumpAt(t){
  if (!PUMP || !DOWN || !BEATS.length) return null;
  const k = before(BEATS, t);
  if (k < 0) return 0;
  const u = Math.max(0, Math.min(1, (t - BEATS[k]) / PER));
  const d = (PUMP.depth === undefined ? 0.15 : PUMP.depth);
  return Math.max(0, Math.min(1, 1 - Math.abs(d) * Math.exp(-u * 3.0)));
}

const LEVEL = {
  off:      () => 0,
  on:       () => 1,
  beat:     t => pulse(BEATS, t),
  downbeat: t => pulse(DOWN, t),
  accent:   t => pulse(((MAP.accents || {}).events || []).map(e => e.at), t),
  energy:   t => enAt(t),
  chapter:  t => { const v = CH_LEVEL[chName(t)]; return v === undefined ? 0.4 : v },
  moment:   t => pulse(MOM_T, t, BAR_S * 0.5),
  pump:     t => { const p = pumpAt(t); return p === null ? 0.5 : p },
};

const HUE = {                                   /* r,g,b at full brightness */
  white:   () => [255, 250, 242],
  chapter: t => ({ intro:[60,110,220], verse:[90,150,235], break:[40,70,180],
                   build:[240,170,60], drop:[255,240,225], quiet:[30,50,140],
                   stop:[0,0,0], outro:[210,150,90], chorus:[255,205,120],
                   inst:[140,180,240] }[chName(t)] || [200,210,230]),
  harmony: t => {
    const ev = ((MAP.obs || {}).chords || {}).events || [];
    if (!ev.length) return [255, 250, 242];
    let k = -1; for (let i = 0; i < ev.length; i++){ if (ev[i].at <= t) k = i; else break }
    if (k < 0) return [255, 250, 242];
    const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const c = String(ev[k].chord || "C");
    const root = c[0] + (c[1] === "#" ? "#" : "");
    const i = NOTES.indexOf(root);
    if (i < 0) return [255, 250, 242];
    const h = (i / 12) * 360, s = 0.72, v = 1.0;                 /* hsv -> rgb */
    const f = n => { const kk = (n + h / 60) % 6;
                     return Math.round(255 * (v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)))) };
    return [f(5), f(3), f(1)];
  },
  energy:  t => { const e = enAt(t);                             /* cold -> warm */
                  return [Math.round(70 + 185 * e), Math.round(110 + 130 * e),
                          Math.round(235 - 30 * e)] },
};

function frame(t){
  const pars = LAYOUT.fixtures.filter(f => f.kind === "par");
  const slots = ["l", "c", "r"];
  const F = [];
  for (let i = 0; i < pars.length; i++){
    const a = AS[slots[i]] || DEFAULT[slots[i]] || ["off", "white"];
    const lf = LEVEL[a[0]] || LEVEL.off;
    const hf = HUE[a[1]] || HUE.white;
    const lv = Math.max(0, Math.min(1, lf(t)));
    const c  = hf(t);
    /* off means actually zero -- the frame contract requires rgb to fall with level */
    F.push({ id: pars[i].id, level: +lv.toFixed(4),
             r: Math.round(c[0] * lv), g: Math.round(c[1] * lv), b: Math.round(c[2] * lv) });
  }
  return { t: +t.toFixed(3), look: chName(t), fixtures: F };
}
