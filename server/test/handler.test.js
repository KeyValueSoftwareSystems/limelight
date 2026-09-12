import { describe, it }     from 'node:test';
import assert               from 'node:assert/strict';

import { createHandler }    from '../handler.js';
import { ScoreNotFound }    from '../errors.js';

const SAMPLE_SCORE = {
  score: 'test-song',
  version: 2,
  song: { title: 'Test Song', length_s: 120 },
  grid: { bpm: 120, first_beat_s: 0.5, beats_per_bar: 4 },
  beats: {
    derived_from: 'grid', as: '[bar, beat]', count: 8,
    list: [[1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4]],
  },
  downbeats: {
    derived_from: 'grid', as: '[bar, beat]', count: 2,
    list: [[1,1],[2,1]],
  },
  layers: {
    form: {
      kind: 'partition',
      spans: [
        { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, name: 'intro', id: 'I', repeat: 1 },
        { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: 'drop',  id: 'D', repeat: 1 },
      ],
    },
  },
  energy: { per: 'bar', from_bar: 1, values: [0.2, 0.8, 0.5, 0.9] },
  moments: [
    { at: { bar: 5, beat: 1 }, kind: 'drop' },
    { at: { bar: 8, beat: 3 }, kind: 'quiet' },
  ],
  made_by: { how: 'test' },
};

function fakeStore(scores = {}) {
  return {
    async load(name) {
      if (!(name in scores)) throw new ScoreNotFound(name);
      return structuredClone(scores[name]);
    },
  };
}

describe('handler — aligned with respond.js contract', () => {
  const store   = fakeStore({ 'test-song': SAMPLE_SCORE });
  const handler = createHandler({ store });

  // ----- validation --------------------------------------------------------

  describe('validation', () => {
    it('rejects missing score field', async () => {
      await assert.rejects(() => handler.handle({}), { code: 'INVALID_REQUEST' });
    });

    it('rejects empty score string', async () => {
      await assert.rejects(() => handler.handle({ score: '' }), { code: 'INVALID_REQUEST' });
    });

    it('rejects non-string score', async () => {
      await assert.rejects(() => handler.handle({ score: 42 }), { code: 'INVALID_REQUEST' });
    });

    it('rejects non-array fields', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'test-song', fields: 'energy' }),
        { code: 'INVALID_REQUEST' },
      );
    });

    it('rejects non-string entries in fields', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'test-song', fields: [1] }),
        { code: 'INVALID_REQUEST' },
      );
    });

    it('rejects unknown format version', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'test-song', format: 'v99' }),
        { code: 'INVALID_REQUEST' },
      );
    });
  });

  // ----- rule 1: grid always comes back ------------------------------------

  describe('rule 1 — grid always returned', () => {
    it('grid comes back even when nobody asked for it', async () => {
      const res = await handler.handle({ score: 'test-song', fields: ['downbeats'] });
      assert.ok(res.grid);
      assert.equal(res.grid.bpm, 120);
    });
  });

  // ----- rule 2: only asked fields sent ------------------------------------

  describe('rule 2 — only requested fields sent', () => {
    it('a field nobody asked for is not sent', async () => {
      const res = await handler.handle({ score: 'test-song', fields: ['downbeats'] });
      assert.equal(res.beats, undefined);
      assert.equal(res.energy, undefined);
      assert.equal(res.sections, undefined);
      assert.equal(res.moments, undefined);
    });

    it('no fields means all known fields returned', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.ok(res.beats);
      assert.ok(res.downbeats);
      assert.ok(res.sections);
      assert.ok(res.energy);
      assert.ok(res.moments);
      assert.ok(res.layers);
    });

    it('empty fields array returns all known fields', async () => {
      const all  = await handler.handle({ score: 'test-song' });
      const res  = await handler.handle({ score: 'test-song', fields: [] });
      assert.deepEqual(Object.keys(res).sort(), Object.keys(all).sort());
    });
  });

  // ----- rule 3: version always in response --------------------------------

  describe('rule 3 — version always reported', () => {
    it('response always says which version it gave', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.version, 2);
    });

    it('asking for the right version succeeds', async () => {
      const res = await handler.handle({ score: 'test-song', version: 2 });
      assert.equal(res.version, 2);
      assert.equal(res.error, undefined);
    });

    it('asking for a wrong version returns an error, not a silent swap', async () => {
      const res = await handler.handle({ score: 'test-song', version: 99 });
      assert.ok(res.error);
      assert.match(res.error, /99/);
    });
  });

  // ----- unknown fields reported -------------------------------------------

  describe('unknown fields', () => {
    it('an unknown field is reported in ignored', async () => {
      const res = await handler.handle({ score: 'test-song', fields: ['downbeats', 'tempo_curve'] });
      assert.ok(res.ignored);
      assert.ok(res.ignored.fields.includes('tempo_curve'));
    });

    it('known fields are listed so the consumer can fix the request', async () => {
      const res = await handler.handle({ score: 'test-song', fields: ['tempo_curve'] });
      assert.ok(res.ignored.known.includes('grid'));
      assert.ok(res.ignored.known.includes('beats'));
    });
  });

  // ----- sections derived from layers.form.spans --------------------------

  describe('sections', () => {
    it('maps layers.form.spans to sections', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.sections.length, 2);
      assert.equal(res.sections[0].name, 'intro');
      assert.equal(res.sections[1].name, 'drop');
    });

    it('sections do not carry the id field from spans', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.sections[0].id, undefined);
    });
  });

  // ----- window (rule 4) ---------------------------------------------------

  describe('rule 4 — window clips, does not re-anchor', () => {
    it('window says "whole song" when absent', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.window, 'whole song');
    });

    it('window is echoed back when provided', async () => {
      const res = await handler.handle({
        score: 'test-song', fields: ['grid'],
        window: { from_bar: 1, bars: 2 },
      });
      assert.deepEqual(res.window, { from_bar: 1, bars: 2 });
    });

    it('clips beats to the window', async () => {
      const res = await handler.handle({
        score: 'test-song', fields: ['beats'],
        window: { from_bar: 2, bars: 1 },
      });
      assert.equal(res.beats.count, 4);
      assert.equal(res.beats.list[0][0], 2);
    });

    it('clips downbeats to the window', async () => {
      const res = await handler.handle({
        score: 'test-song', fields: ['downbeats'],
        window: { from_bar: 1, bars: 1 },
      });
      assert.equal(res.downbeats.count, 1);
      assert.equal(res.downbeats.list[0][0], 1);
    });

    it('clips energy and adjusts from_bar', async () => {
      const res = await handler.handle({
        score: 'test-song', fields: ['energy'],
        window: { from_bar: 2, bars: 2 },
      });
      assert.equal(res.energy.from_bar, 2);
      assert.equal(res.energy.values.length, 2);
    });

    it('clips moments to the window', async () => {
      const res = await handler.handle({
        score: 'test-song', fields: ['moments'],
        window: { from_bar: 5, bars: 4 },
      });
      assert.equal(res.moments.length, 2);
    });

    it('sections that touch the window come back even if they start before it', async () => {
      const res = await handler.handle({
        score: 'test-song', fields: ['sections'],
        window: { from_bar: 3, bars: 4 },
      });
      assert.ok(res.sections.some(s => s.from.bar < 3));
      assert.ok(res.sections.some(s => s.to.bar > 7));
    });
  });

  // ----- score not found ---------------------------------------------------

  describe('score not found', () => {
    it('throws ScoreNotFound for unknown song', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'no-such-song' }),
        { code: 'SCORE_NOT_FOUND', status: 404 },
      );
    });
  });
});
