import { readFile } from 'node:fs/promises';
import { join }     from 'node:path';

import { ScoreNotFound } from '../errors.js';

/**
 * Creates a file-backed score store.
 *
 * Score files are expected at `<dir>/score.<name>.json`.
 * Returns the parsed JSON object for a given score name.
 *
 * Replace this module with any store that exports the same
 * `{ load }` interface to switch backends without touching
 * the handler.
 */
export function createFileStore(dir) {
  return { load };

  async function load(name) {
    const file = join(dir, `score.${name}.json`);
    try {
      const raw = await readFile(file, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') throw new ScoreNotFound(name);
      throw err;
    }
  }
}
