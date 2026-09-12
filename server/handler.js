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

  if (out.beats) {
    const list = out.beats.list.filter(b => inWin(b[0]));
    out.beats = { derived_from: 'grid', as: '[bar, beat]', count: list.length, list };
  }

  if (out.downbeats) {
    const list = out.downbeats.list.filter(b => inWin(b[0]));
    out.downbeats = { derived_from: 'grid', as: '[bar, beat]', count: list.length, list };
  }

  if (out.sections) {
    out.sections = out.sections.filter(sp => spanTouches(sp));
  }

  if (out.energy) {
    const E     = out.energy;
    const start = Math.max(0, lo - E.from_bar);
    const end   = Math.max(start, hi - E.from_bar);
    out.energy  = { per: E.per, from_bar: E.from_bar + start,
                    values: E.values.slice(start, end) };
  }

  if (out.moments) {
    out.moments = out.moments.filter(m => inWin(m.at.bar));
  }

  return out;
}
