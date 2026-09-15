"use client";

import { useEffect, useRef } from "react";

interface KeyActions {
  onSpace?: () => void;
  onEscape?: () => void;
  onDelete?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
}

/**
 * Global keyboard shortcut handler.
 * Ignores events when the focus is on an input/textarea/select to avoid
 * conflicts with typing.
 */
export function useKeyboardShortcuts(actions: KeyActions) {
  const ref = useRef(actions);

  useEffect(() => {
    ref.current = actions;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          ref.current.onSpace?.();
          break;
        case "Escape":
          ref.current.onEscape?.();
          break;
        case "Delete":
        case "Backspace":
          ref.current.onDelete?.();
          break;
        case "ArrowLeft":
          ref.current.onLeft?.();
          break;
        case "ArrowRight":
          ref.current.onRight?.();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
