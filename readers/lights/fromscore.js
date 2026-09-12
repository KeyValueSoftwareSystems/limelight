"use strict";
const fs = require("fs");
const path = require("path");

/* The arranger wants sections with bar/beat edges and a per-bar energy curve.
   The pipeline emits parts and bars.intensity. One place converts, so the
   reader and its tests read the same shape from the same committed score. */
function shape(raw) {
  if (Array.isArray(raw.sections)) return raw;

  if (raw.layers && raw.layers.form && Array.isArray(raw.layers.form.spans)) {
    return {
      ...raw,
      sections: raw.layers.form.spans.map(sp => ({
        from: sp.from, to: sp.to, name: sp.name, repeat: sp.repeat,
      })),
    };
  }

  const parts = raw.parts || [];
  return {
    ...raw,   // keep grid (with first_bar), beats, parts (arranger.riseOf reads them), ...
    sections: parts.map(p => ({
      from: { bar: p.from_bar, beat: 1 },
      to: { bar: p.to_bar + 1, beat: 1 },   // to_bar is inclusive; sections are half-open
      name: p.role,
      nth: p.nth,                            // tells repeated drops apart
      repeat: p.returns ? p.like : undefined,
      like: p.like,
      feels: p.feels,
      playing: p.playing,
      fullness: p.fullness,
      rise: p.rise,
      stems: p.stems,                        // the arranger drives drum accents off these
    })),
    energy: Array.isArray(raw.energy) ? raw.energy
      : (raw.bars && raw.bars.intensity) || [],
  };
}

function load(file) {
  const at = file || path.join(__dirname, "..", "..", "protocol", "levels.score");
  return shape(JSON.parse(fs.readFileSync(at, "utf8")));
}

module.exports = { shape, load };
