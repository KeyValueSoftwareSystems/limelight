import type { FixtureKind } from "./profiles";

/* ── data models for the Limelight portal API ────────────────────────────── */

export type Role = "creator" | "venue";

/* ── library / songs ─────────────────────────────────────────────────────── */

export interface SongQuality {
  sure: number | null;
  lock: { level: string; says: string } | null;
  tempo_changes: number;
  key: string | null;
  key_confidence: number | null;
  bars: number | null;
  moments: number;
  per_beat: boolean;
  stems: string[];
  stems_absent: string[];
}

export interface Cover {
  state: string;
  file: string | null;
  matched?: { artist: string; track: string };
  why?: string;
}

export interface Section {
  name: string | null;
  start: number;
  end: number;
  phase?: string | null;
}

export interface Song {
  name: string;
  title: string;
  audio: string | null;
  version: number | null;
  bakeable: boolean;
  duration_s: number | null;
  bpm: number | null;
  bars: number | null;
  sections: Section[];
  energy: (number | null)[];
  unavailable: string | null;
  quality?: SongQuality;
  cover?: Cover;
}

export interface SongsResponse {
  hub: string;
  songs: Song[];
}

/* ── show / baking ───────────────────────────────────────────────────────── */

export interface Moment {
  t: number;
  kind: string;
  what?: string;
  weight?: number;
}

export interface Grid {
  bpm: number;
  beats_per_bar?: number;
  first_beat_s?: number;
  first_bar?: number;
  bars?: number;
  sure?: number;
  tempo?: TempoChange[];
}

export interface TempoChange {
  from_beat: number;
  at_s: number;
  bpm: number;
}

export interface Fixture {
  id: string;
  type: string;
  address: number;
  at?: [number, number, number];
}

export interface Show {
  song: string;
  seed: number;
  fps: number;
  channels: number;
  frame_count: number;
  duration_s: number | null;
  tempo: unknown;
  grid: Grid;
  sections: Section[];
  downbeats: number[];
  key_hue: number | null;
  moments: Moment[];
  appetite: number | null;
  appetite_natural: number | null;
  rig: string | null;
  layout: string | null;
  fixtures: Fixture[];
  plan?: ShowPlan;
  pars: number[];
  heads: number[];
}

export interface BakeRequest {
  song: string;
  seed: number;
  edits: Edit[];
  appetite?: number | null;
  layout?: string;
}

export interface BakeResponse {
  job: string;
  state: string;
  song: string;
  seed: number;
  edits: Edit[];
  appetite: number | null;
  layout: string;
  error?: string;
}

export interface ShowStatus {
  state: "baking" | "ready" | "failed";
  song: string;
  seed: number;
  show?: Show;
  applied?: AppliedEdit[];
  frames_url?: string;
  error?: string;
}

/* ── effects / edits ─────────────────────────────────────────────────────── */

/** A dial the creator can turn. Schema 2 describes each one's range. */
export interface EffectDial {
  default?: unknown;
  min?: number;
  max?: number;
}

/** The catalogue moved to schema 2: every effect is a change to ONE dimension
 *  of light (amount, colour, place, rate) and its dials are the interface.
 *  The schema-1 fields are kept optional so older payloads still parse. */
export interface Effect {
  id: string;
  name: string;
  blurb: string;
  kind?: "state" | "gesture" | "binding";
  dimension?: "amount" | "colour" | "place" | "rate";
  dials?: Record<string, EffectDial>;
  default_beats?: number;
  tier?: number;
  /* schema 1 */
  fx?: string;
  beats?: number;
  params?: Record<string, unknown>;
  own?: boolean;
  base?: string;
}

/** How long an effect lasts by default, whichever schema it came from. */
export function effectBeats(e: Effect): number {
  return e.beats ?? e.default_beats ?? 1;
}

/** A creator's placement. `off: true` means "clear the arranger's assignments of
 *  this effect's renderer type across this span and place nothing". */
export interface Edit {
  type: string;
  bar: number;
  beat?: number;
  beats: number;
  params?: Record<string, unknown>;
  off?: true;
  /** The plan id this edit took over from, when it replaces one of the
   *  arranger's assignments. Overlap alone could not carry this: moving your
   *  copy away let the machine's version come back and play underneath it.
   *  The server builds its rows from a field whitelist, so this never leaves
   *  the browser. */
  from?: string;
}

