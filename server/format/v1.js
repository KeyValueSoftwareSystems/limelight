/**
 * v1 response formatter.
 *
 * Transforms the internal score file shape into the response shape
 * the consumer expects.  The main mapping:
 *
 *   score file `layers.form.spans`  →  response `sections`
 *
 * When the response shape changes, add a v2.js alongside this file
 * that exports the same `format(raw)` signature.
 */

/**
 * @param {object} raw  Parsed score file (full JSON from disk).
 * @returns {object} Response-shaped object with all available fields.
 */
export function format(raw) {
  const out = {};

  out.score = raw.score;
  out.grid  = raw.grid;

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

  if (raw.energy) out.energy = raw.energy;

  return out;
}
