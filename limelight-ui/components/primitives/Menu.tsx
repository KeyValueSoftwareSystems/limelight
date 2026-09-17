"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Turns the item into a toggle: a tick sits in a reserved column so the
   *  labels of checked and unchecked items still line up with each other. */
  checked?: boolean;
}

interface MenuProps {
  trigger: React.ReactNode;
  items: MenuItem[];
  onPick: (id: string) => void;
  align?: "left" | "right";
  /** For a menu of toggles rather than a choice. Closing on every pick would
   *  make turning three guides on three separate trips to the same button. */
  keepOpen?: boolean;
}

export function Menu({ trigger, items, onPick, align = "left", keepOpen = false }: MenuProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  /* The menu is portalled to the body and positioned in viewport coordinates.
     Anchored inside the editor it was clipped: every ancestor between the
     toolbar and the page root is overflow-hidden, so the panel was sliced off
     wherever it crossed one. It also flips above the trigger rather than
     running off the bottom of the window. */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = boxRef.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!t) return;
      const w = p?.width ?? 180;
      const h = p?.height ?? 0;
      const GAP = 4;
      let left = align === "right" ? t.right - w : t.left;
      left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
      const below = t.bottom + GAP;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, t.top - GAP - h) : below;
      setAt({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, items.length]);

  /* Close on an outside pointer or on Escape. Both matter: a menu you cannot
     dismiss without choosing something is a trap. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const el = e.target as Node;
      if (boxRef.current?.contains(el) || panelRef.current?.contains(el)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative inline-block">
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          style={{ position: "fixed", top: at?.top ?? -9999, left: at?.left ?? -9999 }}
          className="liquid z-[120] min-w-[180px] py-[var(--spacing-s1)] rounded-[var(--radius-md)]"
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              disabled={it.disabled}
              onClick={() => {
                if (!keepOpen) setOpen(false);
                onPick(it.id);
              }}
              className={`flex w-full items-baseline justify-between gap-[var(--spacing-s4)] text-left px-[var(--spacing-s3)] py-[var(--spacing-s2)] bg-transparent border-0 cursor-pointer text-[length:var(--text-sm)] transition-colors duration-[var(--dur-state)] disabled:opacity-40 disabled:cursor-default ${
                it.danger ? "text-danger hover:bg-danger/15" : "text-ink hover:bg-bg-raised"
              }`}
            >
              <span className="flex items-baseline gap-[var(--spacing-s2)]">
                {it.checked !== undefined && (
                  <span aria-hidden className="w-[9px] flex-none text-accent">{it.checked ? "\u2713" : ""}</span>
                )}
                {it.label}
              </span>
              {it.hint && <span className="mono text-[length:var(--text-xs)] text-ink-dimmer">{it.hint}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
