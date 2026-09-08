/* An experiment, not the shipped recipe. It passes every absence-of-fault check
   in showaudit.js and FAILS the variety ones: mean |correlation| between
   fixtures 0.836 against recipe4's 0.378, and 10% distinct rig states against
   59%. Half the rig moves as one block. It is brighter than recipe4, which is
   why the fault checks liked it, and brightness is not interest.

   Build it with LIMELIGHT_RECIPE=recipe_show.js. What is worth keeping from it
   is the field wiring -- anticipation, surprise, lead, arc, tonality, harmony,
   bass_notes, stereo -- and what is worth throwing away is the single global
   base level that every family is multiplied by. */
var __SHOW = (function () {
const M = typeof MAP_FULL !== "undefined" && MAP_FULL ? MAP_FULL : MAP;
const OB = M.observations || {};
const GRID = M.grid || {};
const PER = GRID.period || 0.5;
const BAR = PER * 4;
const PHASE = GRID.phase != null ? GRID.phase : 0;
const BEATS_A = M.beats || [];
const DOWN_A =
  M.downbeats && M.downbeats.length
    ? M.downbeats
    : BEATS_A.filter((_, i) => i % 4 === 0);
const DUR_S =
  (M.song && M.song.length) ||
  (BEATS_A.length ? BEATS_A[BEATS_A.length - 1] + BAR : 240);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => clamp(v, 0, 1);
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = (f) => {
  const x = sat(f);
  return x * x * (3 - 2 * x);
};
const ease = (f) => {
  const x = sat(f);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};

function idxAtOrBefore(arr, t) {
  let lo = 0,
    hi = arr.length - 1,
    r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= t + 1e-9) {
      r = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}
function series(o) {
  if (!o) return null;
  const at = o.at || o.times,
    v = o.value || o.values;
  if (!at || !v || !at.length) return null;
  return { at: at, v: v };
}
function seriesAt(s, t, dflt) {
  if (!s) return dflt;
  const i = idxAtOrBefore(s.at, t);
  if (i < 0) return dflt;
  const a = s.v[i];
  return a == null ? dflt : a;
}
function seriesSmooth(s, t, dflt) {
  if (!s) return dflt;
  const i = idxAtOrBefore(s.at, t);
  if (i < 0) return dflt;
  const a = s.v[i],
    b = i + 1 < s.v.length ? s.v[i + 1] : a;
  if (a == null) return dflt;
  const t0 = s.at[i],
    t1 = i + 1 < s.at.length ? s.at[i + 1] : t0 + BAR;
  const f = t1 > t0 ? sat((t - t0) / (t1 - t0)) : 0;
  return lerp(a, b == null ? a : b, smooth(f));
}

const EN =
  series(OB.energy) ||
  (function () {
    const e = M.energy || [];
    if (!e.length) return null;
    return {
      at: e.map((r) => (Array.isArray(r) ? r[0] : r.at)),
      v: e.map((r) => (Array.isArray(r) ? r[1] : r.value)),
    };
  })();
const SURP = series(OB.surprise);
const NOV = series(OB.novelty);
const VOICE = series(OB.voice);
const TONAL = series(OB.tonality);
const HARM = series(OB.harmony);
const MELC = series(OB.melody_centroid);
  const BASSN = (OB.bass_notes && (OB.bass_notes.notes || OB.bass_notes.value)) || null;
  const INSTR = (OB.instruments && OB.instruments.entries) || null;

const ANTIC = (OB.anticipation && OB.anticipation.entries) || [];
const ANTIC_T = ANTIC.map((r) => r.at);
const LEAD = (OB.lead && OB.lead.entries) || [];
const LEAD_T = LEAD.map((r) => r.at);
const ARC = OB.arc || null;
const PEAK_F = ARC
  ? ARC.peak_at_fraction != null
    ? ARC.peak_at_fraction
    : 0.75
  : 0.75;

const CHORDS = (OB.chords && OB.chords.events) || [];
const CHORD_T = CHORDS.map((e) => e.at);
const KEYINFO = OB.key || {};
const TONIC = KEYINFO.tonic != null ? KEYINFO.tonic : 0;
const NOTE_ORDER = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const MOODS = (function () {
  const mo = OB.mood;
  if (!mo || !mo.value || !mo.at) return null;
  return { at: mo.at, v: mo.value, terms: mo.terms || null };
})();

const STEREO = (function () {
  const s = OB.stereo;
  if (!s) return null;
  const at = s.at || null,
    w = s.width_series || s.width || null,
    p = s.pan_series || s.pan || null;
  if (at && Array.isArray(w))
    return { at: at, w: w, p: Array.isArray(p) ? p : null };
  return null;
})();

const VOCAL_GAPS = (OB.vocal_silence && OB.vocal_silence.spans) || [];
function voiceAbsent(t) {
  for (const s of VOCAL_GAPS) {
    const a = Array.isArray(s) ? s[0] : s.from,
      b = Array.isArray(s) ? s[1] : s.to;
    if (t >= a && t < b) return true;
  }
  return false;
}

const PHRASE = (function () {
  const p = OB.phrase_grid;
  if (!p) return { len: 4, off: 0 };
  return { len: p.bars || p.length_bars || 4, off: p.offset || 0 };
})();

const MOMENTS = (M.moments || [])
  .filter((x) => x && x.at != null)
  .sort((a, b) => a.at - b.at);
const SPANS = (M.spans || []).filter(
  (s) => s && s.from != null && s.to != null,
);
const CHAPTERS = (M.chapters || [])
  .filter((c) => c && c.at != null)
  .sort((a, b) => a.at - b.at);

const ACC = (function () {
  const ev = (M.accents || {}).events || [];
  const by = {};
  for (const e of ev) {
    const k = e.of || "other";
    (by[k] = by[k] || []).push(e.at);
  }
  for (const k in by) by[k].sort((a, b) => a - b);
  return by;
})();
function nearestHits(kind, t, back, fwd) {
    const a = ACC[kind];
    if (!a || !a.length) return [];
    let i = idxAtOrBefore(a, t + fwd);
    const out = [];
    for (let j = i; j >= 0 && j > i - 6; j--) {
      const d = t - a[j];
      if (d > back) break;
      out.push(d);
    }
    return out;
  }
  const ATK = 0.045;
  function hitEnv(kind, t, decay) {
    const ds = nearestHits(kind, t, decay, ATK);
    let best = 0;
    for (const d of ds) {
      let v = 0;
      if (d < 0) v = d > -ATK ? 1 + d / ATK : 0;
      else if (d <= decay) v = Math.pow(1 - d / decay, 1.15);
      if (v > best) best = v;
    }
    return best;
  }
function barIndex(t) {
  const i = idxAtOrBefore(DOWN_A, t);
  return i < 0 ? 0 : i;
}
function barStart(t) {
  const i = barIndex(t);
  return DOWN_A[i] != null ? DOWN_A[i] : PHASE;
}
function inBar(t) {
  const s = barStart(t);
  return sat((t - s) / BAR);
}
function beatPos(t) {
  const x = (t - PHASE) / PER;
  return x - Math.floor(x);
}
function phraseIndex(t) {
  return Math.floor((barIndex(t) - PHRASE.off) / Math.max(1, PHRASE.len));
}
function phraseThrough(t) {
  const L = Math.max(1, PHRASE.len);
  const b = barIndex(t) - PHRASE.off;
  const within = ((b % L) + L) % L;
  return sat((within + inBar(t)) / L);
}

function anticAt(t) {
  const i = idxAtOrBefore(ANTIC_T, t);
  return i < 0 ? null : ANTIC[i];
}
function leadAt(t) {
  const i = idxAtOrBefore(LEAD_T, t);
  return i < 0 ? null : LEAD[i];
}
function chordAt(t) {
  const i = idxAtOrBefore(CHORD_T, t);
  return i < 0 ? null : CHORDS[i];
}
function insideRise(t) {
  for (const s of SPANS)
    if (t >= s.from && t < s.to)
      return {
        s: s,
        through: sat((t - s.from) / Math.max(1e-6, s.to - s.from)),
      };
  return null;
}
function nextMoment(t, kinds) {
  for (const m of MOMENTS)
    if (m.at > t - 1e-6 && (!kinds || kinds.indexOf(m.kind) >= 0)) return m;
  return null;
}
function lastMoment(t, kinds) {
  let r = null;
  for (const m of MOMENTS) {
    if (m.at > t + 1e-6) break;
    if (!kinds || kinds.indexOf(m.kind) >= 0) r = m;
  }
  return r;
}
function chapterAt(t) {
  const i = idxAtOrBefore(
    CHAPTERS.map((c) => c.at),
    t,
  );
  return i < 0 ? null : CHAPTERS[i];
}

const ARC_CEIL = (function () {
  return function (t) {
    const f = sat(t / Math.max(1e-6, DUR_S));
    const d = Math.abs(f - PEAK_F);
    return 0.72 + 0.28 * (1 - smooth(clamp(d / 0.45, 0, 1)));
  };
})();

function energyAt(t) {
  return sat(seriesSmooth(EN, t, 0.5));
}
function surpriseAt(t) {
  const v = seriesAt(SURP, t, null);
  return v == null ? 0.25 : sat(v);
}

function pumpAt(t) {
  const p = OB.pump;
  if (!p || p.depth == null) return 1;
  const d = clamp(Math.abs(p.depth), 0, 0.4);
  const x = beatPos(t);
  const duck = Math.exp(-Math.pow(x / 0.16, 2));
  return 1 - d * duck;
}

function hueForChord(t) {
  const c = chordAt(t);
  let semis = 0,
    minor = false;
  if (c && c.chord) {
    let root = c.chord[0];
    if (c.chord.length > 1 && c.chord[1] === "#") root += "#";
    const ri = NOTE_ORDER.indexOf(root);
    if (ri >= 0) semis = (((ri - TONIC) % 12) + 12) % 12;
    minor = /m/.test(c.chord.slice(root.length));
  }
  const fifths = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].indexOf(semis);
  const around = fifths < 0 ? 0 : fifths / 12;
  return { h: around, minor: minor };
}

function hsl2rgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6,
    x = c * (1 - Math.abs((hp % 2) - 1)),
    m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [
    Math.round(255 * (r + m)),
    Math.round(255 * (g + m)),
    Math.round(255 * (b + m)),
  ];
}

