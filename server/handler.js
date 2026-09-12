import { InvalidRequest } from './errors.js';
import { filter }         from './filter.js';
import { format as v1 }   from './format/v1.js';

const formatters = { v1 };

/**
 * Creates the score handler.
 *
 * The handler knows nothing about HTTP — it receives a plain request
 * object and returns a plain response object.  The transport adapter
 * calls this and decides how to serialise the result.
 *
 * @param {object} deps
 * @param {object} deps.store  Any object with `async load(name)`.
 */
export function createHandler({ store }) {
  return { handle };

  /**
   * @param {object} req
   * @param {string}           req.score   Song identifier (required).
   * @param {string[]|undefined} req.keys  Fields to include.
   * @param {string|undefined} req.format  Response format version
   *   (default "v1").
   * @returns {Promise<object>} The filtered, formatted score.
   */
  async function handle(req) {
    if (!req || typeof req.score !== 'string' || req.score.length === 0) {
      throw new InvalidRequest('"score" field is required and must be a non-empty string');
    }

    if (req.keys !== undefined) {
      if (!Array.isArray(req.keys)) {
        throw new InvalidRequest('"keys" must be an array of strings');
      }
      if (req.keys.some(k => typeof k !== 'string')) {
        throw new InvalidRequest('every entry in "keys" must be a string');
      }
    }

    const version = req.format || 'v1';
    const fmt     = formatters[version];
    if (!fmt) {
      throw new InvalidRequest(`unknown format version: "${version}"`);
    }

    const raw       = await store.load(req.score);
    const formatted = fmt(raw);
    return filter(formatted, { keys: req.keys });
  }
}
