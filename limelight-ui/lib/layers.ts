import type { Edit, Grid } from "./types";
import { makeGridClock } from "./grid.ts";
import { packSpans } from "./pack.ts";

/* Lanes, once they decide what plays.
 *
 * A clip's lane is stored on its Edit. Everything that arrives from somewhere
 * else — an imported v2 plan, a show file written before this existed, a legacy
 * seed+edits bake — carries none, so it is seeded ONCE here, from the packing
 * that would have drawn it anyway. That is the only time a lane is computed:
 * after seeding, a clip's lane changes when someone changes it and at no other
 * moment. */

/**
 * Give every edit a lane, leaving alone any that already has one.
 *
 * Returns the same array when there is nothing to do, so it is free to call on
 * every path edits come in by, and idempotent if two of them overlap.
 */
export function seedLayers(edits: Edit[], grid: Grid): Edit[] {
  if (!edits.length) return edits;

  /* packSpans works in seconds and an Edit is bar/beat/beats, so the grid clock
     stands between them — the same conversion buildClips makes, and it has to
     be the same one or a seeded lane would not match the lane drawn. */
  const { secondsAtBar, bpb } = makeGridClock(grid);
  const secondsAtBeatIndex = (i: number) =>
    secondsAtBar(Math.floor(i / bpb) + 1, (i % bpb) + 1);

  const spans = edits.map((e) => {
    const from = (e.bar - 1) * bpb + ((e.beat ?? 1) - 1);
    return { from: secondsAtBeatIndex(from), to: secondsAtBeatIndex(from + e.beats) };
  });
  const pinned = edits.map((e) => (typeof e.layer === "number" ? e.layer : null));
  const packed = packSpans(spans, pinned);

  /* Then SETTLE, so what comes in obeys the same rule as what is edited here:
     nothing behind anything else. A plan can name two cues on one lane at the
     same moment — a hand-written one, or one from before lanes meant anything —
     and drawing that as it stands would hide a cue the show will never play. */
  const settled = resolveLanes(
    edits.map((e, i) => ({
      key: String(i),
      startS: spans[i].from,
      endS: spans[i].to,
      layer: pinned[i] ?? packed[i],
    })),
    new Set(),
  );

  return edits.map((e, i) => {
    const layer = settled.get(String(i)) ?? pinned[i] ?? packed[i];
    return e.layer === layer ? e : { ...e, layer };
  });
}

/**
 * How far a selection may actually move when the arrows ask for `delta` lanes.
 *
 * Layer 0 is the top and there is nothing above it, so an upward move stops
 * when the HIGHEST clip in the selection reaches it — the whole selection stops
 * together, keeping the spacing between its clips. Downward is never clamped:
 * there is always one more lane, because the timeline always draws a spare.
 *
 * Returns 0 when the selection is already as high as it goes, which is how the
 * caller knows to say so rather than commit an edit that changes nothing.
 */
export function clampLayerDelta(layers: number[], delta: number): number {
  if (!layers.length) return 0;
  if (delta >= 0) return delta;
  return Math.max(delta, -Math.min(...layers));
}

/** The one shape the cascade needs: when a clip runs, and which lane it is on. */
export interface LaneItem {
  key: string;
  startS: number;
  endS: number;
  layer: number;
}

/**
 * Settle every clip into a lane where nothing is behind anything else.
 *
 * A clip's stored lane is a FLOOR, not a reservation: it takes that lane if it
 * is free at the time it runs, and otherwise the first free lane below it. The
 * movers — whatever the gesture just placed, moved, trimmed or pasted — are
 * settled first, so they keep the lane they were put on and everything else
 * gives way around them. Joining the front of a queue moves everyone behind you
 * back one.
 *
 * Because every clip is placed into a lane that is FREE, the result can never
 * have two clips sharing a lane and a moment. That is the whole point: a lane
 * decides which effect plays, so a clip hidden under another is a cue that
 * silently will not be heard.
 *
 * This replaced a pass that only pushed aside what the movers themselves landed
 * on. It fixed the case it was written for and left two it was not: a plan
 * imported with two cues already stacked on one lane stayed stacked, and two
 * clips moved together could bury each other. Settling everything is both
 * simpler and total.
 *
 * Returns ONLY the clips whose lane changed, so a caller writes as few edits as
 * it can. A clip whose lane is free does not move, so an edit at one end of the
 * song never disturbs the other.
 *
 * Arranger clips are deliberately left out by the caller: they carry no lane,
 * so packRows already packs them around whatever has claimed one, and they give
 * way for free.
 */
export function resolveLanes(
  items: LaneItem[],
  moverKeys: ReadonlySet<string>,
): Map<string, number> {
  const hits = (a: LaneItem, b: LaneItem) => a.startS < b.endS && b.startS < a.endS;

  /* Movers first, in the order given. Then everyone else from the top lane
     down, and left to right within a lane, so the lane a clip is pushed into is
     decided by what is already settled above it rather than by list order. */
  const order = [
    ...items.filter((i) => moverKeys.has(i.key)),
    ...items
      .filter((i) => !moverKeys.has(i.key))
      .sort((a, b) => a.layer - b.layer || a.startS - b.startS || a.endS - b.endS),
  ];

  const taken: LaneItem[][] = [];
  const out = new Map<string, number>();

  for (const item of order) {
    let lane = Math.max(0, Math.floor(item.layer));
    while ((taken[lane] ?? []).some((o) => hits(o, item))) lane++;
    (taken[lane] ??= []).push(item);
    if (lane !== item.layer) out.set(item.key, lane);
  }

  return out;
}
