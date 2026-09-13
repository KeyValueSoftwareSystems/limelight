import { InvalidRequest }          from './errors.js';
import { filter }                  from './filter.js';
import { format as v1, KNOWN }     from './format/v1.js';

const formatters = { v1 };

/**
 * Creates the score handler — aligned with protocol/respond.js.
 *
 * The handler knows nothing about HTTP. It receives a plain request
 * object and returns a plain response object.
 *
 * @param {object} deps
 * @param {object} deps.store  Any object with `async load(name)`.
 */
export function createHandler({ store }) {
  return { handle };

  /**
   * @param {object} req
   * @param {string}             req.score    Song identifier (required).
   * @param {number|undefined}   req.version  Expected score version.
   * @param {string[]|undefined} req.fields   Fields to include (default: all KNOWN).
   * @param {object|undefined}   req.window   { from_bar, bars } — clip to a bar range.
   * @param {string|undefined}   req.format   Response format version (default "v1").
   * @param {string[]|undefined} req.curves   Curve names to keep (default: all).
   * @param {string[]|undefined} req.stems    Stem names to keep (default: all).
   * @param {object|undefined}   req.moments  { min_weight } — filter moments.
   * @returns {Promise<object>} The filtered, formatted, optionally windowed score.
   */
  async function handle(req) {
    if (!req || typeof req.score !== 'string' || req.score.length === 0) {
      throw new InvalidRequest('"score" field is required and must be a non-empty string');
    }

    if (req.fields !== undefined) {
      if (!Array.isArray(req.fields)) {
        throw new InvalidRequest('"fields" must be an array of strings');
      }
      if (req.fields.some(f => typeof f !== 'string')) {
        throw new InvalidRequest('every entry in "fields" must be a string');
      }
    }

    const fmtVersion = req.format || 'v1';
    const fmt        = formatters[fmtVersion];
    if (!fmt) {
      throw new InvalidRequest(`unknown format version: "${fmtVersion}"`);
    }

    const raw = await store.load(req.score);

    if (req.version !== undefined && req.version !== raw.version) {
      return {
        error: `asked for ${req.score}@${req.version}, have ${req.score}@${raw.version}`,
        note:  'a score is immutable once published; a correction is a new version',
      };
    }

    let formatted = fmt(raw);

    // selective curves
    if (req.curves && formatted.curves) {
      const want = new Set(req.curves);
      for (const k of Object.keys(formatted.curves)) {
        if (!want.has(k)) delete formatted.curves[k];
      }
    }

    // selective stems
    if (req.stems && formatted.stems?.lanes) {
      const want = new Set(req.stems);
      for (const k of Object.keys(formatted.stems.lanes)) {
        if (!want.has(k)) delete formatted.stems.lanes[k];
      }
    }

    // moments min_weight filter
    if (req.moments?.min_weight != null && formatted.moments) {
      const min = req.moments.min_weight;
      formatted.moments = formatted.moments.filter(m => (m.weight ?? 1) >= min);
    }

    const w = req.window || null;
    formatted.window = w ? { from_bar: w.from_bar, bars: w.bars } : 'whole song';

    if (w) {
      formatted = applyWindow(formatted, w, raw.grid);
    }

    return filter(formatted, { fields: req.fields, known: KNOWN });
  }
}

/**
 * Clips formatted response data to a bar window.
 *
 * Rule 4 from the reference: a window clips, it does not re-anchor.
 * Bar 33 is still called bar 33 in a window that starts there.
 */
