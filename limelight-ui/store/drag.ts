import { create } from "zustand";
import type { Effect } from "@/lib/types";

/* The palette and the timeline sit on opposite sides of the screen, so the drag
   between them cannot be owned by either. The palette reports where the pointer
   is; the timeline decides what a drop at that point means, because only it
   knows the view, the grid and the snap setting. */

interface DragState {
  effect: Effect | null;
  /** Picked in the palette, waiting for a click on the timeline. */
  armed: Effect | null;
  x: number;
  y: number;
  /** Registered by the timeline. Returns true if it accepted the drop. */
  onDrop: ((effect: Effect, x: number, y: number) => void) | null;
}

interface DragActions {
  setOnDrop: (fn: DragState["onDrop"]) => void;
  arm: (effect: Effect | null) => void;
  start: (effect: Effect, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => void;
  cancel: () => void;
}

export const useDrag = create<DragState & DragActions>((set, get) => ({
  effect: null,
  armed: null,
  x: 0,
  y: 0,
  onDrop: null,

  setOnDrop: (onDrop) => set({ onDrop }),
  arm: (armed) => set((s) => ({ armed: s.armed?.id === armed?.id ? null : armed })),
  start: (effect, x, y) => set({ effect, x, y, armed: null }),
  move: (x, y) => set({ x, y }),
  end: (x, y) => {
    const { effect, onDrop } = get();
    set({ effect: null });
    if (effect && onDrop) onDrop(effect, x, y);
  },
  cancel: () => set({ effect: null }),
}));

/** Begin a palette drag. Pointer events rather than HTML5 drag: we want a live
 *  bar·beat readout and a snap guide, and the native drag image gives neither. */
export function beginPaletteDrag(effect: Effect, e: React.PointerEvent) {
  e.preventDefault();
  const { start, move, end } = useDrag.getState();
  start(effect, e.clientX, e.clientY);

  const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey);
    end(ev.clientX, ev.clientY);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey);
    useDrag.getState().cancel();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey);
}
