/* Snapping here is musical, not temporal. A creator reaches for the drop, the
   chorus, or the bar line — never for 34.86 seconds. */

export type SnapKind = "playhead" | "section" | "moment" | "bar" | "beat";
export type SnapStrength = "bar" | "beat" | "off";

export interface SnapTarget {
  kind: SnapKind;
  beat: number;
  label: string;
}

export interface SnapContext {
  bpb: number;
  totalBeats: number;
  playheadBeat: number | null;
  sections: { beat: number; label: string }[];
  moments: { beat: number; label: string }[];
}

/* Lower is stronger. A section boundary beats a nearer moment, because landing
   on the chorus is almost always what was meant. */
const PRIORITY: Record<SnapKind, number> = {
  playhead: 0, section: 1, moment: 2, bar: 3, beat: 4,
};

export function resolveSnap(
  ctx: SnapContext,
  rawBeat: number,
  radius: number,
  strength: SnapStrength,
): SnapTarget | null {
  if (strength === "off") return null;

  const near = (b: number) => Math.abs(b - rawBeat) <= radius;
  const inSong = (b: number) => b >= 0 && b <= ctx.totalBeats;
  const out: SnapTarget[] = [];

  if (ctx.playheadBeat !== null && near(ctx.playheadBeat)) {
    out.push({ kind: "playhead", beat: ctx.playheadBeat, label: "playhead" });
  }
  for (const s of ctx.sections) {
    if (near(s.beat)) out.push({ kind: "section", beat: s.beat, label: s.label });
  }
  for (const m of ctx.moments) {
    if (near(m.beat)) out.push({ kind: "moment", beat: m.beat, label: m.label });
  }

  const bar = Math.round(rawBeat / ctx.bpb) * ctx.bpb;
  if (near(bar) && inSong(bar)) {
    out.push({ kind: "bar", beat: bar, label: `bar ${bar / ctx.bpb + 1}` });
  }

  if (strength === "beat") {
    const beat = Math.round(rawBeat);
    if (near(beat) && inSong(beat)) {
      out.push({ kind: "beat", beat, label: `beat ${(beat % ctx.bpb) + 1}` });
    }
  }

  if (!out.length) return null;
  out.sort(
    (a, b) =>
      PRIORITY[a.kind] - PRIORITY[b.kind] ||
      Math.abs(a.beat - rawBeat) - Math.abs(b.beat - rawBeat),
  );
  return out[0];
}