export interface AppliedEdit {
  type: string;
  bar: number;
  beats: number;
  from_s?: number;
  to_s?: number;
  from_frame?: number;
  to_frame?: number;
  hue?: number;
  skipped?: boolean;
}

export interface EffectsResponse {
  effects: Effect[];
  dials: Record<string, string[]>;
  choices: Record<string, string[]>;
  base: Effect[];
  withheld: { id: string; why: string | null }[];
}

/* ── the arranger's own plan, exposed so the page can draw what it wrote ──── */

/** Bars here are in the PAGE's numbering. effects.js converts on the way out. */
export interface PlanPunctuation {
  id: string;
  fx: string;
  bar: number;
  beat: number;
  beats: number;
  params: Record<string, unknown>;
  context: string | null;
}

export interface PlanDynamics {
  bar: number;
  beats: number;
  gain: number;
  motion: number;
  doing: string | null;
}

export interface PlanLook {
  section: number;
  par: string | null;
  head: string | null;
}

export interface ShowPlan {
  punctuation: PlanPunctuation[];
  dynamics: PlanDynamics[];
  looks: PlanLook[];
}

/* ── lanes and clips (derived on the client, never persisted) ────────────── */

export type Family =
  | "hits" | "darkness" | "strobe" | "lift" | "breath" | "wash" | "dynamics";

/** `tile` and `fx` are separate on purpose. A clip a person placed knows both its
 *  palette tile (`stab`) and its renderer type (`white_blast`); one the arranger
 *  wrote only ever has the renderer type, because it was never a tile. */
export interface Clip {
  key: string;
  source: "auto" | "mine";
  editIndex: number | null;
  planId: string | null;
  family: Family;
  tile: string | null;
  fx: string;
  name: string;
  bar: number;
  beat: number;
  beats: number;
  startS: number;
  endS: number;
  params: Record<string, unknown>;
  overridden: boolean;
}

/* ── saved shows ─────────────────────────────────────────────────────────── */

export interface ShowFile {
  id: string;
  file: string;
  version: number;
  author: string;
  name: string;
  song: string;
  seed: number;
  edits: Edit[];
  created?: string;
  updated?: string;
  appetite?: number;
  score_version?: number | null;
  designed_for?: { venue_id: string; venue_name: string; layout?: string } | null;
  invalid?: string;
}

export interface ShowsResponse {
  shows: ShowFile[];
}

export interface SaveShowRequest {
  id?: string | null;
  song: string;
  seed: number;
  edits: Edit[];
  name: string;
  author: string;
  appetite?: number | null;
  score_version?: number | null;
  designed_for?: { venue_id: string; venue_name: string; layout?: string } | null;
}

/* ── venues / layouts ────────────────────────────────────────────────────── */

export interface VenueLayout {
  file: string;
  name: string;
  placeholder?: boolean;
}

export interface Venue {
  id: string;
  name: string;
  layouts: VenueLayout[];
  locked: boolean;
  locked_because?: string;
  logo_url: string | null;
  default: string;
  example?: boolean;
  rig_placeholder?: boolean;
  rig_placeholder_note?: string;
  note?: string;
  access?: string;
}

export interface VenuesResponse {
  venues: Venue[];
  default: string | null;
  layouts?: Layout[];
}

export interface LayoutProfile {
  footprint: number;
  can: string[];
  beam?: { angle_deg?: number; field_deg?: number; type?: string };
  cells?: number;
  /** no real fixture stands behind this channel map */
  invented?: boolean;
  /** the GDTF file the profile was read from, where there is one */
  gdtf?: string;
}

export interface Layout {
  file: string;
  rig: string;
  fixtures: number;
  kinds: Record<string, number>;
  channels: number;
  geometry?: unknown;
  note?: string;
  placeholder?: boolean;
  default?: boolean;
  /** every lamp and where it hangs, so the page can draw the rig */
  fixture_list?: Fixture[];
  /** what each device type in this rig can do */
  profiles?: Record<string, LayoutProfile>;
}

export interface LayoutsResponse {
  layouts: Layout[];
  default: string;
}

export interface VenueRoom {
  id: string;
  name: string;
  layout: string;
  example?: boolean;
}

/* ── rig ─────────────────────────────────────────────────────────────────── */

export interface TrimState {
  master: number;
  par: number;
  head: number;
  blackout: boolean;
  strobe_kill: boolean;
  hold: boolean;
}

