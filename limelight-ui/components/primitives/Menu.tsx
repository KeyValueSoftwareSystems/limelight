"use client";

import { useEffect, useRef, useState } from "react";

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

  /* Close on an outside pointer or on Escape. Both matter: a menu you cannot
     dismiss without choosing something is a trap. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
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
      {open && (
        <div
          role="menu"
          style={{ boxShadow: "var(--elev-popover)" }}
          className={`absolute top-[calc(100%+4px)] z-50 min-w-[180px] py-[var(--spacing-s1)] bg-bg-overlay border border-solid border-line-strong rounded-[7px] ${
            align === "right" ? "right-0" : "left-0"
          }`}
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
        </div>
      )}
    </div>
  );
}