function applyWindow(out, w, grid) {
  const bpb = (grid && grid.beats_per_bar) || 4;
  const lo  = w.from_bar;
  const hi  = w.from_bar + (w.bars || 0);
  const inWin      = bar => bar >= lo && bar < hi;
  const spanTouches = sp => sp.to.bar > lo && sp.from.bar < hi;

  // helper: slice a { from_bar, values } per-bar array
  function slicePerBar(obj) {
    if (!obj || !Array.isArray(obj.values)) return obj;
    const start = Math.max(0, lo - (obj.from_bar ?? 0));
    const end   = Math.max(start, hi - (obj.from_bar ?? 0));
    return { ...obj, from_bar: (obj.from_bar ?? 0) + start, values: obj.values.slice(start, end) };
  }

  // beats — handle both protocol format and pipeline format
  if (out.beats) {
    if (out.beats.list) {
      const list = out.beats.list.filter(b => inWin(b[0]));
      out.beats = { derived_from: 'grid', as: '[bar, beat]', count: list.length, list };
    } else if (Array.isArray(out.beats)) {
      out.beats = out.beats.filter(b => inWin(b.bar));
    }
  }

  if (out.downbeats) {
    if (out.downbeats.list) {
      const list = out.downbeats.list.filter(b => inWin(b[0]));
      out.downbeats = { derived_from: 'grid', as: '[bar, beat]', count: list.length, list };
    } else if (Array.isArray(out.downbeats)) {
      out.downbeats = out.downbeats.filter(b => inWin(b.bar));
    }
  }

  if (out.sections) {
    out.sections = out.sections.filter(sp => spanTouches(sp));
  }

  if (out.energy && typeof out.energy === 'object' && out.energy.values) {
    out.energy = slicePerBar(out.energy);
  }

  if (out.moments) {
    out.moments = out.moments.filter(m => inWin(m.at.bar));
  }

  // curves
  if (out.curves) {
    for (const k of Object.keys(out.curves)) {
      out.curves[k] = slicePerBar(out.curves[k]);
    }
  }

  // stems
  if (out.stems?.lanes) {
    const fromBar = out.stems.from_bar ?? 0;
    const start = Math.max(0, lo - fromBar);
    const end   = Math.max(start, hi - fromBar);
    const sliced = {};
    for (const [k, v] of Object.entries(out.stems.lanes)) {
      sliced[k] = Array.isArray(v) ? v.slice(start, end) : v;
    }
    out.stems = { ...out.stems, from_bar: fromBar + start, lanes: sliced };
  }

  // harmony
  if (out.harmony) {
    const fromBar = out.harmony.from_bar ?? 0;
    const start = Math.max(0, lo - fromBar);
    const end   = Math.max(start, hi - fromBar);
    out.harmony = {
      from_bar:   fromBar + start,
      chords:     out.harmony.chords.slice(start, end),
      confidence: out.harmony.confidence.slice(start, end),
    };
  }

  // chord_changes
  if (out.chord_changes) {
    out.chord_changes = out.chord_changes.filter(c => inWin(c.at.bar));
  }

  /* melody is a list of notes, each at its own bar and beat; signals carry the
     same shape as moments and may be flat or nested. Both were passing through
     a window unclipped, so asking for eight bars returned the whole song. */
  if (Array.isArray(out.melody)) {
    out.melody = out.melody.filter(n => inWin(n.bar));
  }
  if (Array.isArray(out.signals)) {
    out.signals = out.signals.filter(g => inWin((g.at || g).bar));
  }

  // tension (per-beat: bpb values per bar)
  if (out.tension && Array.isArray(out.tension.values)) {
    const fromBar = out.tension.from_bar ?? 0;
    const startBeat = Math.max(0, (lo - fromBar) * bpb);
    const endBeat   = Math.max(startBeat, (hi - fromBar) * bpb);
    out.tension = {
      ...out.tension,
      from_bar:  lo,
      from_beat: 1,
      values:    out.tension.values.slice(startBeat, endBeat),
    };
  }

  // releases
  if (out.releases) {
    out.releases = out.releases.filter(r => inWin(r.at.bar));
  }

  // layers — subsection and presence spans
  if (out.layers) {
    for (const name of ['subsection', 'presence']) {
      if (out.layers[name]?.spans) {
        out.layers[name] = {
          ...out.layers[name],
          spans: out.layers[name].spans.filter(sp => spanTouches(sp)),
        };
      }
    }
  }

  return out;
}