export interface RigStatus {
  can_send: boolean;
  why_not: string | null;
  route_via: string | null;
  route_ok: boolean;
  gateway: string;
  universe: number;
  armed: boolean;
  sending: boolean;
  frames_sent: number;
  park_frames_sent: number;
  last_index: number | null;
  last_error: string | null;
  last_send_ok_ms: number | null;
  anchor_age_ms: number | null;
  loaded: boolean;
  swaps: number;
  pending: number | null;
  trim: TrimState;
  show_id: string | null;
  rigmap: { channels: number; pars: number; heads: number; fixtures: number };
  limits: LimitsSummary;
  conflict: string | null;
}

/* ── limits ──────────────────────────────────────────────────────────────── */

export interface LimitsSummary {
  venue?: string;
  max_intensity: { par: number; head: number };
  strobe: { allowed: boolean; max: number };
  keep_out: { name: string; from: number; to: number }[];
  max_rate: { intensity_up_per_frame: number | null; pan_per_frame: number | null; tilt_per_frame: number | null };
  frames_clamped?: number;
}

/* ── marketplace ─────────────────────────────────────────────────────────── */

export interface Telemetry {
  measured: boolean;
  example?: boolean;
  plays?: number;
  took_control?: number;
  pulled_master?: number;
  blackout?: number;
  seconds?: number;
  note?: string;
}

export interface MarketListing {
  show_id: string;
  show: {
    id: string;
    name: string;
    author: string;
    song: string;
    seed: number;
    version: number;
    edits: Edit[];
    updated?: string;
  };
  kind: string;
  tier: string;
  blurb: string;
  cuts?: { title: string; artist?: string; at?: number }[];
  cuts_source?: string;
  stand_in?: boolean;
  telemetry: Telemetry;
  example?: boolean;
  example_note?: string;
  listed?: string;
}

export interface MarketResponse {
  listings: MarketListing[];
  tiers: Record<string, { label: string; perform: number }>;
  transacting: boolean;
  note: string;
}

export interface ListShowRequest {
  show_id: string;
  tier: string;
  blurb: string;
}

/* ── entitlement ─────────────────────────────────────────────────────────── */

export interface Entitlement {
  ok: boolean;
  stub: boolean;
  show_id: string;
  tier: string;
  why: string;
}

/* ── colours ─────────────────────────────────────────────────────────────── */

export interface ColourSwatch {
  name: string;
  hex: string;
}

export interface Personality {
  user: string;
  colours: ColourSwatch[];
}

export interface ColoursResponse {
  colours: ColourSwatch[];
  personalities: Personality[];
}

/* ── fixture placement (computed on the client) ──────────────────────────── */

/** Where a lamp sits on screen, and what kind of thing it is. */
export interface LampPosition {
  addr: number;
  id: string;
  /** the device type, e.g. "spot29" — see lib/profiles.ts */
  type: string;
  kind: FixtureKind;
  /** normalised screen position, 0–1 */
  x: number;
  y: number;
  /** 0 = furthest from the audience, 1 = nearest */
  depth: number;
  /** 0 = floor, 1 = highest trim on this rig */
  height: number;
  /** size multiplier from depth */
  scale: number;
}

/** A lamp's state in one frame. */
export interface LampState extends LampPosition {
  /** intensity, 0–1, gamma undone */
  k: number;
  rgb: [number, number, number];
  /** 0 = shutter simply open, >0 = strobing at that rate */
  strobe: number;
  /** beam width in degrees, honouring a zoom channel where fitted */
  spreadDeg: number;
  gobo: number;
  prism: boolean;
  /** beam direction on screen (movers only) */
  rot: number;
  reach: number;
  az: number;
  el: number;
  /** per-cell state on a pixel device */
  cells?: Array<{ k: number; rgb: [number, number, number] }>;
}

export interface FixturePlacement {
  /** every lamp, sorted back-to-front */
  lamps: LampPosition[];
  /** views over `lamps`, kept for the panels that ask by these names */
  pars: LampPosition[];
  heads: LampPosition[];
}

/* `ParState` and `HeadState` are the old names for what is now one lamp state.
   Kept as aliases so the panels and the marketplace preview keep compiling. */
export type ParState = LampState;
export type HeadState = LampState;

export interface FixtureStates {
  lamps: LampState[];
  pars: ParState[];
  heads: HeadState[];
  head: HeadState | null;
}
