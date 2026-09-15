"use strict";
/* What the arranger wrote, in the page's own bar numbering, so the editor can
   draw it as ghost clips and show which of it a person has taken over.
   `shift` is bake.js's bar correction: page bar = plan bar + shift. */
const PUNCTUATION_LAYERS = new Set(["fx", "accent", "whiten"]);

function planFor(p, sections, bpb, shift) {
  const at = q => (q.bar - 1) * bpb + ((q.beat || 1) - 1);
  const assignments = p.assignments || [];

  const punctuation = [];
  assignments.forEach((a, i) => {
    if (!PUNCTUATION_LAYERS.has(a.layer) || !a.type) return;
    punctuation.push({
      id: "p" + i,
      fx: a.type,
      bar: a.from.bar + shift,
      beat: a.from.beat || 1,
      beats: at(a.to) - at(a.from),
      params: a.params || {},
      context: a.context || null,
    });
  });

  const dynamics = assignments
    .filter(a => a.layer === "modulate")
    .map(a => ({
      bar: a.from.bar + shift,
      beats: at(a.to) - at(a.from),
      gain: (a.params && a.params.gain) !== undefined ? a.params.gain : 1,
      motion: (a.params && a.params.motion) !== undefined ? a.params.motion : 0,
      doing: (a.params && a.params.doing) || null,
    }));

  const covering = (layer, beat) => {
    const a = assignments.find(x => x.layer === layer && at(x.from) <= beat && beat < at(x.to));
    return a && a.seq_id ? a.seq_id : null;
  };
  const looks = (sections || []).map((sec, i) => {
    const beat = at({ bar: sec.from.bar, beat: 1 });
    return { section: i, par: covering("par", beat), head: covering("head", beat) };
  });

  return { punctuation, dynamics, looks };
}

module.exports = { planFor };
