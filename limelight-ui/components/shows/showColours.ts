import type { ShowFile } from "@/lib/types";

const FALLBACK = ["#6E97CE", "#8AACDC", "#5F7FA8", "#9BB6DE", "#4E6E9B"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

/** The palette a show actually spends, read off its own plan. */
export function showColours(show: ShowFile, n = 5): string[] {
  const plan = show.plan as unknown as
    | { states?: Array<{ colour?: number[] }> }
    | null
    | undefined;
  const out: string[] = [];
  for (const st of plan?.states ?? []) {
    const c = st.colour;
    if (!Array.isArray(c) || c.length < 3) continue;
    const hex = c
      .slice(0, 3)
      .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0"))
      .join("");
    const s = `#${hex}`;
    if (!out.includes(s)) out.push(s);
    if (out.length === n) break;
  }
  if (out.length) {
    while (out.length < n) out.push(out[out.length % out.length]);
    return out.slice(0, n);
  }
  const seed = hash(show.id || show.name);
  return Array.from({ length: n }, (_, i) => FALLBACK[(seed + i) % FALLBACK.length]);
}
