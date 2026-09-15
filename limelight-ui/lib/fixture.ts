import type { Effect, Show } from "./types";
import raw from "./fixture.show.json" with { type: "json" };

/* A real bake of `levels` on the club16-2head rig, captured from the baker so
   the editor renders fully without a backend. The API returns this same shape;
   swapping to live data changes no component. */

/** The effect palette, mirroring portal/effects.json. Used until the API supplies it. */
const EFFECTS: Effect[] = [
  { id: "blackout", name: "Blackout", blurb: "The rig goes dark and stays dark.", fx: "blackout", beats: 4, params: { strength: 1 } },
  { id: "cut", name: "Cut", blurb: "The rig drops out for one beat.", fx: "blackout", beats: 1, params: { strength: 1 } },
  { id: "impact", name: "Impact", blurb: "The whole rig, white, on the beat.", fx: "white_blast", beats: 1, params: { strength: 1, tone: "white" } },
  { id: "flash", name: "Flash", blurb: "A white flick on the outer pair only.", fx: "white_blast", beats: 1, params: { strength: 0.9, coverage: "outer", tone: "white" } },
  { id: "stab", name: "Stab", blurb: "A hit on the centre pair, in the song's own colour.", fx: "white_blast", beats: 1, params: { strength: 0.9, coverage: "inner", tone: "key" } },
  { id: "cross", name: "Cross", blurb: "The hit crosses the room, lamp after lamp.", fx: "white_blast", beats: 2, params: { strength: 0.9, shape: "travel", spread: 0.5, tone: "white" } },
  { id: "swell", name: "Swell", blurb: "A wash that blooms and falls away.", fx: "white_blast", beats: 4, params: { strength: 0.85, shape: "swell", tone: "key" } },
  { id: "hush", name: "Hush", blurb: "Levels fall away and the head sinks toward the wall.", fx: "pause", beats: 4, params: { strength: 0.7 } },
  { id: "hook_lift", name: "Hook lift", blurb: "Lifts the whole rig and opens the head's prism.", fx: "hook", beats: 4, params: { strength: 0.9 } },
  { id: "riser", name: "Riser", blurb: "Colour washes toward white across the span.", fx: "whiten", beats: 8, params: { amount: 0.7 } },
  { id: "fill_flicker", name: "Fill flicker", blurb: "The pars strobe on the front of each beat.", fx: "accent_strobe", beats: 4, params: { strength: 0.9 } },
  { id: "exit_dip", name: "Exit dip", blurb: "Level and movement ease back together.", fx: "modulate", beats: 4, params: { gain: 0.7, motion: -0.3 } },
];

export interface Fixture {
  show: Show;
  energy: (number | null)[];
  title: string;
  effects: Effect[];
}

export const FIXTURE: Fixture = {
  show: raw as unknown as Show,
  energy: (raw as { energy: (number | null)[] }).energy,
  title: (raw as { title: string }).title,
  effects: EFFECTS,
};
