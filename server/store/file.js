import { readFile } from 'node:fs/promises';
import { join }     from 'node:path';

import { ScoreNotFound } from '../errors.js';

/**
 * Creates a file-backed score store.
 *
 * Score files are expected at `<dir>/<name>.score`, with
 * `<dir>/score.<name>.json` accepted for older files.
 * Returns the parsed JSON object for a given score name.
 *
 * Replace this module with any store that exports the same
 * `{ load }` interface to switch backends without touching
 * the handler.
 */
export function createFileStore(dir) {
  return { load };

  async function load(name) {
    const tries = [join(dir, `${name}.score`), join(dir, `score.${name}.json`)];
    for (const file of tries) {
      try {
        return JSON.parse(await readFile(file, 'utf-8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    throw new ScoreNotFound(name);
  }
}
