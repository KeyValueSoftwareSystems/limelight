/**
 * Reading a hand-authored show file.
 *
 * THE SHAPE, and why it is a good one. A show file has three lists, and they are
 * three different things rather than one list with a type tag:
 *
 *   states    what the rig is DOING through a section — the resting condition.
 *   bindings  a section where the rig follows an audio stream instead of a state.
 *   gestures  punctuation, hung on a moment.
 *
 * That split is the part worth keeping. The baked plan this replaces put the
 * base look in `plan.looks`, which nothing ever drew, so the timeline showed the
 * punctuation floating over a look nobody could see or edit. Here the resting
 * condition is a first-class row.
 *
 * WHAT HAD TO BE ADDED, and why. Every item positions itself by INDEX —
 * `section: 3`, `moment: 14` — into the song's own lists. That is readable and
 * it is how the file was written, but an index is only meaningful against the
 * exact score it was authored from. The file supplied for raga-of-revenge
 * references moments up to 30; that score carries 8. Nineteen of its
 * twenty-one gestures point at nothing, and nothing in the format could say so.
 *
 * So `at` is added: the resolved position, in bars and beats, carried in the
 * file. The index stays as provenance — it records WHY the cue is there — but
 * `at` is what the timeline draws. `resolve()` fills `at` in from the score when
 * it is missing and can, and reports it when it cannot, rather than dropping the
 * cue on the floor.
 */

import type { Grid, Section, Moment, Clip, Family } from "./types";
import { makeGridClock } from "./grid.ts";
import { familyOfEffect } from "./families.ts";

/* ── the file ────────────────────────────────────────────────────────────── */

/** A resolved position. Bars and beats are 1-based, as everywhere else here. */
export interface At {
  bar: number;
  beat?: number;
  beats: number;
  /** optional, and only ever a cross-check: the grid is the authority */
  start_s?: number;
  end_s?: number;
}

export interface ShowFileItem {
  /** stable across edits, so selection and undo have something to hold */
  id?: string;
  effect: string;
  why?: string;
  at?: At;
  /** provenance: which section or moment this was hung on */
  section?: number;
  moment?: number;
  /** pull a gesture earlier than its moment, for a cue that has to land before the hit */
  lead_beats?: number;
  for_beats?: number;
  over_beats?: number;
  [dial: string]: unknown;
}

export interface ShowFile {
  schema?: string;
  song?: string;
  plan?: string;
  grid?: Grid;
  duration_s?: number;
  states?: ShowFileItem[];
  bindings?: ShowFileItem[];
  gestures?: ShowFileItem[];
}

export type Row = "state" | "binding" | "gesture";

export interface ResolvedCue {
  id: string;
  row: Row;
  effect: string;
  bar: number;
  beat: number;
  beats: number;
  startS: number;
  endS: number;
  params: Record<string, unknown>;
  why?: string;
  section?: number;
  moment?: number;
  /** beats this cue was pulled earlier than its anchor, if any */
  leadBeats?: number;
}

export interface Problem {
  id: string;
  row: Row;
  effect: string;
  /** what is wrong, in words a person can act on */
  says: string;
}

export interface Resolved {
  cues: ResolvedCue[];
  problems: Problem[];
  plan?: string;
  song?: string;
}

/** The score facts a file is resolved against. */
export interface Against {
  grid: Grid;
  sections: Section[];
  moments: Moment[];
  duration_s?: number | null;
}

/* fields that position or explain a cue rather than dial it */
const NOT_A_DIAL = new Set([
  "id", "effect", "why", "at", "section", "moment", "lead_beats",
]);

function dialsOf(item: ShowFileItem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (!NOT_A_DIAL.has(k)) out[k] = v;
  }
  return out;
}

/* ── resolving ───────────────────────────────────────────────────────────── */

/**
 * Turn a show file into cues the timeline can draw.
 *
 * Anything that cannot be placed comes back in `problems` with its own words.
 * A cue that silently vanishes is worse than one that is reported missing: the
 * file looks like it worked and the room stays dark.
 */
