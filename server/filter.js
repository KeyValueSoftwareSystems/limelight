/**
 * Filters a formatted score response to only the requested fields.
 *
 * Aligned with protocol/respond.js:
 *   - `score`, `version`, and `window` are always kept (envelope).
 *   - `grid` is always kept — every position is meaningless without it.
 *   - If `fields` is absent, all KNOWN fields are included.
 *   - Unknown fields are reported in `ignored`, not silently dropped.
 *
 * @param {object} formatted  The fully formatted response object.
 * @param {object} opts
 * @param {string[]|undefined} opts.fields  Fields to include.
 * @param {string[]} opts.known  The list of recognised field names.
 * @returns {object} A new object with only the requested fields
 *   plus the always-present envelope.
 */
export function filter(formatted, { fields, known } = {}) {
  const ALWAYS = ['score', 'version', 'window', 'grid', 'personality', 'profile'];

  if (!fields || fields.length === 0) {
    return formatted;
  }

  const want = new Set([...fields, ...ALWAYS]);
  const out  = {};

  for (const k of Object.keys(formatted)) {
    if (want.has(k)) out[k] = formatted[k];
  }

  if (known) {
    const unknown = fields.filter(f => !known.includes(f));
    if (unknown.length) {
      out.ignored = { fields: unknown, known };
    }
  }

  return out;
}
