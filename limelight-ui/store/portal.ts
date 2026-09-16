import { create } from "zustand";
import type {
  Role,
  Song,
  Show,
  Edit,
  AppliedEdit,
  Effect,
  RigStatus,
  LimitsSummary,
  MarketListing,
  Layout,
  PaletteColour,
  FixturePlacement,
  Venue,
  VenueRoom,
  TrimState,
  ShowFile,
  Entitlement,
  V2PlanDoc,
} from "@/lib/types";

/* ── state shape ─────────────────────────────────────────────────────────── */

export interface PortalState {
  /* identity */
  role: Role;
  screen: string | null;
  author: string;

  /* library */
  songs: Song[];
  song: Song | null;

  /* show / bake */
  show: Show | null;
  frames: Uint8Array | null;
  seed: number;
  edits: Edit[];
  applied: AppliedEdit[];
  job: string | null;
  showId: string | null;
  showVersion: number | null;

  /* v2 plan pipeline: when a plan is imported the edits are translated from it
     and bakes go through the portal baker (/api/bake-plan) instead of the legacy
     seed+edits bake. planText is the composer's one-line summary, carried through. */
  v2: boolean;
  planText: string;
  /* A plan handed over by the Shows list, to be baked instead of the song's own
     show file. Opening a saved show restored its edits and then the per-song
     show file loaded over the top of them, so the show you opened was not the
     show you got. Whoever consumes this clears it. */
  pendingPlan: V2PlanDoc | null;

  /* venue mode */
  venue: ShowFile | null;
  entitlement: Entitlement | null;

  /* stage */
  secIndex: number;
  place: FixturePlacement | null;
  view: { from: number; to: number } | null;
  follow: boolean;

  /* appetite */
  want: number | null;
  natural: number | null;
  swapping: boolean;

  /* effects */
  effects: Effect[];
  arm: string | null;
  sel: number;

  /* rig */
  rig: RigStatus | null;
  trims: TrimState;
  /* Seconds the LIGHTS wait for the SOUND. `audio.currentTime` is the decoder's
     position, not what has left the speakers, so without this the preview runs
     ahead of the music by the output buffer. Auto-detected from the audio
     device; `syncNudge` is the person's correction on top, because a device's
     reported latency and its real one are not always the same thing. */
  syncLatency: number;
  syncNudge: number;

  /* venue / layout */
  limits: LimitsSummary | null;
  layout: string | null;
  layouts: Layout[];
  room: VenueRoom | null;
  rooms: Venue[];

  /* marketplace */
  market: MarketListing[];

  /* colours */
  colours: string[];

  /* The colours this show is spending, and the set it was opened with. The
     baseline is what `reset` returns to: a show declares its palette once it
     has been recoloured, and before that lib/palette.ts derives one from the
     colours its cues already use. */
  palette: PaletteColour[];
  paletteBase: PaletteColour[];
}

/* ── actions ─────────────────────────────────────────────────────────────── */

export interface PortalActions {
  setRole: (role: Role) => void;
  setScreen: (screen: string | null) => void;
  setAuthor: (author: string) => void;
  setSongs: (songs: Song[]) => void;
  setSong: (song: Song | null) => void;
  setShow: (show: Show | null) => void;
  setFrames: (frames: Uint8Array | null) => void;
  setSeed: (seed: number) => void;
  setEdits: (edits: Edit[]) => void;
  addEdit: (edit: Edit) => void;
  removeEdit: (index: number) => void;
  updateEdit: (index: number, edit: Partial<Edit>) => void;
  setApplied: (applied: AppliedEdit[]) => void;
  setJob: (job: string | null) => void;
  setShowId: (id: string | null) => void;
  setShowVersion: (v: number | null) => void;
  setV2: (v: boolean) => void;
  setPlanText: (t: string) => void;
  setPendingPlan: (p: V2PlanDoc | null) => void;
  setVenue: (venue: ShowFile | null) => void;
  setEntitlement: (e: Entitlement | null) => void;
  setSecIndex: (i: number) => void;
  setPlace: (place: FixturePlacement | null) => void;
  setView: (view: { from: number; to: number } | null) => void;
  setFollow: (f: boolean) => void;
  setWant: (w: number | null) => void;
  setNatural: (n: number | null) => void;
  setSwapping: (s: boolean) => void;
  setEffects: (effects: Effect[]) => void;
  setArm: (id: string | null) => void;
  setSel: (i: number) => void;
  setRig: (rig: RigStatus | null) => void;
  setTrims: (trims: Partial<TrimState>) => void;
  setSyncLatency: (s: number) => void;
  setSyncNudge: (s: number) => void;
  setLimits: (limits: LimitsSummary | null) => void;
  setLayout: (layout: string | null) => void;
  setLayouts: (layouts: Layout[]) => void;
  setRoom: (room: VenueRoom | null) => void;
  setRooms: (rooms: Venue[]) => void;
  setMarket: (market: MarketListing[]) => void;
  setColours: (colours: string[]) => void;
  setPalette: (palette: PaletteColour[]) => void;
  setPaletteBase: (paletteBase: PaletteColour[]) => void;

