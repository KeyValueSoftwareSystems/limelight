import { describe, it, before, after } from 'node:test';
import assert                         from 'node:assert/strict';

import { createFileStore }  from '../store/file.js';
import { createHandler }    from '../handler.js';
import { startHttp }        from '../transport/http.js';

const SCORE_DIR = new URL('../../protocol', import.meta.url).pathname;

function post(port, body) {
  return fetch(`http://127.0.0.1:${port}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('HTTP transport', () => {
  let server;
  const port = 18780 + Math.floor(Math.random() * 1000);

  before(() => {
    const store   = createFileStore(SCORE_DIR);
    const handler = createHandler({ store });
    server = startHttp({ handler, host: '127.0.0.1', port });
  });

  after(() => new Promise(resolve => server.close(resolve)));

  it('returns full score for levels', async () => {
    const res  = await post(port, { score: 'levels' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.score, 'levels');
    assert.deepEqual(body.grid, { bpm: 128, first_beat_s: 0.2233, beats_per_bar: 4 });
    assert.ok(body.sections.length > 0);
    assert.ok(body.energy.values.length > 0);
    assert.ok(body.beats.count > 0);
  });

  it('filters by keys', async () => {
    const res  = await post(port, { score: 'levels', keys: ['energy'] });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['energy', 'grid', 'score']);
  });

  it('returns 404 for unknown score', async () => {
    const res  = await post(port, { score: 'does-not-exist' });
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.error, 'SCORE_NOT_FOUND');
  });

  it('returns 400 for invalid request', async () => {
    const res  = await post(port, {});
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'INVALID_REQUEST');
  });

  it('returns 400 for malformed keys', async () => {
    const res  = await post(port, { score: 'levels', keys: 'energy' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'INVALID_REQUEST');
  });
});
