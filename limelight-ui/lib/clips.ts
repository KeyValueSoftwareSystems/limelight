import type { Clip, Edit, Effect, Grid, ShowPlan } from "./types";
import { familyOfFx, familyOfEffect, acceptsClips, effectIdForPlanFx, FAMILY_AUTO_LABEL } from "./families.ts";
import { makeGridClock } from "./grid.ts";

/** A half-open range of beat indices. Beat indices are 0-based; the bars and
 *  beats they are built from are 1-based, as everywhere else in this codebase. */
export interface BeatSpan {
  from: number;
  to: number;
}

export function spanOf(bar: number, beat: number, beats: number, bpb: number): BeatSpan {
  const from = (bar - 1) * bpb + (beat - 1);
  return { from, to: from + beats };
}

/** Half-open, so a clip ending at beat 4 does not collide with one starting there. */
export function overlaps(a: BeatSpan, b: BeatSpan): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Turn the arranger's plan and the creator's edits into the clips a timeline
 *  draws. `Edit[]` is the only truth; a Clip is derived and never persisted. */
export function buildClips(
  plan: ShowPlan | null,
  edits: Edit[],
  catalogue: Effect[],
  grid: Grid,
): Clip[] {
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const byId = new Map(catalogue.map((e) => [e.id, e]));

  const secondsAtBeatIndex = (i: number) =>
    secondsAtBar(Math.floor(i / bpb) + 1, (i % bpb) + 1);

  /* Schema 1 tiles named the renderer type directly as `fx`; schema 2 tiles do
     not, so the catalogue id is the identity and the plan's word is mapped onto
     it. Comparing the two vocabularies raw meant a takeover never matched what
     it replaced, and both were drawn. */
  const speaksFx = catalogue.some((e) => e.fx);
  const planKey = (fx: string) =>
    speaksFx ? fx : (effectIdForPlanFx(fx) ?? fx);

  /* Every span a person has claimed, whether it draws a clip or suppresses one.
     Both kinds take the beat away from the arranger. */
  const claims: { fx: string; span: BeatSpan }[] = [];
  const replaced = new Set(edits.map((e) => e.from).filter(Boolean) as string[]);
  const mine: Clip[] = [];

  edits.forEach((edit, i) => {
    const spec = byId.get(edit.type);
    if (!spec) return;
    /* Schema 2 dropped `fx`; the family is found through the tile itself, so an
       unmapped effect still draws rather than vanishing. */
    const family = familyOfEffect(spec) ?? "hits";

    const beat = edit.beat ?? 1;
    const span = spanOf(edit.bar, beat, edit.beats, bpb);
    claims.push({ fx: spec.fx ?? spec.id, span });
    if (edit.off) return;

    mine.push({
      key: `mine:${i}`,
      source: "mine",
      editIndex: i,
      planId: null,
      family,
      tile: edit.type,
      fx: spec.fx ?? spec.dimension ?? spec.id,
      name: spec.name,
      bar: edit.bar,
      beat,
      beats: edit.beats,
      startS: secondsAtBeatIndex(span.from),
      endS: secondsAtBeatIndex(span.to),
      params: { ...(spec.params ?? {}), ...(edit.params ?? {}) },
      overridden: false,
    });
  });

  /* What the arranger wrote. It draws as a ghost until a person takes it over —
     which is any claim of the same renderer type overlapping it, whether that
     claim places something or suppresses it. */
  const auto: Clip[] = [];
  for (const p of plan?.punctuation ?? []) {
    const family = familyOfFx(p.fx);
    if (!family || !acceptsClips(family)) continue;
    const span = spanOf(p.bar, p.beat, p.beats, bpb);
    auto.push({
      key: `auto:${p.id}`,
      source: "auto",
      editIndex: null,
      planId: p.id,
      family,
      tile: null,
      fx: p.fx,
      name: FAMILY_AUTO_LABEL[family],
      bar: p.bar,
      beat: p.beat,
      beats: p.beats,
      startS: secondsAtBeatIndex(span.from),
      endS: secondsAtBeatIndex(span.to),
      params: p.params,
      overridden:
        replaced.has(p.id) ||
        claims.some((c) => c.fx === planKey(p.fx) && overlaps(c.span, span)),
    });
  }

  return [...auto, ...mine].sort((a, b) => a.startS - b.startS);
}