export function resolve(file: ShowFile, against: Against): Resolved {
  const grid = file.grid ?? against.grid;
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const cues: ResolvedCue[] = [];
  const problems: Problem[] = [];

  /** seconds → nearest bar/beat on this grid */
  const positionOf = (t: number): { bar: number; beat: number } => {
    /* walk beats rather than invert the tempo map: a song with a tempo change
       has no closed form, and the grid clock is the only thing that knows it */
    const total = Math.max(1, (grid.bars ?? 200) * bpb);
    let best = 0;
    let bestD = Infinity;
    for (let n = 0; n < total; n++) {
      const d = Math.abs(secondsAtBar(Math.floor(n / bpb) + 1, (n % bpb) + 1) - t);
      if (d < bestD) { bestD = d; best = n; }
      else if (d > bestD) break;                 // times increase; we are past it
    }
    return { bar: Math.floor(best / bpb) + 1, beat: (best % bpb) + 1 };
  };

  const push = (item: ShowFileItem, row: Row, i: number) => {
    const id = item.id ?? `${row[0]}${i}`;
    const dials = dialsOf(item);
    const lead = Math.max(0, Math.round(Number(item.lead_beats) || 0));

    let at = item.at;

    /* no explicit position: work it out from the index it was hung on */
    if (!at) {
      if (row === "gesture") {
        const m = against.moments?.[item.moment ?? -1];
        if (!m) {
          problems.push({ id, row, effect: item.effect,
            says: `moment ${item.moment} does not exist — this song has ${against.moments?.length ?? 0}` });
          return;
        }
        const beats = Math.max(1, Math.round(Number(item.for_beats ?? item.over_beats) || 1));
        const p = positionOf(m.t);
        const n = Math.max(0, (p.bar - 1) * bpb + (p.beat - 1) - lead);
        at = { bar: Math.floor(n / bpb) + 1, beat: (n % bpb) + 1, beats };
      } else {
        const s = against.sections?.[item.section ?? -1];
        if (!s) {
          problems.push({ id, row, effect: item.effect,
            says: `section ${item.section} does not exist — this song has ${against.sections?.length ?? 0}` });
          return;
        }
        /* a state holds for its whole section, so its length is the section's */
        const a = positionOf(Math.max(0, s.start));
        const b = positionOf(s.end);
        const from = (a.bar - 1) * bpb + (a.beat - 1);
        const to = (b.bar - 1) * bpb + (b.beat - 1);
        at = { bar: a.bar, beat: a.beat, beats: Math.max(1, to - from) };
      }
    }

    const beat = at.beat ?? 1;
    const beats = Math.max(1, Math.round(at.beats || 1));
    const startS = secondsAtBar(at.bar, beat);
    const n = (at.bar - 1) * bpb + (beat - 1) + beats;
    const endS = secondsAtBar(Math.floor(n / bpb) + 1, (n % bpb) + 1);

    cues.push({
      id, row, effect: item.effect,
      bar: at.bar, beat, beats, startS, endS,
      params: dials, why: item.why,
      section: item.section, moment: item.moment,
      leadBeats: lead || undefined,
    });
  };

  (file.states ?? []).forEach((x, i) => push(x, "state", i));
  (file.bindings ?? []).forEach((x, i) => push(x, "binding", i));
  (file.gestures ?? []).forEach((x, i) => push(x, "gesture", i));

  cues.sort((a, b) => a.startS - b.startS);
  return { cues, problems, plan: file.plan, song: file.song };
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

/** A state is the resting condition, so it reads as a wash rather than as a hit. */
const ROW_FAMILY: Record<Row, Family> = {
  state: "wash",
  binding: "breath",
  gesture: "hits",
};

/**
 * Cues → the clips the timeline already knows how to draw.
 *
 * The family decides the lane colour. An effect the catalogue knows keeps its
 * own family; anything else falls back to what its ROW means, so a show file
 * naming an effect this build has never heard of still draws.
 */
export function toClips(
  resolved: Resolved,
  catalogue: Array<{ id: string; name?: string; fx?: string }> = [],
): Clip[] {
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  return resolved.cues.map((c) => {
    const spec = byId.get(c.effect);
    const family = (spec ? familyOfEffect(spec as never) : null) ?? ROW_FAMILY[c.row];
    return {
      key: `file:${c.id}`,
      source: "auto" as const,
      editIndex: null,
      planId: c.id,
      family,
      tile: spec ? c.effect : null,
      fx: c.effect,
      name: spec?.name ?? c.effect,
      bar: c.bar,
      beat: c.beat,
      beats: c.beats,
      startS: c.startS,
      endS: c.endS,
      params: c.params,
      overridden: false,
    };
  });
}

/**
 * Which cues this build can actually put in the room.
 *
 * Naming an effect is not the same as rendering it: the catalogue carries 17
 * tiles and the renderer answers to 8 words. A file may also name an effect that
 * does not exist here at all. Both are reported, because a cue that draws on the
 * timeline and does nothing to the rig is the failure mode this whole format is
 * meant to avoid.
 */
export function coverage(
  resolved: Resolved,
  catalogueIds: string[],
  renderableIds: string[],
): { renders: ResolvedCue[]; unknown: ResolvedCue[]; noRenderer: ResolvedCue[] } {
  const known = new Set(catalogueIds);
  const can = new Set(renderableIds);
  const renders: ResolvedCue[] = [];
  const unknown: ResolvedCue[] = [];
  const noRenderer: ResolvedCue[] = [];
  for (const c of resolved.cues) {
    if (!known.has(c.effect)) unknown.push(c);
    else if (!can.has(c.effect)) noRenderer.push(c);
    else renders.push(c);
  }
  return { renders, unknown, noRenderer };
}
