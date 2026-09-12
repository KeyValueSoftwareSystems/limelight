/**
 * v1 response formatter — aligned with protocol/respond.js.
 *
 * Known fields: grid, beats, downbeats, sections, energy, moments, layers.
 * `sections` is derived from `layers.form.spans`.
 * `layers` passes through the raw layers object.
 *
 * The formatter builds the full response with all available fields.
 * The filter (called after this) strips fields the consumer did not ask for.
 */

export const KNOWN = ['grid', 'beats', 'downbeats', 'sections', 'energy', 'moments', 'layers'];

/**
 * @param {object} raw  Parsed score file from disk.
 * @returns {object} Response-shaped object with all available fields.
 */
export function format(raw) {
  const out = {};

  out.score   = raw.score;
  out.version = raw.version;

  if (raw.grid) out.grid = raw.grid;

  if (raw.beats)     out.beats     = raw.beats;
  if (raw.downbeats) out.downbeats = raw.downbeats;

  if (raw.layers?.form?.spans) {
    out.sections = raw.layers.form.spans.map(span => ({
      from:   span.from,
      to:     span.to,
      name:   span.name,
      repeat: span.repeat,
    }));
  }

  if (raw.energy)  out.energy  = raw.energy;
  if (raw.moments) out.moments = raw.moments;
  if (raw.layers)  out.layers  = raw.layers;

  return out;
}