const PALETTE = (function () {
  const base = 0.58;
  return function (t) {
    const { h, minor } = hueForChord(t);
    const ton = TONAL ? sat(seriesSmooth(TONAL, t, 0.5)) : 0.5;
    const harm = HARM ? sat(seriesSmooth(HARM, t, 0.2)) : 0.2;
    const mood = MOODS
      ? seriesSmooth(
          {
            at: MOODS.at,
            v: MOODS.v.map((r) => (Array.isArray(r) ? r[0] || 0 : r)),
          },
          t,
          0.5,
        )
      : 0.5;
    const warm = clamp(0.5 + (mood - 0.5) * 0.8, 0, 1);
    const drift = (harm - 0.2) * 0.09;
    const hue = (base + h * 0.42 + (warm - 0.5) * 0.1 + drift) % 1;
    const s = clamp((minor ? 0.72 : 0.58) * (0.55 + 0.55 * ton), 0, 1);
    return { hue: hue, sat: s, ton: ton, harm: harm };
  };
})();

const GEO = { xs: null, zs: null };
const FX = () => LAYOUT.fixtures || [];
const LIM = () => LAYOUT.limits || {};
function fam(f) {
  const k = (f.kind || f.type || "").toLowerCase();
  if (k === "beam" || k === "spot") return k;
  if (k === "wash" || k === "par" || k === "uplight" || k === "wall") return k;
  return k;
}
function can(f, what) {
  return (f.can || []).indexOf(what) >= 0;
}
function xn(f) {
  if (!GEO.xs) {
    const xs = FX().map((g) => (g.at ? g.at[0] : 0));
    GEO.xs = [Math.min.apply(null, xs), Math.max.apply(null, xs)];
  }
  const lo = GEO.xs[0], hi = GEO.xs[1];
  return hi > lo ? ((f.at ? f.at[0] : 0) - lo) / (hi - lo) : 0.5;
}
function zn(f) {
  if (!GEO.zs) {
    const zs = FX().map((g) => (g.at ? g.at[2] : 0));
    GEO.zs = [Math.min.apply(null, zs), Math.max.apply(null, zs)];
  }
  const lo = GEO.zs[0], hi = GEO.zs[1];
  return hi > lo ? ((f.at ? f.at[2] : 0) - lo) / (hi - lo) : 0.5;
}

