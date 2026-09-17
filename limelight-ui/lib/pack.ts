import type { Clip } from "./types";

/* Clips are stacked into rows, and a row is the clip's LANE: which of two
   overlapping effects the baked show plays. That makes it the clip's own
   property rather than something read off its neighbours — see Edit.layer.

   Anything carrying a layer claims that lane outright. The arranger's own
   clips carry none (they have no Edit to store one on), so they pack greedily
   into whatever is left: each takes the lowest lane with room for it, the way
   a video editor spawns a track when you drop something on top of something. */

export interface PackedClip {
  clip: Clip;
  row: number;
  /** True when this clip shares its lane AND its time with another of the same
   *  kind. The baker resolves one gesture per fixture per frame and one base
   *  under it, so a same-kind overlap inside a lane means one of them will not
   *  be heard. Across kinds it means nothing — a gesture is composited OVER a
   *  state, not instead of it — so flagging that was crying wolf. */
  collides: boolean;
}

export interface Packed {
  rows: number;
  items: PackedClip[];
}

export interface Span {
  from: number;
  to: number;
}

/* Half-open: a clip ending exactly where another starts is a handover, not a
   collision. */
function hits(a: Span, b: Span): boolean {
  return a.from < b.to && b.from < a.to;
}

function free(rows: Span[][], row: number, span: Span): boolean {
  const taken = rows[row];
  if (!taken) return true;
  /* Every span in the row, not just the last one. With pinned clips placed
     ahead of their turn a row is no longer filled strictly left to right, so
     "does it clear the last thing here" stops being the same question as "is
     there room here". Rows hold a handful of clips; the honest test is cheap. */
  return !taken.some((s) => hits(s, span));
}

function put(rows: Span[][], row: number, span: Span): void {
  while (rows.length <= row) rows.push([]);
  rows[row].push(span);
}

/**
 * The row each span lands on, in the order the spans were given.
 *
 * `pinned[i]` is the lane span `i` must have; null or undefined lets it fall
 * where there is room. Pinned spans claim their lane FIRST, before anything is
 * packed greedily, so the free ones give way to them rather than the other way
 * round — and two pinned spans may share a lane and overlap, which is exactly
 * what "these two are fighting over the same lane" looks like.
 *
 * Kept span-based so the seeding pass can use it: layers have to be decided for
 * `Edit[]`, which has no Clip built from it yet.
 */
export function packSpans(spans: Span[], pinned?: (number | null | undefined)[]): number[] {
  const rows: Span[][] = [];
  const out: number[] = new Array(spans.length).fill(0);
  const pinOf = (i: number) => {
    const p = pinned?.[i];
    return typeof p === "number" && isFinite(p) ? Math.max(0, Math.floor(p)) : null;
  };

  for (let i = 0; i < spans.length; i++) {
    const row = pinOf(i);
    if (row === null) continue;
    put(rows, row, spans[i]);
    out[i] = row;
  }

  /* Start order among the rest, so a lane fills left to right and reads the way
     it is played. */
  const loose = spans
    .map((_, i) => i)
    .filter((i) => pinOf(i) === null)
    .sort((a, b) => spans[a].from - spans[b].from || spans[a].to - spans[b].to);

  for (const i of loose) {
    let row = 0;
    while (!free(rows, row, spans[i])) row++;
    put(rows, row, spans[i]);
    out[i] = row;
  }

  return out;
}

/**
 * Stack clips into rows. A clip's own `layer` is its lane; the arranger's clips
 * (which have none) pack around them.
 */
export function packRows(clips: Clip[]): Packed {
  const sorted = [...clips].sort((a, b) => a.startS - b.startS || a.endS - b.endS);
  const spans = sorted.map((c) => ({ from: c.startS, to: c.endS }));
  /* An arranger clip has no Edit, so no stored lane, so nothing to pin it to. */
  const pinned = sorted.map((c) => c.layer);
  const packed = packSpans(spans, pinned);

  const items: PackedClip[] = sorted.map((clip, i) => ({
    clip,
    row: packed[i],
    collides: false,
  }));

  /* Sharing a lane with something of the same kind, at the same time, is the
     one overlap that costs you a cue. Asking it directly cannot go stale the
     way reading it off the packing order could. */
  for (const item of items) {
    item.collides = items.some(
      (o) =>
        o !== item &&
        o.row === item.row &&
        o.clip.kind === item.clip.kind &&
        o.clip.startS < item.clip.endS &&
        item.clip.startS < o.clip.endS,
    );
  }

  return { rows: Math.max(1, packed.length ? Math.max(...packed) + 1 : 0), items };
}
