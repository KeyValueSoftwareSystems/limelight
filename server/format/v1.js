/**
 * v1 response formatter — aligned with protocol/respond.js.
 *
 * Known fields: grid, beats, downbeats, sections, energy, moments, layers.
 * `sections` is derived from `layers.form.spans`.
 * `layers` passes through the raw layers object.
 *
 * The formatter builds the full response with all available fields.
 * The filter (called after this) strips fields the consumer did not ask for.
 */

export const KNOWN = ['grid', 'beats', 'downbeats', 'sections', 'energy', 'moments',
                      'layers', 'chords', 'key', 'loudness'];

const STEMS = ['drums', 'bass', 'vocals', 'guitar', 'piano', 'other'];

/**
 * @param {object} raw  Parsed score file from disk.
 * @returns {object} Response-shaped object with all available fields.
 */
export function format(raw) {
  const out = {};

  out.score   = raw.score;
  out.version = raw.version;

  if (raw.grid) out.grid = raw.grid;

  if (raw.beats)     out.beats     = raw.beats;
  if (raw.downbeats) out.downbeats = raw.downbeats;

  if (raw.layers?.form?.spans) {
    out.sections = raw.layers.form.spans.map(span => ({
      from:   span.from,
      to:     span.to,
      name:   span.name,
      repeat: span.repeat,
    }));
  } else if (Array.isArray(raw.parts)) {
    out.sections = raw.parts.map(part => ({
      from:   { bar: part.from_bar, beat: 1 },
      to:     { bar: part.to_bar + 1, beat: 1 },
      name:   part.feels,
      repeat: part.repeats_as,
      playing: part.playing,
    }));
  }

  if (raw.energy) {
    out.energy = raw.energy;
  } else if (Array.isArray(raw.bars?.intensity)) {
    out.energy = raw.bars.intensity;
  }

  if (raw.moments) {
    out.moments = raw.moments;
  } else if (Array.isArray(raw.events)) {
    out.moments = raw.events.map(event => ({
      at:       { bar: event.bar, beat: event.beat },
      is:       event.is,
      strength: event.strength,
      ...(event.for_bars ? { for_bars: event.for_bars } : {}),
    }));
  }

  if (raw.layers) {
    out.layers = raw.layers;
  } else if (raw.bars) {
    const lanes = {};
    for (const stem of STEMS)
      if (Array.isArray(raw.bars[stem])) lanes[stem] = raw.bars[stem];
    if (Object.keys(lanes).length) out.layers = lanes;
  }

  if (Array.isArray(raw.bars?.chord)) {
    out.chords = raw.bars.chord.map((name, i) => ({
      bar:  i + (raw.grid?.first_beat_s > 0.2 ? 0 : 1),
      name,
      sure: raw.bars.chord_sure?.[i],
    })).filter(c => c.name);
  }

  if (raw.key)      out.key      = raw.key;
  if (raw.loudness) out.loudness = raw.loudness;

  return out;
}