const LEAD_ZONE = {
  vocals: 0.5,
  drums: 0.5,
  bass: 0.18,
  guitar: 0.78,
  piano: 0.3,
  other: 0.62,
};


  const LOOK_BACK = 8;
  function rawLook(bt) {
    const e = energyAt(bt);
    const rise = insideRise(bt);
    const lm = lastMoment(bt, ["drop", "stop"]);
    const since = lm ? (bt - lm.at) / BAR : 99;
    const ch = chapterAt(bt);
    if (lm && lm.kind === "stop" && since < 1.0) return "stop";
    if (rise) return "rise";
    if (lm && lm.kind === "drop" && e > 0.5) return "drop";
    if (e < 0.3) return "quiet";
    if (ch && /intro|outro/.test(ch.name || "") && e < 0.42) return "quiet";
    return "body";
  }
  function lookForBar(t) {
    const bi = barIndex(t);
    const from = Math.max(0, bi - LOOK_BACK);
    let prev = null, held = 0;
    for (let j = from; j <= bi; j++) {
      const bt = DOWN_A[j] != null ? DOWN_A[j] : t;
      let want = rawLook(bt);
      if (prev != null && want !== prev) {
        const forced = want === "stop" || want === "drop" || prev === "stop";
        if (!forced && held < 2 && surpriseAt(bt) < 0.45) want = prev;
      }
      if (want === prev) held++; else held = 0;
      prev = want;
    }
    return prev == null ? "body" : prev;
  }

  function frame(t) {
  const ceil = ARC_CEIL(t);
  const en = energyAt(t);
  const surp = surpriseAt(t);
  const a = anticAt(t);
  const rise = insideRise(t);
  const nd = nextMoment(t, ["drop"]);
  const lm = lastMoment(t, ["drop", "stop"]);
  const ch = chapterAt(t);
  const pal = PALETTE(t);
  const pump = pumpAt(t);
  const lead = leadAt(t);
  const voice = VOICE ? sat(seriesSmooth(VOICE, t, 0.4)) : 0.4;
  const nov = NOV ? sat(seriesAt(NOV, t, 0)) : 0;

  const barsToDrop = nd ? (nd.at - t) / BAR : 99;
  const sinceEvent = lm ? (t - lm.at) / BAR : 99;
  const inDrop =
    lm && lm.kind === "drop" && sinceEvent < 999 && (!nd || barsToDrop > 0.02);
  const stopped = lm && lm.kind === "stop" && sinceEvent < 1.0;

  const look = lookForBar(t);
  const riseT = rise ? rise.through : 0;
  const dipBefore =
    barsToDrop > 0 && barsToDrop < 0.5 ? 1 - smooth(barsToDrop / 0.5) : 0;
  const punch = lm && lm.kind === "drop" ? Math.exp(-sinceEvent / 1.6) : 0;

  let base = 0.1 + 0.62 * ease(en);
  if (look === "rise") base = 0.14 + 0.6 * ease(0.15 + riseT * 0.95);
  if (look === "drop") base = 0.34 + 0.56 * ease(en);
  if (look === "quiet") base = 0.07 + 0.24 * ease(en);
  if (look === "stop") base = 0.03 + 0.05 * (1 - smooth(sinceEvent));
  base *= 1 - 0.72 * dipBefore;
  base = sat(base * (1 + 0.30 * punch));
  base = sat(base * ceil) * pump;

  const wide = STEREO
    ? sat(seriesSmooth({ at: STEREO.at, v: STEREO.w }, t, 0.4))
    : 0.45;
  const panBias =
    STEREO && STEREO.p
      ? clamp(seriesSmooth({ at: STEREO.at, v: STEREO.p }, t, 0), -1, 1)
      : 0;

  const kick = hitEnv("kick", t, 0.20);
  const snare = hitEnv("snare", t, 0.24);
  const hat = hitEnv("hat", t, 0.13);
  const bassh = hitEnv("bass", t, 0.26);

  const phr = phraseThrough(t);
  const pIdx = phraseIndex(t);
  const fan = 0.3 + 0.55 * wide * (look === "drop" ? 1 : 0.7);
  const roomGain =
    look === "stop" ? 0.34 :
    look === "quiet" ? 0.58 :
    look === "rise" ? 0.68 + 0.34 * ease(riseT) :
    look === "drop" ? 1.18 :
    0.86;
  const riseLift = roomGain;
  const SUSTAINED = { wash: 1, par: 1, wall: 1, uplight: 1, beam: 1, spot: 1, bar: 1, sky: 1 };
  const wipe = smooth(clamp((nov - 0.55) / 0.45, 0, 1)) * (1 - smooth(inBar(t)));
  const sweepDir = pIdx % 2 === 0 ? 1 : -1;
  const sweep = Math.sin(phr * Math.PI * 2 + (pIdx % 4) * 0.5) * 0.5 * sweepDir;

  const maxStrobe = LIM().max_strobe_hz || 4;
  const lasersAllowed = !!(LIM().laser_zones && LIM().laser_zones.length);
  const laserMinH =
    LIM().laser_min_height_m != null ? LIM().laser_min_height_m : 3;

  const out = [];
  for (const f of FX()) {
    const k = fam(f);
    const x = xn(f),
      z = zn(f);
    const side = (x - 0.5) * 2;
    let level = 0,
      rgb = null,
      pan = null,
      tilt = null,
      strobe = 0,
      pixels = null;

    if (k === "wash" || k === "par" || k === "wall") {
      const spread = 1 - 0.45 * Math.abs(side - panBias * 0.5) * (1 - wide);
      level = base * (0.72 + 0.28 * spread);
      if (look === "drop") level = Math.min(1, level + 0.16 * punch);
      const l = clamp(0.26 + 0.3 * level, 0.05, 0.62);
      rgb = hsl2rgb(pal.hue + side * 0.02, pal.sat, l);
    } else if (k === "uplight") {
      const e = Math.max(kick, bassh * 0.7);
      level = sat(base * 0.42 + 0.52 * e * (0.55 + 0.45 * en));
      const l = clamp(0.24 + 0.34 * level, 0.05, 0.6);
      let bh = 0;
      if (BASSN) {
        const i = Math.min(BASSN.length - 1, Math.max(0, idxAtOrBefore(BEATS_A, t)));
        const nn = BASSN[i];
        const midi = Array.isArray(nn) ? nn[2] : (nn && nn.midi);
        if (typeof midi === "number") bh = (((midi - TONIC) % 12) + 12) % 12 / 12 * 0.10;
      }
      rgb = hsl2rgb(pal.hue + 0.035 + bh, clamp(pal.sat + 0.1, 0, 1), l);
    } else if (k === "blinder") {
      const on = look === "drop" ? 0.28 + 0.62 * snare : 0.55 * snare;
      level = sat(on * ceil * (look === "quiet" ? 0.25 : 1));
      rgb = [255, 246, 226];
    } else if (k === "beam") {
      const alive =
        look === "quiet" ? 0.2 : look === "stop" ? 0.05 : 0.55 + 0.45 * en;
      const pulse = 0.55 + 0.45 * Math.max(kick * 0.8, snare * 0.6);
      level = sat(base * 0.85 * alive * pulse);
      if (look === "rise") level = sat(level * (0.5 + 0.7 * riseT));
      pan = clamp(
        0.5 + side * fan * 0.5 + sweep * 0.22 + panBias * 0.06 + wipe * 0.10 * (x - 0.5),
        0.02,
        0.98,
      );
      const lift =
        look === "drop" ? 0.3 : look === "rise" ? 0.3 + 0.34 * riseT : 0.46;
      tilt = clamp(
        lift + 0.1 * Math.sin(phr * Math.PI * 2) * (look === "quiet" ? 0.3 : 1),
        0.02,
        0.98,
      );
      const l = clamp(0.3 + 0.34 * level, 0.06, 0.66);
      rgb = hsl2rgb(
        pal.hue + 0.5 + side * 0.03,
        clamp(pal.sat + 0.16, 0, 1),
        l,
      );
    } else if (k === "spot") {
      const who = lead ? lead.of : null;
      const target = who && LEAD_ZONE[who] != null ? LEAD_ZONE[who] : 0.5;
      const mute = who === "vocals" && voiceAbsent(t) ? 0.25 : 1;
      const conf = lead ? sat((lead.margin_over_next || 0) / 1.2) : 0.3;
      level = sat((0.2 + 0.55 * ease(en)) * ceil * mute * (0.55 + 0.45 * conf));
      if (look === "stop") level = sat(level * 0.5 + 0.18);
      pan = clamp(lerp(0.5, target, 0.85) + sweep * 0.05, 0.05, 0.95);
      tilt = clamp(
        0.6 - 0.16 * (MELC ? sat(seriesSmooth(MELC, t, 0.5)) : 0.5),
        0.05,
        0.95,
      );
      rgb = hsl2rgb(
        pal.hue + 0.02 - 0.05 * (voice - 0.4),
        clamp(pal.sat * (0.30 + 0.55 * voice), 0, 1),
        clamp(0.44 + 0.22 * level, 0.1, 0.72),
      );
    } else if (k === "bar") {
      const n = f.pixels || 12;
      pixels = [];
      const notes = MELC ? sat(seriesSmooth(MELC, t, 0.5)) : 0.5;
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0.5;
        const near = 1 - Math.min(1, Math.abs(u - notes) * 3.2);
        const runner = Math.max(0, 1 - Math.abs(((phr * 2) % 1) - u) * 4);
        const amp = sat(
          base * (0.35 + 0.4 * near) +
            0.45 * hat * runner +
            0.25 * kick * (1 - u),
        );
        const l = clamp(0.1 + 0.42 * amp, 0, 0.6);
        pixels.push(
          hsl2rgb(pal.hue + 0.5 + u * 0.06, clamp(pal.sat + 0.1, 0, 1), l),
        );
      }
    } else if (k === "strobe") {
      const fire =
        (look === "drop" && punch > 0.35) || (surp > 0.72 && look !== "quiet");
      level = fire ? 0.85 : 0;
      strobe = fire ? clamp(1.6 + 2.4 * en, 0, maxStrobe) : 0;
      rgb = [255, 255, 255];
    } else if (k === "laser") {
      const high = (f.at ? f.at[2] : 9) >= laserMinH;
      const fire =
        lasersAllowed &&
        high &&
        (look === "drop" || (look === "rise" && riseT > 0.7));
      level = fire ? sat(0.35 + 0.45 * en) : 0;
      rgb = hsl2rgb(pal.hue + 0.42, 0.9, 0.42);
    } else if (k === "fog" || k === "haze") {
      level = clamp(
        0.18 + 0.3 * en + 0.25 * (look === "rise" ? riseT : 0),
        0,
        0.8,
      );
      rgb = null;
    } else if (k === "co2") {
      level = look === "drop" && punch > 0.72 ? 1 : 0;
    } else if (k === "pyro" || k === "confetti") {
      const big =
        lm &&
        lm.kind === "drop" &&
        sinceEvent < 0.12 &&
        (lm.size || 0) >= 0.9 &&
        Math.abs(t / Math.max(1e-6, DUR_S) - PEAK_F) < 0.22;
      level = big ? 1 : 0;
    } else if (k === "sky") {
      level = sat(base * 0.6);
      rgb = hsl2rgb(pal.hue + 0.5, pal.sat, clamp(0.18 + 0.2 * level, 0, 0.5));
    } else {
      level = sat(base * 0.5);
      rgb = hsl2rgb(pal.hue, pal.sat * 0.6, clamp(0.2 + 0.25 * level, 0, 0.55));
    }

    if (SUSTAINED[k]) {
      level *= riseLift;
      if (pixels) {
        for (const px of pixels) { px[0] = Math.min(255, Math.round(px[0] * riseLift)); px[1] = Math.min(255, Math.round(px[1] * riseLift)); px[2] = Math.round(px[2] * riseLift) }
      }
    }
    const o = { id: f.id };
    if (pixels) {
      o.pixels = pixels;
    } else {
      o.level = +sat(level).toFixed(4);
      if (rgb && o.level > 0) {
        o.r = rgb[0];
        o.g = rgb[1];
        o.b = rgb[2];
      } else if (rgb) {
        o.r = 0;
        o.g = 0;
        o.b = 0;
      }
      if (pan != null && can(f, "move")) o.pan = +pan.toFixed(4);
      if (tilt != null && can(f, "move")) o.tilt = +tilt.toFixed(4);
      if (strobe > 0 && can(f, "strobe")) o.strobe = +strobe.toFixed(2);
    }
    out.push(o);
  }
  return { t: +t.toFixed(3), look: look, fixtures: out };
}

  function bi(t) {
    const i = idxAtOrBefore(BEATS_A, t);
    return i < 0 ? 0 : i;
  }
  function en(t) { return energyAt(t) }
  function stem(k, t) {
    const src = ((M.stems || {}).sources) || {};
    const seq = src[k];
    if (!seq || !seq.length) return 0;
    const i = Math.min(seq.length - 1, Math.max(0, barIndex(t)));
    return sat(+seq[i] || 0);
  }
  function primaryLook(t) { return frame(t).look }
  function sectionAt(t) { return chapterAt(t) }
  const DBP = (function () {
    const d = DOWN_A[0];
    const i = idxAtOrBefore(BEATS_A, d == null ? 0 : d);
    return i < 0 ? 0 : i;
  })();
  function rebuildGeo() { GEO.xs = null; GEO.zs = null; }
  return { frame: frame, bi: bi, en: en, stem: stem, primaryLook: primaryLook,
           sectionAt: sectionAt, DBP: DBP, rebuildGeo: rebuildGeo };
})();
frame = __SHOW.frame;
if (typeof rebuildGeo === "function") {
  const __oldGeo = rebuildGeo;
  rebuildGeo = function () { __oldGeo(); __SHOW.rebuildGeo() };
} else {
  rebuildGeo = __SHOW.rebuildGeo;
}
