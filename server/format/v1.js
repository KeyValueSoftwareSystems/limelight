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

export const KNOWN = ['song', 'grid', 'beats', 'downbeats', 'sections', 'energy',
                      'brightness', 'width', 'air', 'pump', 'pace', 'moments', 'phrases', 'layers', 'chords', 'key', 'loudness',
                      'feel'];

const STEMS = ['drums', 'bass', 'vocals', 'guitar', 'piano', 'other'];

/**
 * @param {object} raw  Parsed score file from disk.
 * @returns {object} Response-shaped object with all available fields.
 */
export function format(raw) {
  const out = {};

  out.score   = raw.score;
  out.version = raw.version;

  if (raw.song) out.song = raw.song;

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
      from:     { bar: part.from_bar, beat: 1 },
      to:       { bar: part.to_bar + 1, beat: 1 },
      name:     part.role,
      nth:      part.nth,
      repeat:   part.returns ? part.like : undefined,
      like:     part.like,
      feels:    part.feels,
      playing:  part.playing,
      fullness: part.fullness,
      rise:     part.rise,
      stems:    part.stems,
    }));
  }

  if (raw.energy) {
    out.energy = raw.energy;
  } else if (Array.isArray(raw.bars?.intensity)) {
    out.energy = raw.bars.intensity;
  }

  if (raw.phrases) out.phrases = raw.phrases;
  if (raw.melody) out.melody = raw.melody;
  if (raw.voice) out.voice = raw.voice;
  if (raw.lead) out.lead = raw.lead;
  if (raw.tension) out.tension = { per: 'beat', values: raw.tension };
  if (raw.releases) out.releases = raw.releases;
  if (raw.phrase_grid) out.phrase_grid = raw.phrase_grid;
  if (raw.scales) out.scales = raw.scales;
  if (raw.made_by) out.made_by = raw.made_by;
  if (raw.chord_changes) out.chord_changes = raw.chord_changes;
  if (raw.presence) out.presence = raw.presence;

  for (const lane of ['width', 'air', 'pump', 'pace',
                      'drums', 'bass', 'vocals', 'other']) {
    if (Array.isArray(raw.bars?.[lane])) out[lane] = raw.bars[lane];
  }

  if (raw.moments) {
    out.moments = raw.moments;
  } else if (Array.isArray(raw.events)) {
    out.moments = raw.events.map(event => ({
      at:       { bar: event.bar, beat: event.beat },
      is:       event.is,
      strength: event.strength,
      ...(event.for_bars ? { for_bars: event.for_bars } : {}),
      ...(event.then     ? { then:     event.then     } : {}),
      ...(event.after    ? { after:    event.after    } : {}),
      ...(event.leaves   ? { leaves:   event.leaves   } : {}),
    }));
  }

  if (raw.layers) out.layers = raw.layers;

  if (Array.isArray(raw.bars?.chord)) {
    out.chords = raw.bars.chord.map((name, i) => ({
      bar:  i + (raw.grid?.first_beat_s > 0.2 ? 0 : 1),
      name,
      sure: raw.bars.chord_sure?.[i],
    })).filter(c => c.name);
  }

  if (Array.isArray(raw.bars?.brightness)) out.brightness = raw.bars.brightness;

  if (raw.key || raw.chords) {
    out.key = { ...(raw.key ?? {}) };
    if (raw.chords) {
      out.key.chords_say = {
        root:       raw.chords.root,
        scale:      raw.chords.scale,
        confidence: raw.chords.confidence,
      };
      out.key.changes_per_beat = raw.chords.changes_per_beat;
    }
  }

  if (raw.loudness) out.loudness = raw.loudness;
  if (raw.feel)     out.feel     = raw.feel;

  return out;
}
