/**
 * Filters a formatted score response to only the requested keys.
 *
 * `score` and `grid` are always kept — they are needed to interpret
 * every other field.
 *
 * @param {object} formatted  The fully formatted response object.
 * @param {object} opts
 * @param {string[]|undefined} opts.keys  Fields to include. If absent
 *   or empty, every field is returned.
 * @returns {object} A new object with only the requested fields (plus
 *   `score` and `grid`).
 */
export function filter(formatted, { keys } = {}) {
  if (!keys || keys.length === 0) return formatted;

  const ALWAYS = ['score', 'grid'];
  const keep   = new Set([...ALWAYS, ...keys]);
  const out    = {};

  for (const k of Object.keys(formatted)) {
    if (keep.has(k)) out[k] = formatted[k];
  }
  return out;
}
