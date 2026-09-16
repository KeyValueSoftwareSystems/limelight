import type { Edit, Effect, Show } from "./types";
import { makeGridClock, beatIndexAt } from "./grid";

/* ── v2 plan <-> the editor's Edit[] ──────────────────────────────────────────
   The portal composer/baker speak a v2 plan { plan, states[], bindings[],
   gestures[] } where entries are anchored to a SECTION index (states, bindings)
   or a MOMENT index / moment span (gestures). The editor's only truth is Edit[]
   anchored to bar/beat/beats. Rather than teach the timeline a new model, we
   translate: our data is expressed in THEIR structure.

   The mapping is deterministic against the baked show (its grid, sections and
   moments), so it round-trips: a gesture's `lead_beats` is recovered from where
   the clip sits relative to its nearest moment, so an imported blackout that
   lands one beat before the peak still bakes one beat before the peak after an
   edit-and-rebake. */

interface V2Entry {
  effect: string;
  section?: number;
  moment?: number;
  from_moment?: number;
  to_moment?: number;
  at_s?: number;
  from_s?: number;
  to_s?: number;
  lead_beats?: number;
  why?: string;
  [dial: string]: unknown;
}

export interface V2Plan {
  plan?: string;
  states?: V2Entry[];
  bindings?: V2Entry[];
  gestures?: V2Entry[];
}

/* keys that are anchors/meta, not dials the creator turns */
const META = new Set(["effect", "section", "moment", "from_moment", "to_moment",
  "at_s", "from_s", "to_s", "lead_beats", "why"]);
/* Only `for_beats` is the baker's gesture SPAN, carried by the clip length, so it
   is not shown as a dial. `over_beats` is a different thing — an effect's internal
   animation length (lift/strip) — and stays a normal dial. */
const DURATION_KEYS = ["for_beats"];

/* `span_anchors` (e.g. ramp's [from_moment, to_moment]) is a schema-2 field the
   Effect type doesn't model; read it off the raw object. */
function spanAnchors(e: Effect | undefined): boolean {
  const v = (e as unknown as Record<string, unknown> | undefined)?.["span_anchors"];
  return Array.isArray(v) && v.length >= 2;
}

/* the EXACT (fractional) beat span — rounding it would move a span gesture's end
   by up to half a beat, and the beat-locked effects (ramp/beam/spin) drift. */
function beatSpan(grid: Show["grid"], a: number, b: number): number {
  const ia = beatIndexAt(a, grid) ?? 0;
  const ib = beatIndexAt(b, grid) ?? ia;
  return Math.max(0.001, ib - ia);
}

function sectionIndexAt(t: number, sections: Show["sections"]): number {
  for (let i = 0; i < sections.length; i++) {
    if (t >= sections[i].start && t < sections[i].end) return i;
  }
  let best = 0, bd = Infinity;
  sections.forEach((s, i) => { const d = Math.abs(s.start - t); if (d < bd) { bd = d; best = i; } });
  return best;
}

function dials(entry: V2Entry, dropDuration: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in entry) {
    if (META.has(k)) continue;
    if (dropDuration && DURATION_KEYS.includes(k)) continue;
    out[k] = entry[k];
  }
  return out;
}

/* ── v2 plan -> Edit[] (for the timeline to draw) ───────────────────────────── */

