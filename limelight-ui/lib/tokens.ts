import type { Family } from "./types";

/* A component never hardcodes a colour. It names what a thing IS — a lane
   family, a song phase — and gets back the variable that carries the hue. */

export const FAMILY_VAR: Record<Family, string> = {
  hits: "--fam-hits",
  darkness: "--fam-darkness",
  strobe: "--fam-strobe",
  lift: "--fam-lift",
  breath: "--fam-breath",
  wash: "--fam-wash",
  dynamics: "--fam-dynamics",
};

export function familyHue(family: Family): string {
  return `var(${FAMILY_VAR[family]})`;
}

/* Section bands tint from the score's own phase context, at low chroma, so
   structure reads as background while clips stay foreground. */
export const PHASE_VAR: Record<string, string> = {
  intro: "--phase-intro",
  drop: "--phase-drop",
  silence: "--phase-silence",
  break: "--phase-break",
  verse: "--phase-verse",
  build: "--phase-build",
  final_drop: "--phase-final-drop",
  outro: "--phase-outro",
};

/** A score may name a phase we have no tint for; that is not an error. */
export function phaseTint(phase: string | null | undefined): string {
  const v = phase ? PHASE_VAR[phase] : undefined;
  return `var(${v ?? "--phase-unknown"})`;
}
