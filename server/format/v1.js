export const KNOWN = [
  "song",
  "grid",
  "beats",
  "downbeats",
  "sections",
  "energy",
  "groove",
  "melody_phrases",
  "moments",
  "chords",
  "key",
  "loudness",
  "feel",
  "melody",
  "made_by",
  "lyrics",
  "recording",
  "caption",
  "btc_chords_raw",
  "stems",
  "beat_consensus",
  "emotion",
  "sections_second_opinion",
  "instruments",
  "instruments_over_time",
  "harmony",
  "chord_changes",
  "chord_summary",
  "key_tempo",
  "rhythm",
  "curves",
  "signals",
  "layers",
  "tells",
  "motion",
  "unavailable",
];

const STEM_NAMES = ["drums", "bass", "vocals", "other", "guitar", "piano"];
const CURVE_NAMES = ["energy", "brightness", "width", "air", "pump", "pace",
                     "weight", "floor", "noisy", "sustained"];

export function format(raw) {
  const out = {};
  const grid = raw.grid || {};
  const bpm = grid.bpm || 120;
  const bpb = grid.beats_per_bar || 4;
  const firstBeatS = grid.first_beat_s || 0;
  const beatSec = 60 / bpm;
  const barSec = beatSec * bpb;
  const firstBar =
    grid.first_bar !== undefined && grid.first_bar !== null
      ? grid.first_bar
      : firstBeatS > 0.2
        ? 0
        : 1;

  const tempoMap =
    Array.isArray(grid.tempo) && grid.tempo.length
      ? grid.tempo
      : [{ from_beat: 0, at_s: firstBeatS, bpm }];
  const beatOf = (t) => {
    let k = 0;
    while (k + 1 < tempoMap.length && tempoMap[k + 1].at_s <= t) k++;
    const seg = tempoMap[k];
    return seg.from_beat + (t - seg.at_s) / (60 / seg.bpm);
  };
  const atBeat = (n) => {
    let k = 0;
    while (k + 1 < tempoMap.length && tempoMap[k + 1].from_beat <= n) k++;
    const seg = tempoMap[k];
    return seg.at_s + (n - seg.from_beat) * (60 / seg.bpm);
  };
  const place = (t) => {
    const n = Math.round(beatOf(t));
    return {
      bar: Math.max(firstBar, 1 + Math.floor(n / bpb)),
      beat: 1 + (((n % bpb) + bpb) % bpb),
    };
  };

  /* A score that does not name itself is named by its song, and a score with
     no version is version 0 -- the one the pipeline writes. Leaving these
     undefined made the protocol answer without an envelope whenever a score
     was built by a run that predated them. */
  const named = raw.score != null ? raw.score : (raw.song || {}).slug;
  if (named != null) out.score = named;
  out.version = raw.version != null ? raw.version : 0;

  if (raw.song) {
    out.song = { ...raw.song };
    if (
      out.song.bars === undefined &&
      grid.bars !== undefined &&
      grid.bars !== null
    ) {
      out.song.bars = grid.bars;
    } else if (out.song.bars === undefined && out.song.length_s && bpm) {
      out.song.bars = Math.ceil((out.song.length_s - firstBeatS) / barSec);
    }
  }

  if (raw.grid) {
    out.grid = { ...raw.grid };
    if (raw.grid.holds_from_s != null)
      out.grid.holds_from = place(raw.grid.holds_from_s);
    if (raw.grid.holds_to_s != null)
      out.grid.holds_to = place(raw.grid.holds_to_s);
  }

  if (raw.beats) {
    if (raw.beats.list) {
      out.beats = raw.beats;
    } else if (Array.isArray(raw.beats)) {
      const beatNo = beatOf;
      let lead = 0;
      out.beats = raw.beats.map((b, idx) => {
        const n = b.t != null ? Math.round(beatNo(b.t)) : idx;
        const drift = (t, at) => {
          if (b.off_ms !== undefined) return Math.round(b.off_ms);
          if (t == null) return undefined;
          return Math.round((t - at) * 1000);
        };
        if (n < 0) {
          lead += 1;
          const off = drift(b.t, atBeat(n));
          return Object.assign(
            { bar: firstBar, beat: lead },
            b.t !== undefined ? { t: b.t } : {},
            b.weight !== undefined ? { weight: b.weight } : {},
            b.sure !== undefined ? { sure: b.sure } : {},
            off !== undefined ? { off_ms: off } : {},
            b.downbeat !== undefined ? { downbeat: b.downbeat } : {},
          );
        }
        const bar = Math.max(firstBar, 1 + Math.floor(n / bpb));
        const beat = 1 + (((n % bpb) + bpb) % bpb);
        const entry = { bar, beat };
        if (b.t !== undefined) entry.t = b.t;
        if (b.weight !== undefined) entry.weight = b.weight;
        if (b.sure !== undefined) entry.sure = b.sure;
        const off = drift(b.t, atBeat(n));
        if (off !== undefined) entry.off_ms = off;
        if (b.downbeat !== undefined) entry.downbeat = b.downbeat;
        return entry;
      });
    }
  }
  if (raw.downbeats) out.downbeats = raw.downbeats;
  else if (Array.isArray(out.beats) && Array.isArray(raw.beats)) {
    const flagged = out.beats.filter(
      (_, i) => raw.beats[i] && raw.beats[i].downbeat,
    );
    out.downbeats = flagged.length
      ? flagged
      : out.beats.filter((b) => b.beat === 1);
  }

  const formSpans = raw.layers && raw.layers.form && raw.layers.form.spans;
  if (Array.isArray(formSpans) && formSpans.length) {
    out.sections = formSpans.map((sp) => {
      const row = { from: sp.from, to: sp.to, name: sp.name, repeat: sp.repeat };
      for (const extra of ["rise", "playing", "stems", "fullness", "feels"])
        if (sp[extra] != null) row[extra] = sp[extra];
      return row;
    });
  } else if (Array.isArray(raw.sections) && raw.sections.length) {
    out.sections = raw.sections.map((s, i) => {
      const from =
        s.from_bar != null ? { bar: s.from_bar, beat: 1 } : place(s.start);
      const to =
        s.to_bar != null ? { bar: s.to_bar + 1, beat: 1 } : place(s.end);
      /* A score that has already been through this formatter once carries the
         section name under `name`; a raw one carries it under `label`. Reading
         only `label` silently dropped every section name on the second pass --
         the response came back with seven unnamed sections and nothing failed. */
      const label = s.label != null ? s.label : s.name;
      const row = { from, to, name: label, start: s.start, end: s.end,
                    nth: i + 1, like: label };
      if (raw.sections.findIndex((o) => (o.label != null ? o.label : o.name) === label) < i)
        row.repeat = label;
      if (s.also_heard) row.also_heard = s.also_heard;
      for (const extra of ["confidence", "edge", "sudden", "sure"])
        if (s[extra] !== undefined) row[extra] = s[extra];
      return row;
    });
  } else if (Array.isArray(raw.parts)) {
    out.sections = raw.parts.map((part) => {
      const row = {
        from: { bar: part.from_bar, beat: 1 },
        to: { bar: part.to_bar + 1, beat: 1 },
        name: part.role,
        nth: part.nth,
        like: part.like,
        feels: part.feels,
        playing: part.playing,
        fullness: part.fullness,
      };
      if (part.returns) row.repeat = part.like;
      for (const extra of ["rise", "sure", "trades", "also_heard", "edge",
                           "sudden", "stems"])
        if (part[extra] !== undefined) row[extra] = part[extra];
      return row;
    });
  }

  if (raw.ticks) out.ticks = raw.ticks;
  if (raw.per_beat) out.per_beat = raw.per_beat;
  if (raw.groove) out.groove = raw.groove;
  if (Array.isArray(raw.melody_phrases))
    out.melody_phrases = raw.melody_phrases;
  if (raw.curve_tells) {
    const said = {};
    for (const [name, v] of Object.entries(raw.curve_tells)) {
      said[name === "intensity" ? "energy" : name] = v;
    }
    if (Object.keys(said).length) out.tells = said;
  }
  if (raw.lyrics) out.lyrics = raw.lyrics;

  const barEnergy = () => {
    const lanes = Object.values(raw.stems_temporal?.stems || {}).filter(
      (v) => Array.isArray(v) && v.length,
    );
    if (!lanes.length || !grid.bars) return null;
    const w = raw.stems_temporal.window_s || 0.5;
    const n = Math.min(...lanes.map((v) => v.length));
    const mean = [];
    for (let i = 0; i < n; i++)
      mean.push(lanes.reduce((a, v) => a + v[i], 0) / lanes.length);
    const per = [];
    for (let b = 0; b < grid.bars; b++) {
      const a = Math.floor(atBeat(b * bpb) / w);
      const z = Math.max(a + 1, Math.floor(atBeat((b + 1) * bpb) / w));
      const cut = mean.slice(Math.max(0, a), Math.min(n, z));
      per.push(cut.length ? cut.reduce((x, y) => x + y, 0) / cut.length : 0);
    }
    const top = Math.max(...per);
    if (!(top > 0)) return null;
    return per.map((v) => +(v / top).toFixed(3));
  };

  if (raw.energy) {
    out.energy = raw.energy;
  } else if (Array.isArray(raw.bars?.intensity)) {
    out.energy = { per: "bar", from_bar: firstBar, values: raw.bars.intensity };
  } else {
    const per = barEnergy();
    if (per)
      out.energy = { per: "bar", from_bar: firstBar, values: per,
                     normalised: "per-song-peak" };
  }
  if (out.energy && out.tells && out.tells.energy !== undefined) {
    out.energy.tells = out.tells.energy;
  }

  if (raw.phrases) out.phrases = raw.phrases;
  if (raw.melody) out.melody = raw.melody;
  if (raw.voice) out.voice = raw.voice;
  if (raw.lead) out.lead = raw.lead;
  {
    const pull = raw.lift ?? raw.tension;
    if (pull) out.tension = out.lift = { per: "beat", values: pull };
  }
  if (Array.isArray(raw.releases)) {
    out.releases = raw.releases.map((r) => {
      const at =
        r.bar != null && r.beat != null ? { bar: r.bar, beat: r.beat } : place(r.at_s);
      const one = { at, jump: r.jump !== undefined ? r.jump : r.size };
      if (r.at_s != null) one.at_s = r.at_s;
      return one;
    });
  }
  if (raw.phrase_grid) out.phrase_grid = raw.phrase_grid;
  if (raw.scales) out.scales = raw.scales;
  if (raw.made_by) out.made_by = raw.made_by;
  if (raw.recording) out.recording = raw.recording;
  if (raw.chord_changes) out.chord_changes = raw.chord_changes;
  if (raw.presence) out.presence = raw.presence;

  const bars = raw.bars || {};

  const curveEntries = {};
  for (const name of CURVE_NAMES) {
    let src;
    if (name === "energy") src = out.energy?.values || bars.intensity;
    else src = bars[name];
    if (Array.isArray(src)) {
      const lane = name === "energy" ? "intensity" : name;
      curveEntries[name] = {
        per: "bar",
        from_bar:
          name === "energy" && out.energy?.from_bar != null
            ? out.energy.from_bar
            : firstBar,
        values: src,
      };
      if (raw.curve_tells?.[lane] != null)
        curveEntries[name].tells = raw.curve_tells[lane];
    }
  }
  if (Object.keys(curveEntries).length) out.curves = curveEntries;

  for (const lane of ["width", "air", "pump", "pace", "brightness",
                      "weight", "floor", "noisy", "sustained"]) {
    if (Array.isArray(bars[lane])) out[lane] = bars[lane];
  }

  const stemLanes = {};
  for (const s of STEM_NAMES) {
    if (Array.isArray(bars[s])) stemLanes[s] = bars[s];
  }
  if (Object.keys(stemLanes).length) {
    out.stems = {
      normalised: "per-stem-peak-within-song",
      from_bar: firstBar,
      lanes: stemLanes,
    };
  }

  if (Array.isArray(raw.moments)) {
    out.moments = raw.moments.map((mo) => {
      if (mo.at) return mo;
      if (mo.time_s != null) return { at: place(mo.time_s), ...mo };
      const { bar, beat, ...rest } = mo;
      return { at: { bar, beat }, ...rest };
    });
  }

  const FAMILY = {
    drums: ["drums", "kick", "snare", "hh", "toms", "percussion", "clap",
            "cymbals", "ride", "crash", "shaker", "tambourine", "congas",
            "bongos", "timpani"],
    bass: ["bass", "double-bass", "sub"],
    vocals: ["vocal", "lead-vocal", "back-vocal", "choir"],
  };
  const familyOf = (name) => {
    const n = name.toLowerCase();
    for (const [fam, members] of Object.entries(FAMILY))
      if (members.some((m) => n === m || n.includes(m))) return fam;
    return "other";
  };

  const perBarFamilies = () => {
    const lanes = raw.stems_temporal?.stems;
    if (!lanes || !grid.bars) return null;
    const w = raw.stems_temporal.window_s || 0.5;
    const pots = { drums: [], bass: [], vocals: [], other: [] };
    for (const [name, v] of Object.entries(lanes))
      if (Array.isArray(v) && v.length) pots[familyOf(name)].push(v);
    const out2 = {};
    for (const [fam, group] of Object.entries(pots)) {
      if (!group.length) continue;
      const n = Math.min(...group.map((v) => v.length));
      const rows = [];
      for (let b = 0; b < grid.bars; b++) {
        const a = Math.floor(atBeat(b * bpb) / w);
        const z = Math.max(a + 1, Math.floor(atBeat((b + 1) * bpb) / w));
        let tot = 0, seen = 0;
        for (const v of group)
          for (let i = Math.max(0, a); i < Math.min(n, z); i++) {
            tot += v[i];
            seen++;
          }
        rows.push(seen ? tot / seen : 0);
      }
      const top = Math.max(...rows);
      out2[fam] = rows.map((x) => (top > 0 ? +(x / top).toFixed(6) : +x.toFixed(6)));
    }
    return Object.keys(out2).length ? out2 : null;
  };

  if (raw.layers) out.layers = { ...raw.layers };
  if (!out.layers) out.layers = {};

  if (!out.layers.presence && !raw.presence) {
    const fam = perBarFamilies();
    if (fam) {
      const spans = [];
      const state = (x) => (x >= 0.55 ? "full" : x >= 0.15 ? "light" : "out");
      for (const [stem, rows] of Object.entries(fam)) {
        const soft = rows.map((_, i) => {
          const cut = rows.slice(Math.max(0, i - 1), i + 2).slice().sort((a, b) => a - b);
          return cut[Math.floor(cut.length / 2)];
        });
        const states = soft.map(state);
        for (let i = 1; i < states.length - 1; i++)
          if (states[i] !== states[i - 1] && states[i - 1] === states[i + 1])
            states[i] = states[i - 1];
        let run = states[0], from = 0;
        for (let b = 1; b <= states.length; b++) {
          const now = b < states.length ? states[b] : null;
          if (now !== run) {
            if (run !== "out" && b - from >= 2)
              spans.push({ from: { bar: firstBar + from, beat: 1 },
                           to: { bar: firstBar + b, beat: 1 },
                           stem, state: run });
            run = now;
            from = b;
          }
        }
      }
      if (spans.length)
        out.layers.presence = { kind: "sparse", derived_from: "stem lanes",
                                spans };
    }
  }

  if (!out.layers.subsection && !Array.isArray(raw.phrases)
      && Array.isArray(out.sections)
      && out.sections.length && Array.isArray(raw.moments)) {
    const lane = out.energy?.values || [];
    const steps = [];
    for (let i = 1; i < lane.length; i++) steps.push(Math.abs(lane[i] - lane[i - 1]));
    steps.sort((a, b) => a - b);
    const typical = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
    const moved = Math.max(0.03, 2 * typical);
    const trend = (a, b) => {
      const cut = lane.slice(Math.max(0, a - firstBar), Math.max(1, b - firstBar));
      if (cut.length < 2) return "steady";
      const half = Math.floor(cut.length / 2) || 1;
      const lo = cut.slice(0, half).reduce((x, y) => x + y, 0) / half;
      const hi = cut.slice(half).reduce((x, y) => x + y, 0) / (cut.length - half);
      if (hi - lo > moved) return "intensifying";
      if (lo - hi > moved) return "easing";
      return "sustaining";
    };
    const word = (doing, nth, last, name) => {
      if (doing !== "sustaining") return doing;
      if (nth === 1) return name === "intro" ? "establishing" : "developing";
      if (nth === last) return name === "outro" ? "closing" : "resolving";
      return "sustaining";
    };
    const famRows = perBarFamilies() || {};
    const playingIn = (a, b) => {
      const on = [];
      for (const [fam, rows] of Object.entries(famRows)) {
        const cut = rows.slice(Math.max(0, a - firstBar), Math.max(1, b - firstBar));
        if (!cut.length) continue;
        const mean = cut.reduce((x, y) => x + y, 0) / cut.length;
        if (mean >= 0.15) on.push(fam);
      }
      return on;
    };
    const spans = [];
    for (const sec of out.sections) {
      const span = sec.to.bar - sec.from.bar;
      const phrase = span >= 16 ? 8 : 4;
      const marks = new Set();
      for (let b = sec.from.bar + phrase; b < sec.to.bar - 1; b += phrase)
        marks.add(b);
      for (const m of raw.moments) {
        if (m.time_s == null) continue;
        const b = place(m.time_s).bar;
        if (b > sec.from.bar + 1 && b < sec.to.bar - 1) marks.add(b);
      }
      const inside = [...marks].sort((a, b) => a - b);
      const cuts = [sec.from.bar];
      for (const b of inside) if (b - cuts[cuts.length - 1] >= 2) cuts.push(b);
      cuts.push(sec.to.bar);
      for (let i = 0; i < cuts.length - 1; i++)
        spans.push({ from: { bar: cuts[i], beat: 1 },
                     to: { bar: cuts[i + 1], beat: 1 },
                     in: sec.name, in_nth: sec.nth, nth: i + 1,
                     doing: word(trend(cuts[i], cuts[i + 1]), i + 1,
                                 cuts.length - 1, sec.name),
                     playing: playingIn(cuts[i], cuts[i + 1]) });
    }
    if (spans.length)
      out.layers.subsection = { kind: "partition",
                                derived_from: "moments and the energy lane",
                                spans };
  }

  if (!out.layers.subsection && Array.isArray(raw.phrases)) {
    out.layers.subsection = {
      kind: "sparse",
      spans: raw.phrases.map((p) => ({
        from: { bar: p.from_bar, beat: 1 },
        to: { bar: p.to_bar + 1, beat: 1 },
        in: p.in,
        in_nth: p.in_nth,
        doing: p.doing,
        also: p.also || [],
        says: p.says,
        energy: p.energy,
        rise: p.rise,
        playing: p.playing,
        has_break: p.break != null || !!p.has_break,
        break: p.break,
      })),
    };
  }

  if (
    !out.layers.presence &&
    raw.presence &&
    typeof raw.presence === "object"
  ) {
    const presSpans = [];
    for (const [stem, spans] of Object.entries(raw.presence)) {
      for (const sp of spans || []) {
        if (sp.is === "out") continue;
        presSpans.push({
          from: { bar: sp.from_bar, beat: 1 },
          to: { bar: sp.to_bar + 1, beat: 1 },
          stem,
          state: sp.is,
        });
      }
    }
    if (presSpans.length)
      out.layers.presence = { kind: "sparse", spans: presSpans };
  }

  if (!out.layers.phrase && raw.phrase_grid) {
    out.layers.phrase = {
      kind: "rule",
      every_bars: raw.phrase_grid.every_bars,
      from_bar: raw.phrase_grid.from_bar,
    };
  }

  if (!out.layers.phrase && !raw.phrase_grid && Array.isArray(out.sections)
      && out.sections.length > 2) {
    const edges = out.sections.map((x) => x.from.bar);
    const start = edges[0];
    let best = null;
    for (const p of [8, 4]) {
      const on = edges.filter((b) => (b - start) % p === 0).length / edges.length;
      if (on >= 0.5) { best = p; break; }
    }
    if (best)
      out.layers.phrase = { kind: "rule", every_bars: best, from_bar: start,
                            derived_from: "where the sections fall" };
  }

  if (!Object.keys(out.layers).length) delete out.layers;

  if (Array.isArray(bars.chord)) {
    out.harmony = {
      from_bar: firstBar,
      chords: bars.chord,
      confidence: bars.chord_sure || [],
    };
  }

  if (Array.isArray(bars.chord)) {
    const changes = [];
    let prev = null;
    bars.chord.forEach((name, i) => {
      if (name && name !== prev) {
        changes.push({
          at: { bar: i + firstBar, beat: 1 },
          to: name,
          confidence: bars.chord_sure?.[i] ?? null,
        });
        prev = name;
      }
    });
    out.chord_changes = changes;
  }

  if (Array.isArray(bars.chord)) {
    out.chords = bars.chord
      .map((name, i) => ({
        bar: i + firstBar,
        name,
        sure: bars.chord_sure?.[i],
      }))
      .filter((c) => c.name);
  }

  if (raw.key || raw.chords) {
    out.key = { ...(raw.key ?? {}) };
    if (raw.chords) out.key.changes_per_beat = raw.chords.changes_per_beat;
  }
  if (raw.chords)
    out.chord_summary = { changes_per_beat: raw.chords.changes_per_beat };
  if (raw.loudness) out.loudness = raw.loudness;
  if (raw.feel) out.feel = raw.feel;

  const person = raw.personality || raw.profile;
  if (person) {
    out.personality = person;
    out.profile = person;
  }

  /* A score that has already been through this formatter carries the chord
     spans under `chords`; only a raw one has btc_chords_raw. Building solely
     from the raw field dropped the whole chord track on the second pass -- and
     the chords are where a lighting designer reads the major-to-minor turn that
     the loudness curve cannot show. */
  if (raw.chords && Array.isArray(raw.chords.spans) && raw.chords.spans.length)
    out.chords = { of: raw.chords.of || "seconds", spans: raw.chords.spans };

  if (Array.isArray(raw.btc_chords_raw) && raw.btc_chords_raw.length) {
    const spans = raw.btc_chords_raw
      .filter((c) => c && Number.isFinite(c.start) && Number.isFinite(c.end))
      .map((c) => ({ start: c.start, end: c.end, chord: String(c.chord) }));
    out.chords = { of: "seconds", spans };

    const bpb = grid.beats_per_bar || 4;
    const barSec = beatSec * bpb;
    if (barSec > 0 && grid.bars) {
      const perBar = [];
      for (let b = 0; b < grid.bars; b++) {
        const a = firstBeatS + b * barSec;
        const z = a + barSec;
        let best = null, bestOverlap = 0;
        for (const c of spans) {
          const ov = Math.min(z, c.end) - Math.max(a, c.start);
          if (ov > bestOverlap) { bestOverlap = ov; best = c.chord; }
        }
        perBar.push(best && best !== "N" ? best : null);
      }
      out.harmony = { from_bar: firstBar, chords: perBar,
                      confidence: perBar.map((c) => (c ? 1 : null)) };
      const seen = {};
      for (const c of perBar) if (c) seen[c] = (seen[c] || 0) + 1;
      const top = Object.entries(seen).sort((a, b) => b[1] - a[1])[0];
      if (top) {
        const m = /^([A-G][#b]?)(.*)$/.exec(top[0]);
        if (m) out.key = { root: m[1], scale: /min|m$/.test(m[2]) ? "minor" : "major",
                           from: "most common BTC chord" };
      }
    }
  }

  if (raw.signals) out.signals = raw.signals;
  if (raw.caption) out.caption = raw.caption;

  if (raw.stems && !Array.isArray(raw.stems)) {
    const lanes = out.stems && out.stems.lanes ? out.stems : null;
    const summary = Object.entries(raw.stems)
      .filter(([, v]) => v && typeof v === "object" && "rms" in v)
      .map(([name, v]) => ({ name, rms: v.rms, peak: v.peak, db: v.db }))
      .sort((a, b) => b.rms - a.rms);
    if (summary.length) out.instruments = { of: "whole recording", heard: summary };
    else if (!lanes) out.stems = raw.stems;
    if (lanes) out.stems = lanes;
  }

  if (raw.stems_temporal && raw.stems_temporal.stems) {
    out.instruments_over_time = {
      per: "window",
      window_s: raw.stems_temporal.window_s,
      normalised: "per-instrument-peak-within-song",
      lanes: raw.stems_temporal.stems,
    };
  }

  if (raw.motion) out.motion = raw.motion;
  if (raw.unavailable && Object.keys(raw.unavailable).length)
    out.unavailable = raw.unavailable;
  if (raw.sections_second_opinion)
    out.sections_second_opinion = raw.sections_second_opinion;
  if (raw.rhythm) out.rhythm = raw.rhythm;
  if (raw.key_tempo) out.key_tempo = raw.key_tempo;
  if (raw.beat_consensus) out.beat_consensus = raw.beat_consensus;
  if (raw.emotion) out.emotion = raw.emotion;

  /* EVERY ADDRESSED THING CARRIES AN ABSOLUTE TIME.
     A bar-and-beat is a musician's name for a position, not the position: it
     only means something against one particular fitted grid, so anything
     addressed in bars alone detaches the moment that grid is refitted -- which
     is how `layers` came to describe a song it no longer covered while every
     test still passed. Seconds are the anchor and survive a refit; bar and beat
     travel alongside as the supporting evidence, for musicians and for editors
     that want to snap. Both, on everything, always. */
  const secondsOf = (bar, beat = 1) => +atBeat((bar - 1) * bpb + (beat - 1)).toFixed(3);
  const LEN = (raw.song && raw.song.length_s) || 1e9;
  const clampS = (x) => +Math.max(0, Math.min(x, LEN)).toFixed(3);
  /* A thing that already knows its own time is the authority on it. Deriving the
     time back out of the bar label would round it to the grid and, for anything
     starting before bar 1, produce a negative second. */
  const OWN_TIME = { from_s: ["start"], to_s: ["end"], at_s: ["time_s", "t"] };
  const stamp = (node) => {
    if (Array.isArray(node)) return node.map(stamp);
    if (!node || typeof node !== "object") return node;
    const o = {};
    for (const k of Object.keys(node)) o[k] = stamp(node[k]);
    if (typeof o.bar === "number" && typeof o.beat === "number" && o.t == null && o.at_s == null)
      o.at_s = clampS(secondsOf(o.bar, o.beat));
    for (const [k, name] of [["from", "from_s"], ["to", "to_s"], ["at", "at_s"]]) {
      if (o[name] != null) continue;
      const src = OWN_TIME[name].map(n => o[n]).find(v => typeof v === "number");
      if (src != null) { o[name] = clampS(src); continue; }
      if (o[k] && typeof o[k].bar === "number") o[name] = clampS(secondsOf(o[k].bar, o[k].beat ?? 1));
    }
    return o;
  };
  for (const name of ["sections", "moments", "layers", "phrases", "harmony", "chords"])
    if (out[name] != null) out[name] = stamp(out[name]);
  if (out.energy && Array.isArray(out.energy.values) && out.energy.times == null) {
    const fb = out.energy.from_bar ?? firstBar;
    out.energy = {
      ...out.energy,
      from_s: clampS(secondsOf(fb)),
      times: out.energy.values.map((_, i) => clampS(secondsOf(fb + i))),
      anchored: "one time per value, so the curve can be read without the grid",
    };
  }

  return out;
}
