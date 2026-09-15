import type { Clip } from "./types";

/* Clips that overlap in time are stacked into rows, the way a video editor
   spawns a track when you drop something on top of something else. Nothing is
   ever hidden behind anything else, and a collision becomes visible instead of
   silent. Rows are packed greedily: each clip takes the first row whose last
   clip has already ended. */

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

export function packRows(clips: Clip[]): Packed {
  const sorted = [...clips].sort((a, b) => a.startS - b.startS || a.endS - b.endS);
  const rowEnds: number[] = [];
  const items: PackedClip[] = [];

  for (const clip of sorted) {
    let row = rowEnds.findIndex((end) => end <= clip.startS);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(clip.endS);
    } else {
      rowEnds[row] = clip.endS;
    }
    items.push({ clip, row, collides: row > 0 });
  }

  /* A clip pushed off row 0 collided with something; so did whatever it
     collided with, which is still sitting on an earlier row. */
  for (const item of items) {
    if (item.row === 0) {
      item.collides = items.some(
        (o) =>
          o !== item &&
          o.clip.startS < item.clip.endS &&
          item.clip.startS < o.clip.endS,
      );
    }
  }

  return { rows: Math.max(1, rowEnds.length), items };
}
