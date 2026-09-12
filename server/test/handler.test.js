import { describe, it }     from 'node:test';
import assert               from 'node:assert/strict';

import { createHandler }    from '../handler.js';
import { ScoreNotFound }    from '../errors.js';

const SAMPLE_SCORE = {
  score: 'test-song',
  version: 2,
  song: { title: 'Test Song', length_s: 120 },
  grid: { bpm: 120, first_beat_s: 0.5, beats_per_bar: 4 },
  beats: { derived_from: 'grid', as: '[bar, beat]', count: 2, list: [[1,1],[1,2]] },
  downbeats: { derived_from: 'grid', as: '[bar, beat]', count: 1, list: [[1,1]] },
  layers: {
    form: {
      kind: 'partition',
      spans: [
        { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, name: 'intro', id: 'I', repeat: 1 },
        { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: 'drop',  id: 'D', repeat: 1 },
      ],
    },
  },
  energy: { per: 'bar', from_bar: 1, values: [0.2, 0.8] },
  moments: [{ at: { bar: 5, beat: 1 }, kind: 'drop' }],
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

describe('handler', () => {
  const store   = fakeStore({ 'test-song': SAMPLE_SCORE });
  const handler = createHandler({ store });

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

    it('rejects non-array keys', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'test-song', keys: 'energy' }),
        { code: 'INVALID_REQUEST' },
      );
    });

    it('rejects non-string entries in keys', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'test-song', keys: [1] }),
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

  describe('full response', () => {
    it('returns score and grid always', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.score, 'test-song');
      assert.deepEqual(res.grid, SAMPLE_SCORE.grid);
    });

    it('maps layers.form.spans to sections', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.sections.length, 2);
      assert.equal(res.sections[0].name, 'intro');
      assert.equal(res.sections[1].name, 'drop');
    });

    it('includes energy', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.deepEqual(res.energy.values, [0.2, 0.8]);
    });

    it('includes beats and downbeats', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.beats.count, 2);
      assert.equal(res.downbeats.count, 1);
    });

    it('does not leak internal fields (layers, version, song, made_by, moments)', async () => {
      const res = await handler.handle({ score: 'test-song' });
      assert.equal(res.layers, undefined);
      assert.equal(res.version, undefined);
      assert.equal(res.song, undefined);
      assert.equal(res.made_by, undefined);
      assert.equal(res.moments, undefined);
    });
  });

  describe('filtered response', () => {
    it('returns only requested keys plus score and grid', async () => {
      const res = await handler.handle({ score: 'test-song', keys: ['energy'] });
      assert.deepEqual(Object.keys(res).sort(), ['energy', 'grid', 'score']);
    });

    it('handles multiple keys', async () => {
      const res = await handler.handle({ score: 'test-song', keys: ['energy', 'sections'] });
      assert.deepEqual(Object.keys(res).sort(), ['energy', 'grid', 'score', 'sections']);
    });

    it('ignores unknown keys gracefully', async () => {
      const res = await handler.handle({ score: 'test-song', keys: ['nonexistent'] });
      assert.deepEqual(Object.keys(res).sort(), ['grid', 'score']);
    });

    it('empty keys array returns everything', async () => {
      const res = await handler.handle({ score: 'test-song', keys: [] });
      const all = await handler.handle({ score: 'test-song' });
      assert.deepEqual(Object.keys(res).sort(), Object.keys(all).sort());
    });
  });

  describe('score not found', () => {
    it('throws ScoreNotFound for unknown song', async () => {
      await assert.rejects(
        () => handler.handle({ score: 'no-such-song' }),
        { code: 'SCORE_NOT_FOUND', status: 404 },
      );
    });
  });
});
