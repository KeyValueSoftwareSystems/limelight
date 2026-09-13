import { describe, it, before, after } from 'node:test';
import assert                         from 'node:assert/strict';
import { readFileSync }               from 'node:fs';

import { createFileStore }  from '../store/file.js';
import { createHandler }    from '../handler.js';
import { startHttp }        from '../transport/http.js';

const SCORE_DIR = new URL('../../protocol', import.meta.url).pathname;
const FIXTURE = JSON.parse(
  readFileSync(new URL('../../protocol/levels.score', import.meta.url).pathname, 'utf8'));

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
    assert.ok(body.beats.length > 0);
    assert.ok(body.downbeats.length > 0);
    assert.ok(body.moments.length > 0);
    assert.ok(body.layers);
  });

  /* rule 3: the response says which version it gave. It says the version the
     score on disk carries -- pinning a literal here tested the fixture's age,
     not the rule, and broke the day scores settled on version 0. */
  it('response includes the version the score actually carries', async () => {
    const res  = await post(port, { score: 'levels' });
    const body = await res.json();
    assert.notEqual(body.version, undefined);
    assert.equal(body.version, FIXTURE.version);
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
    assert.equal(body.beats.length, 32);
    assert.equal(body.downbeats.length, 8);
    assert.equal(body.beats[0].bar, 33);
    assert.ok(body.downbeats.every(d => d.beat === 1));
    assert.equal(body.energy.from_bar, 33);
    assert.equal(body.energy.values.length, 8);
    assert.deepEqual(body.window, { from_bar: 33, bars: 8 });
  });

  /* A section that overlaps the window comes back with its real extent, not
     clipped to the window, so a consumer asking for eight bars can tell it is
     sitting inside a longer one. Asserting that some section began before the
     window tested where this song's boundaries happened to fall, and they
     moved; what the rule is about is the section not being trimmed. */
  it('a windowed section keeps its real extent', async () => {
    const res  = await post(port, {
      score: 'levels', fields: ['sections'],
      window: { from_bar: 33, bars: 8 },
    });
    const body = await res.json();
    assert.ok(body.sections.length > 0);
    assert.ok(body.sections.some(s => s.from.bar < 33 || s.to.bar > 40));
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
