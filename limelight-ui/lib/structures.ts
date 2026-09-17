/**
 * The steel: which fixtures form one structure, and in what order.
 *
 * This file answers ONLY that question. It says nothing about how a structure
 * is drawn, because the two views draw in different spaces — the flat renderer
 * strokes screen coordinates, Stage3D builds geometry in world metres. Grouping
 * is a fact about the rig; drawing is the viewpoint's business, exactly the line
 * lib/exposure.ts draws for frame-level numbers.
 *
 * Two rules, in order:
 *
 *   1. A fixture carrying a `group` belongs to that group. This is how an arch
 *      exists: its members vary in height, so no height-based rule could ever
 *      find them.
 *   2. A fixture with no `group` falls back to the original rule — fixtures
 *      sharing a height and a depth are on one bar. Every layout in the repo
 *      before halo-portal relies on this, so it must not move.
 *
 * A group's KIND is derived, never declared: members that all share a height and
 * a depth are a `bar`, anything else is a `curve`. That means a named truss of
 * six spots still draws as one straight bar without anyone saying so.
 *
 * Groups of fewer than two members draw nothing. That is what makes a pixelbar
 * its own group: it IS a bar fixture, so it needs no steel drawn between it and
 * its neighbour, and a unique group name says so without a special case.
 */
import type { Fixture } from "./types";

export interface StructureGroup {
  /** the group name, or the derived "height:depth" key for ungrouped fixtures */
  key: string;
  kind: "bar" | "curve";
  /** indices into the fixtures array passed in, ordered left to right */
  members: number[];
}

const TOL = 0.01;

export function groupStructures(fixtures: Fixture[]): StructureGroup[] {
  const buckets = new Map<string, number[]>();

  fixtures.forEach((f, i) => {
    if (!f.at) return;                       // no position: nothing to draw through
    const key = f.group ?? `${f.at[2].toFixed(2)}:${f.at[1].toFixed(2)}`;
    const b = buckets.get(key);
    if (b) b.push(i); else buckets.set(key, [i]);
  });

  const out: StructureGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;

    /* An arch is single-valued in x, so ordering by x traces it from one leg up
       over the apex and down the other. A bar is ordered by x too. */
    members.sort((a, b) => (fixtures[a].at as number[])[0] - (fixtures[b].at as number[])[0]);

    const first = fixtures[members[0]].at as number[];
    const flat = members.every((i) => {
      const a = fixtures[i].at as number[];
      return Math.abs(a[2] - first[2]) < TOL && Math.abs(a[1] - first[1]) < TOL;
    });

    out.push({ key, kind: flat ? "bar" : "curve", members });
  }
  return out;
}
