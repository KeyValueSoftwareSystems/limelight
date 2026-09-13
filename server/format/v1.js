/**
 * v1 response formatter — aligned with protocol/respond.js.
 *
 * The formatter builds the full response with all available fields.
 * The filter (called after this) strips fields the consumer did not ask for.
 */

export const KNOWN = [
  'song', 'grid', 'beats', 'downbeats', 'sections', 'energy', 'ticks', 'groove', 'melody_phrases',
  'brightness', 'width', 'air', 'pump', 'pace', 'weight', 'floor', 'noisy', 'held',
  'moments', 'phrases', 'layers', 'chords', 'key', 'loudness', 'feel',
  'curves', 'stems', 'harmony', 'chord_changes', 'chord_summary',
  'tension', 'lift', 'releases', 'melody', 'signals', 'made_by', 'lyrics', 'tells',
  'recording',
  'motion',
];

const STEM_NAMES = ['drums', 'bass', 'vocals', 'guitar', 'piano', 'other'];
const STEM_FOUR  = ['drums', 'bass', 'vocals', 'other'];
const CURVE_NAMES = ['energy', 'brightness', 'width', 'air', 'pump', 'pace',
                     'weight', 'floor', 'noisy', 'held'];

/**
 * @param {object} raw  Parsed score file from disk.
 * @returns {object} Response-shaped object with all available fields.
 */
