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

describe('HTTP transport — contract alignment', () => {
  let server;
  const port = 18780 + Math.floor(Math.random() * 1000);

  before(() => {
    const store   = createFileStore(SCORE_DIR);
    const handler = createHandler({ store });
    server = startHttp({ handler, host: '127.0.0.1', port });
  });

  after(() => new Promise(resolve => server.close(resolve)));

  // rule 1: grid always
  it('grid comes back even when nobody asked for it', async () => {
    const res  = await post(port, { score: 'levels', fields: ['downbeats'] });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.grid);
    assert.equal(body.beats, undefined);
  });

  // rule 2: only requested
  it('returns full score when no fields specified', async () => {
    const res  = await post(port, { score: 'levels' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.score, 'levels');
    assert.ok(body.sections.length > 0);
    assert.ok(body.energy.values.length > 0);
    assert.ok(body.beats.count > 0);
    assert.ok(body.moments.length > 0);
    assert.ok(body.layers);
  });

  // rule 3: version always present
  it('response includes version', async () => {
    const res  = await post(port, { score: 'levels' });
    const body = await res.json();
    assert.equal(body.version, 2);
  });

  it('wrong version returns error', async () => {
    const res  = await post(port, { score: 'levels', version: 99 });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.error);
  });

  // unknown fields
  it('reports unknown fields in ignored', async () => {
    const res  = await post(port, { score: 'levels', fields: ['downbeats', 'tempo_curve'] });
    const body = await res.json();
    assert.ok(body.ignored);
    assert.ok(body.ignored.fields.includes('tempo_curve'));
  });

  // rule 4: window
  it('a window clips beats and does not re-anchor', async () => {
    const res  = await post(port, {
      score: 'levels', fields: ['beats', 'downbeats', 'energy'],
      window: { from_bar: 33, bars: 8 },
    });
    const body = await res.json();
    assert.equal(body.beats.count, 32);
    assert.equal(body.downbeats.count, 8);
    assert.equal(body.beats.list[0][0], 33);
    assert.equal(body.energy.from_bar, 33);
    assert.equal(body.energy.values.length, 8);
    assert.deepEqual(body.window, { from_bar: 33, bars: 8 });
  });

  it('a windowed section that starts before still comes back', async () => {
    const res  = await post(port, {
      score: 'levels', fields: ['sections'],
      window: { from_bar: 33, bars: 8 },
    });
    const body = await res.json();
    assert.ok(body.sections.some(s => s.from.bar < 33));
    assert.ok(body.sections.some(s => s.to.bar > 41));
  });

  // errors
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

  it('returns 400 for malformed fields', async () => {
    const res  = await post(port, { score: 'levels', fields: 'energy' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'INVALID_REQUEST');
  });
});