export function planToEdits(plan: V2Plan, show: Show, catalogue: Effect[] = []): Edit[] {
  const grid = show.grid;
  const bpb = grid.beats_per_bar ?? 4;
  const sections = show.sections ?? [];
  const moments = show.moments ?? [];
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const edits: Edit[] = [];
  const beatDur = 60 / (grid.bpm || 120);
  /* a point gesture's span is for_beats, else the effect's default_beats — NOT
     over_beats, which is an animation dial the baker does not use for the span. */
  const pointBeats = (g: V2Entry) => (g.for_beats as number) ?? byId.get(g.effect)?.default_beats ?? 1;

  /* Keep the FRACTIONAL beat, not positionAt()'s floored integer: moments sit
     mid-beat, so flooring would snap a gesture to the wrong beat (and, on rebake,
     to the wrong moment). Edit.beat is a number, so secondsAtBar(bar, beat)
     recovers the exact time. */
  const push = (type: string, startS: number, beats: number, params: Record<string, unknown>) => {
    const bi = beatIndexAt(startS, grid) ?? 0;
    const bar = Math.floor(bi / bpb) + 1;
    const beat = bi - (bar - 1) * bpb + 1;
    edits.push({ type, bar, beat, beats: Math.max(0.001, beats), params });
  };

  for (const s of plan.states ?? []) {
    const sec = sections[s.section ?? -1];
    if (!sec) continue;
    push(s.effect, sec.start, beatSpan(grid, sec.start, sec.end), dials(s, false));
  }
  for (const b of plan.bindings ?? []) {
    const sec = sections[b.section ?? -1];
    if (!sec) continue;
    /* a binding fills its section; a dial like accent's for_beats stays a dial */
    push(b.effect, sec.start, beatSpan(grid, sec.start, sec.end), dials(b, false));
  }
  for (const g of plan.gestures ?? []) {
    /* anchors, in the baker's own precedence: absolute seconds, then moments */
    if (g.from_s != null && g.to_s != null) {
      push(g.effect, g.from_s, beatSpan(grid, g.from_s, g.to_s), dials(g, true));
    } else if (g.at_s != null) {
      const startS = g.at_s - (g.lead_beats ?? 0) * beatDur;
      push(g.effect, startS, pointBeats(g), dials(g, true));
    } else if (g.from_moment != null && g.to_moment != null) {
      const fm = moments[g.from_moment], tm = moments[g.to_moment];
      if (!fm || !tm) continue;
      push(g.effect, fm.t, beatSpan(grid, fm.t, tm.t), dials(g, true));
    } else if (g.moment != null) {
      const m = moments[g.moment];
      if (!m) continue;
      const startS = m.t - (g.lead_beats ?? 0) * beatDur;
      push(g.effect, startS, pointBeats(g), dials(g, true));
    }
  }
  return edits;
}

/* ── Edit[] -> v2 plan (to bake through /api/bake-plan) ─────────────────────── */

export function editsToPlan(edits: Edit[], show: Show, catalogue: Effect[], planText = ""): V2Plan {
  const grid = show.grid;
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const sections = show.sections ?? [];
  const byId = new Map(catalogue.map((e) => [e.id, e]));

  const secondsAtBeatIndex = (i: number) => secondsAtBar(Math.floor(i / bpb) + 1, (i % bpb) + 1);

  const states: V2Entry[] = [];
  const bindings: V2Entry[] = [];
  const gestures: V2Entry[] = [];

  for (const e of edits) {
    if (e.off) continue;
    const eff = byId.get(e.type);
    const kind = eff?.kind ?? "gesture";
    const startS = secondsAtBar(e.bar, e.beat ?? 1);
    const startIdx = (e.bar - 1) * bpb + ((e.beat ?? 1) - 1);
    const endS = secondsAtBeatIndex(startIdx + e.beats);
    const params = { ...(e.params ?? {}) };

    if (kind === "state") {
      /* a state/binding fills a section; map by the span's MIDPOINT so a start
         time rounded to the nearest beat cannot fall into the section before. */
      states.push({ effect: e.type, section: sectionIndexAt((startS + endS) / 2, sections), ...params });
    } else if (kind === "binding") {
      bindings.push({ effect: e.type, section: sectionIndexAt((startS + endS) / 2, sections), ...params });
    } else {
      /* Emit ABSOLUTE-SECONDS anchors (the baker supports at_s / from_s+to_s).
         Seconds are exact, so a clip round-trips to the same time with no
         moment-nearest guessing; the timeline is where the creator positions by
         time anyway. A span effect (ramp/beam/spin) keeps its span. */
      const round3 = (x: number) => Math.round(x * 1000) / 1000;
      if (spanAnchors(eff)) {
        gestures.push({ effect: e.type, from_s: round3(startS), to_s: round3(endS), ...params });
      } else {
        /* the clip length is for_beats (the baker span); over_beats, if any, is
           already carried through in params as a dial. */
        gestures.push({ effect: e.type, at_s: round3(startS), ...params, for_beats: round3(e.beats) });
      }
    }
  }

  return { plan: planText, states, bindings, gestures };
}
