import { create } from "zustand";
import type { Edit, Family } from "../lib/types";
import type { View } from "../lib/timeline";
import type { SnapStrength } from "../lib/snap";
import { FIXTURE } from "../lib/fixture.ts";
import { familyOfFx } from "../lib/families.ts";

/* `Edit[]` is the only truth. Everything a timeline draws is derived from it,
   so undo is a stack of whole-list snapshots: edits are small, and snapshotting
   makes every mutation undoable by construction rather than by remembering to
   write an inverse. */

interface EditorState {
  edits: Edit[];
  past: Edit[][];
  future: Edit[][];

  selection: string[];
  view: View;
  snap: SnapStrength;
  bypass: Family[];
  playhead: number;
  playing: boolean;
}

interface EditorActions {
  addEdit: (edit: Edit) => void;
  updateEdit: (index: number, patch: Partial<Edit>) => void;
  removeEdit: (index: number) => void;
  setEdits: (edits: Edit[]) => void;

  undo: () => void;
  redo: () => void;

  select: (keys: string[]) => void;
  addToSelection: (key: string) => void;

  setView: (view: View) => void;
  setSnap: (snap: SnapStrength) => void;
  toggleBypass: (family: Family) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;

  /** What the baker should render: bypassed lanes simply do not send their
   *  edits, so the arranger's own contribution comes back in their place. */
  editsForBake: () => Edit[];

  reset: () => void;
}

const initial: EditorState = {
  edits: [],
  past: [],
  future: [],
  selection: [],
  view: { from: 0, to: FIXTURE.show.duration_s ?? 240 },
  snap: "bar",
  bypass: [],
  playhead: 0,
  playing: false,
};

export const useEditor = create<EditorState & EditorActions>((set, get) => ({
  ...initial,

  addEdit: (edit) =>
    set((s) => ({ past: [...s.past, s.edits], future: [], edits: [...s.edits, edit] })),

  updateEdit: (index, patch) =>
    set((s) => ({
      past: [...s.past, s.edits],
      future: [],
      edits: s.edits.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    })),

  removeEdit: (index) =>
    set((s) => ({
      past: [...s.past, s.edits],
      future: [],
      edits: s.edits.filter((_, i) => i !== index),
      selection: [],
    })),

  setEdits: (edits) => set((s) => ({ past: [...s.past, s.edits], future: [], edits })),

  undo: () =>
    set((s) =>
      s.past.length === 0
        ? s
        : {
            edits: s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [s.edits, ...s.future],
            selection: [],
          },
    ),

  redo: () =>
    set((s) =>
      s.future.length === 0
        ? s
        : {
            edits: s.future[0],
            past: [...s.past, s.edits],
            future: s.future.slice(1),
            selection: [],
          },
    ),

  select: (keys) => set({ selection: keys }),

  /** Clicking an already-selected clip removes it, which is what shift-click means. */
  addToSelection: (key) =>
    set((s) => ({
      selection: s.selection.includes(key)
        ? s.selection.filter((k) => k !== key)
        : [...s.selection, key],
    })),

  setView: (view) => set({ view }),
  setSnap: (snap) => set({ snap }),
  toggleBypass: (family) =>
    set((s) => ({
      bypass: s.bypass.includes(family)
        ? s.bypass.filter((f) => f !== family)
        : [...s.bypass, family],
    })),
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (playing) => set({ playing }),

  editsForBake: () => {
    const { edits, bypass } = get();
    if (bypass.length === 0) return edits;
    const byId = new Map(FIXTURE.effects.map((e) => [e.id, e]));
    return edits.filter((e) => {
      const spec = byId.get(e.type);
      const fam = spec ? familyOfFx(spec.fx) : null;
      return !fam || !bypass.includes(fam);
    });
  },

  reset: () => set({ ...initial }),
}));