export function format(raw) {
  const out = {};
  const grid = raw.grid || {};
  const bpm  = grid.bpm || 120;
  const bpb  = grid.beats_per_bar || 4;
  const firstBeatS = grid.first_beat_s || 0;
  const beatSec = 60 / bpm;
  const barSec  = beatSec * bpb;
  const firstBar = (grid.first_bar !== undefined && grid.first_bar !== null)
    ? grid.first_bar
    : (firstBeatS > 0.2 ? 0 : 1);

  out.score   = raw.score;
  out.version = raw.version;

  // ---- song ----
  if (raw.song) {
    out.song = { ...raw.song };
    /* The grid counted the bars; deriving from the length is only a fallback.
       Preferring the derivation gave song.bars 127 while grid.bars said 124 for
       the same song -- two fields that both mean "how many bars", disagreeing. */
    if (out.song.bars === undefined && grid.bars !== undefined && grid.bars !== null) {
      out.song.bars = grid.bars;
    } else if (out.song.bars === undefined && out.song.length_s && bpm) {
      out.song.bars = Math.ceil((out.song.length_s - firstBeatS) / barSec);
    }
  }

  // ---- grid (with holds_from / holds_to) ----
  if (raw.grid) {
    out.grid = { ...raw.grid };
    /* A song may change tempo, so the beat a second falls on is a walk along
       grid.tempo, not one division. Dividing by a single beatSec put holds_from
       in the wrong bar on every song whose tempo moves. */
    const map = (raw.grid.tempo && raw.grid.tempo.length)
      ? raw.grid.tempo : [{ from_beat: 0, at_s: firstBeatS, bpm }];
    const beatOf = t => {
      let k = 0;
      while (k + 1 < map.length && map[k + 1].at_s <= t) k++;
      return map[k].from_beat + (t - map[k].at_s) / (60 / map[k].bpm);
    };
    const place = t => {
      const i = beatOf(t);
      return { bar: firstBar + Math.floor(i / bpb), beat: Math.floor(((i % bpb) + bpb) % bpb) + 1 };
    };
    if (raw.grid.holds_from_s != null) out.grid.holds_from = place(raw.grid.holds_from_s);
    if (raw.grid.holds_to_s != null) out.grid.holds_to = place(raw.grid.holds_to_s);
  }

  // ---- beats (two formats: protocol {list} or pipeline [{t, weight, sure}]) ----
  if (raw.beats) {
    if (raw.beats.list) {
      out.beats = raw.beats;
    } else if (Array.isArray(raw.beats)) {
      /* Which bar a beat is in comes from its time, read through the tempo map,
         because that is how the pipeline decides where a bar starts and it is
         the only answer that agrees with the sections.

         Two wrong answers came before this one. Counting idx/beats_per_bar
         assumes the song begins on a downbeat, and thirteen of twenty-eight
         open with a pickup, which put every bar two beats early on Levels.
         Walking the tracker's downbeat flags fixes the pickup and then drifts,
         because the flags are not reliably every fourth beat: on Cipher it
         produced 274 bars where the grid says 337, so the beats and the
         sections no longer agreed about what bar 200 was. */
      const map = (Array.isArray(grid.tempo) && grid.tempo.length)
        ? grid.tempo
        : [{ from_beat: 0, at_s: firstBeatS, bpm }];
      const beatNo = at => {
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
        /* Nearest grid beat, which is how pulse.py decides what off_ms is
           measured from. Forcing the numbers to keep increasing was tried and
           was worse: one early collision on Where Are U Now put `last` ahead of
           the grid and the next 394 beats inherited the push, where rounding on
           its own collides 46 times in twelve thousand beats across the
           library. A collision is the tracker hearing two beats where the grid
           has one, and off_ms says so. */
        const n = (b.t != null) ? Math.round(beatNo(b.t)) : idx;
        /* Before grid beat zero the song is in its pickup, a bar shorter than
           the others. It is numbered from its own first beat so that every bar
           in the list, that one included, has a beat one. */
        const drift = (t, at) => {
          if (b.off_ms !== undefined) return Math.round(b.off_ms);
          if (t == null) return undefined;
          return Math.round((t - at) * 1000);
        };
        if (n < 0) {
          lead += 1;
          const off = drift(b.t, atBeat(n));
          return Object.assign({ bar: firstBar, beat: lead },
            b.t !== undefined ? { t: b.t } : {},
            b.weight !== undefined ? { weight: b.weight } : {},
            b.sure !== undefined ? { sure: b.sure } : {},
            off !== undefined ? { off_ms: off } : {},
            b.downbeat !== undefined ? { downbeat: b.downbeat } : {});
        }
        const bar = Math.max(firstBar, 1 + Math.floor(n / bpb));
        const beat = 1 + (((n % bpb) + bpb) % bpb);
        const entry = { bar, beat };
        if (b.t      !== undefined) entry.t      = b.t;
        if (b.weight !== undefined) entry.weight = b.weight;
        if (b.sure   !== undefined) entry.sure   = b.sure;
        const off = drift(b.t, atBeat(n));
        if (off !== undefined) entry.off_ms = off;
        if (b.downbeat !== undefined) entry.downbeat = b.downbeat;
        return entry;
      });
    }
  }
  /* The one request SPEC uses as its example asks for downbeats, and neither
     formatter ever produced any: a pipeline score has the flag on each beat and
     no downbeats field, and both only passed a field through. Asking for them
     got you nothing back. */
  if (raw.downbeats) out.downbeats = raw.downbeats;
  else if (Array.isArray(out.beats) && Array.isArray(raw.beats))
    out.downbeats = out.beats.filter((_, i) => raw.beats[i] && raw.beats[i].downbeat);

  // ---- sections (layers.form.spans or parts) ----
  if (raw.layers?.form?.spans) {
    out.sections = raw.layers.form.spans.map(span => ({
      from:   span.from,
      to:     span.to,
      name:   span.name,
      repeat: span.repeat,
      ...(span.rise     !== undefined ? { rise: span.rise }         : {}),
      ...(span.playing  !== undefined ? { playing: span.playing }   : {}),
      ...(span.stems    !== undefined ? { stems: span.stems }       : {}),
      ...(span.fullness !== undefined ? { fullness: span.fullness } : {}),
      ...(span.feels    !== undefined ? { feels: span.feels }       : {}),
    }));
  } else if (Array.isArray(raw.parts)) {
    out.sections = raw.parts.map(part => ({
      from:     { bar: part.from_bar, beat: 1 },
      to:       { bar: part.to_bar + 1, beat: 1 },
      name:     part.role,
      nth:      part.nth,
      repeat:   part.returns ? part.like : undefined,
      like:     part.like,
      feels:    part.feels,
      playing:  part.playing,
      fullness: part.fullness,
      rise:     part.rise,
      stems:    part.stems,
      /* Which section this one is a repeat of, how cleanly it sits in that
         group, and whether it trades back and forth inside itself. A reader
         that knows a chorus is the chorus it already lit can light it the same
         way; one that knows a verse turns over every eight bars can swap on
         the cycle instead of holding one look for thirty-one bars. */
      /* Whether a model that shares nothing with our detectors heard this
         boundary too. Null means only we did, which is not the same as wrong. */
      also_heard: part.also_heard,
      edge: part.edge,
      sudden: part.sudden,
      sure:       part.sure,
      trades:     part.trades,
    }));
  }

  /* The fast lane. Everything else in this file is per bar or per section, and
     a light that pulses on the beat cannot be driven from either. */
  if (raw.ticks) out.ticks = raw.ticks;
  /* Where the hits fall inside the bar, per stem. pace counts events and
     throws the pattern away, and the pattern is what a light follows. */
  if (raw.groove) out.groove = raw.groove;
  if (Array.isArray(raw.melody_phrases)) out.melody_phrases = raw.melody_phrases;
  /* How much each per-bar lane tells you about this song, beside the lanes
     themselves rather than inside them: a reader already holding out.weight as
     an array keeps holding an array, and can look up out.tells.weight to find
     out whether it is worth following here. curves.<name>.tells says the same
     thing, but nothing reads curves -- the readers all take the bare lanes. */
  if (raw.curve_tells) {
    const said = {};
    for (const [name, v] of Object.entries(raw.curve_tells)) {
      said[name === 'intensity' ? 'energy' : name] = v;
    }
    if (Object.keys(said).length) out.tells = said;
  }
  if (raw.lyrics) out.lyrics = raw.lyrics;

  // ---- energy (backward compat) ----
  if (raw.energy) {
    out.energy = raw.energy;
  } else if (Array.isArray(raw.bars?.intensity)) {
    out.energy = { per: 'bar', from_bar: firstBar, values: raw.bars.intensity };
  }

  if (out.energy && out.tells && out.tells.energy !== undefined) {
    out.energy.tells = out.tells.energy;
  }

  // ---- bare per-bar lanes (backward compat) ----
  if (raw.phrases) out.phrases = raw.phrases;
  /* The melody layer, the two lines behind it, and the honesty fields. */
  if (raw.melody) out.melody = raw.melody;
  if (raw.signals) out.signals = raw.signals;
  if (raw.voice) out.voice = raw.voice;
  if (raw.lead) out.lead = raw.lead;
  { const pull = raw.lift ?? raw.tension;
    if (pull) out.tension = out.lift = { per: 'beat', values: pull }; }
  if (raw.releases) out.releases = raw.releases;
  if (raw.phrase_grid) out.phrase_grid = raw.phrase_grid;
  if (raw.scales) out.scales = raw.scales;
  if (raw.made_by) out.made_by = raw.made_by;
  if (raw.recording) out.recording = raw.recording;
  if (raw.chord_changes) out.chord_changes = raw.chord_changes;
  if (raw.presence) out.presence = raw.presence;
  if (raw.motion) out.motion = raw.motion;

  const bars = raw.bars || {};
  for (const lane of ['width', 'air', 'pump', 'pace']) {
    if (Array.isArray(bars[lane])) out[lane] = bars[lane];
  }
  if (Array.isArray(bars.brightness)) out.brightness = bars.brightness;
  /* air and brightness are both the top of the spectrum. weight is the share
     below 120 Hz and floor below 60 -- a bar can read near silent on energy
     and still be a third low end, which is a bar that feels like something. */
  if (Array.isArray(bars.weight)) out.weight = bars.weight;
  if (Array.isArray(bars.floor)) out.floor = bars.floor;
  if (Array.isArray(bars.noisy)) out.noisy = bars.noisy;
  if (Array.isArray(bars.held)) out.held = bars.held;

  // ---- curves (selectable per-bar arrays with metadata) ----
  const curveEntries = {};
  for (const name of CURVE_NAMES) {
    let src;
    if (name === 'energy') {
      src = raw.energy?.values || bars.intensity;
    } else {
      src = bars[name];
    }
    if (Array.isArray(src)) {
      const lane = (name === 'energy') ? 'intensity' : name;
      curveEntries[name] = {
        per: 'bar',
        from_bar: (name === 'energy' && raw.energy?.from_bar != null)
          ? raw.energy.from_bar : firstBar,
        values: src,
        tells: raw.curve_tells?.[lane],
      };
    }
  }
  if (Object.keys(curveEntries).length) out.curves = curveEntries;

  // ---- stems (per-bar, with normalisation stated) ----
  const stemLanes = {};
  for (const s of STEM_NAMES) {
    if (Array.isArray(bars[s])) stemLanes[s] = bars[s];
  }
  if (Object.keys(stemLanes).length) {
    out.stems = { normalised: 'per-stem-peak-within-song', from_bar: firstBar, lanes: stemLanes };
  }

  // ---- moments (pass through with all fields; fallback from events) ----
  if (raw.moments) {
    /* A moment says where it is as `at: {bar, beat}`, whichever source it came
       from. The pipeline writes bar and beat flat and the events fallback nests
       them, so the same field arrived in two shapes depending on the branch --
       and a consumer reading m.at worked on one score and threw on the next. */
    out.moments = raw.moments.map(mo => {
      if (mo.at) return mo;
      const { bar, beat, ...rest } = mo;
      return { at: { bar, beat }, ...rest };
    });
  } else if (Array.isArray(raw.events)) {
    out.moments = raw.events.map(event => {
      const m = { at: { bar: event.bar, beat: event.beat } };
      if (event.is       !== undefined) m.is       = event.is;
      if (event.what     !== undefined) m.what     = event.what;
      if (event.sure     !== undefined) m.sure     = event.sure;
      if (event.weight   !== undefined) m.weight   = event.weight;
      if (event.strength !== undefined) m.strength = event.strength;
      if (event.for_beats !== undefined) m.for_beats = event.for_beats;
      if (event.for_bars !== undefined) m.for_bars = event.for_bars;
      if (event.then     !== undefined) m.then     = event.then;
      if (event.after    !== undefined) m.after    = event.after;
      if (event.leaves   !== undefined) m.leaves   = event.leaves;
      return m;
    });
  }

  /* ---- layers ----
     No stem-lane fallback here: those lanes ship as out.stems with their
     normalisation stated, and layers means form, subsection and the rest.
     Putting raw arrays under the same name made layers.vocals an array while
     layers.form was a span list. */
  if (raw.layers) out.layers = { ...raw.layers };
  if (!out.layers) out.layers = {};

  // layers.subsection (from phrases)
  if (!out.layers.subsection && Array.isArray(raw.phrases)) {
    out.layers.subsection = {
      kind: 'sparse',
      spans: raw.phrases.map(p => ({
        from:      { bar: p.from_bar, beat: 1 },
        to:        { bar: p.to_bar + 1, beat: 1 },
        in:        p.in,
        in_nth:    p.in_nth,
        doing:     p.doing,
        also:      p.also,
        says:      p.says,
        energy:    p.energy,
        rise:      p.rise,
        playing:   p.playing,
        has_break: p.break != null || !!p.has_break,
        break: p.break,
      })),
    };
  }

  // layers.presence (from parts[].stems)
  if (!out.layers.presence && Array.isArray(raw.parts)) {
    const presSpans = [];
    for (const part of raw.parts) {
      if (!part.stems) continue;
      for (const [stem, info] of Object.entries(part.stems)) {
        const state = typeof info === 'string' ? info : info?.is;
        if (state && state !== 'none') {
          presSpans.push({
            from:  { bar: part.from_bar, beat: 1 },
            to:    { bar: part.to_bar + 1, beat: 1 },
            stem,
            state,
          });
        }
      }
    }
    if (presSpans.length) {
      out.layers.presence = { kind: 'sparse', spans: presSpans };
    }
  }

  // layers.phrase (from phrase_grid)
  if (!out.layers.phrase && raw.phrase_grid) {
    out.layers.phrase = {
      kind: 'rule',
      every_bars:          raw.phrase_grid.every_bars,
      from_bar:            raw.phrase_grid.from_bar,
    };
  }

  if (!Object.keys(out.layers).length) delete out.layers;

  // ---- harmony ----
  if (Array.isArray(bars.chord)) {
    out.harmony = {
      from_bar:    firstBar,
      chords:      bars.chord,
      confidence:  bars.chord_sure || [],
    };
  }

  // ---- chord_changes (derived) ----
  if (Array.isArray(bars.chord)) {
    const changes = [];
    let prev = null;
    bars.chord.forEach((name, i) => {
      if (name && name !== prev) {
        changes.push({
          at:         { bar: i + firstBar, beat: 1 },
          to:         name,
          confidence: bars.chord_sure?.[i] ?? null,
        });
        prev = name;
      }
    });
    out.chord_changes = changes;
  }

  // ---- chords (backward compat) ----
  if (Array.isArray(bars.chord)) {
    out.chords = bars.chord.map((name, i) => ({
      bar:  i + firstBar,
      name,
      sure: bars.chord_sure?.[i],
    })).filter(c => c.name);
  }

  // ---- key ----
  if (raw.key || raw.chords) {
    out.key = { ...(raw.key ?? {}) };
    if (raw.chords) out.key.changes_per_beat = raw.chords.changes_per_beat;
  }

  // ---- chord_summary ----
  if (raw.chords) {
    out.chord_summary = { changes_per_beat: raw.chords.changes_per_beat };
  }

  if (raw.loudness) out.loudness = raw.loudness;
  if (raw.feel)     out.feel     = raw.feel;

  /* the artist's layer: present when the score was pulled with a personality.
     `profile` was the old name and still goes out beside it, so a reader
     written before the rename keeps working. */
  const person = raw.personality || raw.profile;
  if (person) { out.personality = person; out.profile = person; }

  /* ---- lift ----
     `tension` goes out beside it, the same object, for one release: readers
     were built against that name. It never measured tension -- see the spec. */
  {
  const pull = Array.isArray(raw.lift) ? raw.lift : raw.tension;
  if (Array.isArray(pull)) {
    out.lift = { per: 'beat', from_bar: firstBar, from_beat: 1, values: pull };
    out.tension = out.lift;
  }
  }

  // ---- releases (seconds to positions) ----
  if (Array.isArray(raw.releases)) {
    out.releases = raw.releases.map(r => {
      const has = r.bar !== undefined && r.beat !== undefined;
      const i = (r.at_s - firstBeatS) / beatSec;
      const at = has ? { bar: r.bar, beat: r.beat }
                     : { bar: firstBar + Math.floor(i / bpb),
                         beat: Math.floor(i % bpb) + 1 };
      const one = { at, size: r.size };
      if (r.at_s !== undefined) one.at_s = r.at_s;
      return one;
    });
  }

  // ---- melody (guard for future pipeline output) ----
  if (raw.melody) out.melody = raw.melody;

  // ---- made_by ----
  if (raw.made_by) out.made_by = raw.made_by;

  return out;
}
