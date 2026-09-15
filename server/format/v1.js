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

  out.score = raw.score;
  out.version = raw.version;

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
    const map =
      raw.grid.tempo && raw.grid.tempo.length
        ? raw.grid.tempo
        : [{ from_beat: 0, at_s: firstBeatS, bpm }];
    const beatOf = (t) => {
      let k = 0;
      while (k + 1 < map.length && map[k + 1].at_s <= t) k++;
      return map[k].from_beat + (t - map[k].at_s) / (60 / map[k].bpm);
    };
    const place = (t) => {
      const i = beatOf(t);
      return {
        bar: firstBar + Math.floor(i / bpb),
        beat: Math.floor(((i % bpb) + bpb) % bpb) + 1,
      };
    };
    if (raw.grid.holds_from_s != null)
      out.grid.holds_from = place(raw.grid.holds_from_s);
    if (raw.grid.holds_to_s != null)
      out.grid.holds_to = place(raw.grid.holds_to_s);
  }

  if (raw.beats) {
    if (raw.beats.list) {
      out.beats = raw.beats;
    } else if (Array.isArray(raw.beats)) {
      const map =
        Array.isArray(grid.tempo) && grid.tempo.length
          ? grid.tempo
          : [{ from_beat: 0, at_s: firstBeatS, bpm }];
      const beatNo = (at) => {
        let k = 0;
        while (k + 1 < map.length && map[k + 1].at_s <= at) k++;
        const seg = map[k];
        return seg.from_beat + (at - seg.at_s) / (60 / seg.bpm);
      };
      const atBeat = (n) => {
        if (!map || !map.length) return firstBeatS + n * beatSec;
        let k = 0;
        while (k + 1 < map.length && map[k + 1].from_beat <= n) k++;
        return map[k].at_s + (n - map[k].from_beat) * (60 / map[k].bpm);
      };
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
  else if (Array.isArray(out.beats) && Array.isArray(raw.beats))
    out.downbeats = out.beats.filter(
      (_, i) => raw.beats[i] && raw.beats[i].downbeat,
    );

  if (Array.isArray(raw.sections) && raw.sections.length) {
    out.sections = raw.sections.map((s) => ({
      from: { bar: s.from_bar || 0, beat: 1 },
      to: { bar: (s.to_bar || 0) + 1, beat: 1 },
      name: s.label,
      start: s.start,
      end: s.end,
    }));
  } else if (Array.isArray(raw.parts)) {
    out.sections = raw.parts.map((part) => ({
      from: { bar: part.from_bar, beat: 1 },
      to: { bar: part.to_bar + 1, beat: 1 },
      name: part.role,
      nth: part.nth,
      like: part.like,
      feels: part.feels,
      playing: part.playing,
      fullness: part.fullness,
    }));
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

  if (raw.energy) {
    out.energy = raw.energy;
  } else if (Array.isArray(raw.bars?.intensity)) {
    out.energy = { per: "bar", from_bar: firstBar, values: raw.bars.intensity };
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
  if (raw.releases) out.releases = raw.releases;
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
    if (name === "energy") src = raw.energy?.values || bars.intensity;
    else src = bars[name];
    if (Array.isArray(src)) {
      const lane = name === "energy" ? "intensity" : name;
      curveEntries[name] = {
        per: "bar",
        from_bar:
          name === "energy" && raw.energy?.from_bar != null
            ? raw.energy.from_bar
            : firstBar,
        values: src,
        tells: raw.curve_tells?.[lane],
      };
    }
  }
  if (Object.keys(curveEntries).length) out.curves = curveEntries;

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

  if (raw.moments) {
    out.moments = raw.moments.map((mo) => {
      if (mo.at) return mo;
      const { bar, beat, ...rest } = mo;
      return { at: { bar, beat }, ...rest };
    });
  }

  if (raw.layers) out.layers = { ...raw.layers };
  if (!out.layers) out.layers = {};

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

  /* BTC emits chords as timed spans. Readers ask for them per bar, plus a
     key -- the same shape the old Essentia path produced -- so give them both
     rather than the model's raw output under an internal name. */
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

  /* the 53-stem summary is a different fact from the per-bar lanes above:
     one is "how loud is this instrument across the whole record", the other
     is "where is it bar by bar". Merging them under one key made the summary
     silently delete the lanes every reader asks for. */
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

  /* per-instrument level over time -- 53-stem separation at half-second
     resolution. This is the finest-grained thing in the file and nothing
     was carrying it to a reader. */
  if (raw.stems_temporal && raw.stems_temporal.stems) {
    out.instruments_over_time = {
      per: "window",
      window_s: raw.stems_temporal.window_s,
      normalised: "per-instrument-peak-within-song",
      lanes: raw.stems_temporal.stems,
    };
  }

  if (raw.rhythm) out.rhythm = raw.rhythm;
  if (raw.key_tempo) out.key_tempo = raw.key_tempo;
  if (raw.beat_consensus) out.beat_consensus = raw.beat_consensus;
  if (raw.emotion) out.emotion = raw.emotion;

  return out;
}