  /* compound actions */
  resetForShow: () => void;
}

/* ── initial state ───────────────────────────────────────────────────────── */

const initialTrims: TrimState = {
  master: 1,
  par: 1,
  head: 1,
  blackout: false,
  strobe_kill: false,
  hold: false,
};

/* ── store ───────────────────────────────────────────────────────────────── */

export const usePortalStore = create<PortalState & PortalActions>((set) => ({
  /* state */
  role: "creator",
  screen: null,
  author: typeof window !== "undefined" ? localStorage.getItem("ll.author") ?? "" : "",
  songs: [],
  song: null,
  show: null,
  frames: null,
  seed: 1,
  edits: [],
  applied: [],
  job: null,
  showId: null,
  showVersion: null,
  v2: false,
  planText: "",
  pendingPlan: null,
  venue: null,
  entitlement: null,
  secIndex: -1,
  place: null,
  view: null,
  follow: true,
  want: null,
  natural: null,
  swapping: false,
  effects: [],
  arm: null,
  sel: -1,
  rig: null,
  trims: { ...initialTrims },
  syncLatency: 0,
  syncNudge: 0,
  limits: null,
  layout: null,
  layouts: [],
  room: null,
  rooms: [],
  market: [],
  colours: [],
  palette: [],
  paletteBase: [],

  /* actions */
  setRole: (role) => set({ role }),
  setScreen: (screen) => set({ screen }),
  setAuthor: (author) => {
    try { localStorage.setItem("ll.author", author); } catch { /* noop */ }
    set({ author });
  },
  setSongs: (songs) => set({ songs }),
  setSong: (song) => set({ song }),
  setShow: (show) => set({ show }),
  setFrames: (frames) => set({ frames }),
  setSeed: (seed) => set({ seed }),
  setEdits: (edits) => set({ edits }),
  addEdit: (edit) => set((s) => ({ edits: [...s.edits, edit], sel: s.edits.length })),
  removeEdit: (index) =>
    set((s) => ({
      edits: s.edits.filter((_, i) => i !== index),
      sel: -1,
    })),
  updateEdit: (index, edit) =>
    set((s) => ({
      edits: s.edits.map((e, i) => (i === index ? { ...e, ...edit } : e)),
    })),
  setApplied: (applied) => set({ applied }),
  setJob: (job) => set({ job }),
  setShowId: (showId) => set({ showId }),
  setShowVersion: (showVersion) => set({ showVersion }),
  setV2: (v2) => set({ v2 }),
  setPlanText: (planText) => set({ planText }),
  setPendingPlan: (pendingPlan) => set({ pendingPlan }),
  setVenue: (venue) => set({ venue }),
  setEntitlement: (entitlement) => set({ entitlement }),
  setSecIndex: (secIndex) => set({ secIndex }),
  setPlace: (place) => set({ place }),
  setView: (view) => set({ view }),
  setFollow: (follow) => set({ follow }),
  setWant: (want) => set({ want }),
  setNatural: (natural) => set({ natural }),
  setSwapping: (swapping) => set({ swapping }),
  setEffects: (effects) => set({ effects }),
  setArm: (arm) => set({ arm }),
  setSel: (sel) => set({ sel }),
  setRig: (rig) => set({ rig }),
  setSyncLatency: (syncLatency) => set({ syncLatency }),
  setSyncNudge: (syncNudge) => set({ syncNudge }),
  setTrims: (patch) => set((s) => ({ trims: { ...s.trims, ...patch } })),
  setLimits: (limits) => set({ limits }),
  setLayout: (layout) => set({ layout }),
  setLayouts: (layouts) => set({ layouts }),
  setRoom: (room) => set({ room }),
  setRooms: (rooms) => set({ rooms }),
  setMarket: (market) => set({ market }),
  setColours: (colours) => set({ colours }),
  setPalette: (palette) => set({ palette }),
  setPaletteBase: (paletteBase) => set({ paletteBase }),

  /* Called before opening anything — a song from the library, a show from the
     list. Both callers set what they know straight after, so everything cleared
     here is something the NEXT thing opened must not inherit from the last one.
     showId is the sharpest of those: left standing, opening a fresh song from
     the library and saving it wrote a new version over whichever saved show
     happened to be open before it. */
  resetForShow: () =>
    set({
      show: null,
      frames: null,
      secIndex: -1,
      sel: -1,
      view: null,
      applied: [],
      swapping: false,
      showId: null,
      showVersion: null,
      v2: false,
      planText: "",
      pendingPlan: null,
    }),
}));
