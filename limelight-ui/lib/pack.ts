import type { Clip } from "./types";

/* Clips that overlap in time are stacked into rows, the way a video editor
   spawns a track when you drop something on top of something else. Nothing is
   ever hidden behind anything else, and a collision becomes visible instead of
   silent. Rows are packed greedily: each clip takes the lowest row with room
   for it. */

export interface PackedClip {
  clip: Clip;
  row: number;
  /** True when this clip shares its lane AND its time with another. The
   *  renderer resolves one effect per type per beat, so an overlap inside a
   *  lane means one of them will not be heard. */
  collides: boolean;
}

export interface Packed {
  rows: number;
  items: PackedClip[];
}

/** The clip the creator is holding, and the row it must stay on. */
export interface Pin {
  key: string;
  row: number;
}

interface Span {
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
  /* Every span in the row, not just the last one. With a pinned clip placed
     ahead of its turn a row is no longer filled strictly left to right, so
     "does it clear the last thing here" stops being the same question as "is
     there room here". Rows hold a handful of clips; the honest test is cheap. */
  return !taken.some((s) => hits(s, span));
}

function put(rows: Span[][], row: number, span: Span): void {
  while (rows.length <= row) rows.push([]);
  rows[row].push(span);
}

/**
 * Stack clips into rows.
 *
 * `pin` holds ONE clip on ONE row for as long as the creator has hold of it.
 * Without it, the row a clip lands on is a function of where it starts — so
 * dragging a clip past the end of its neighbour re-packed it onto another row
 * mid-gesture, and the thing under the pointer jumped a lane while being
 * carried. The clip you are moving is the one fixed point of the gesture; it is
 * everything ELSE that should give way, which is what pinning it does: it takes
 * its row first, and the rest pack around it.
 */
export function packRows(clips: Clip[], pin?: Pin | null): Packed {
  const sorted = [...clips].sort((a, b) => a.startS - b.startS || a.endS - b.endS);
  const rows: Span[][] = [];
  const items: PackedClip[] = [];

  const pinned = pin ? sorted.find((c) => c.key === pin.key) : undefined;
  if (pinned && pin) {
    const row = Math.max(0, Math.floor(pin.row));
    put(rows, row, { from: pinned.startS, to: pinned.endS });
    items.push({ clip: pinned, row, collides: false });
  }

  for (const clip of sorted) {
    if (clip === pinned) continue;
    const span = { from: clip.startS, to: clip.endS };
    let row = 0;
    while (!free(rows, row, span)) row++;
    put(rows, row, span);
    items.push({ clip, row, collides: false });
  }

  /* Collision is a fact about TIME, not about which row something landed on.
     Reading it off the row index was a shortcut that held only while rows were
     filled strictly in start order — a pinned clip alone on row 2 is not
     colliding with anything, and the clip it was dragged clear of is no longer
     colliding either. Asking the question directly cannot go stale. */
  for (const item of items) {
    item.collides = items.some(
      (o) =>
        o !== item &&
        o.clip.startS < item.clip.endS &&
        item.clip.startS < o.clip.endS,
    );
  }

  /* Back into drawing order, so the caller's rows and the clip list agree
     however the pin reshuffled the placement pass. */
  items.sort((a, b) => a.clip.startS - b.clip.startS || a.clip.endS - b.clip.endS);

  return { rows: Math.max(1, rows.length), items };
}
