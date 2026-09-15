"use client";

import { useEffect } from "react";

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-[var(--spacing-s5)] bg-[rgba(4,5,8,0.62)]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(680px,100%)] max-h-[78vh] flex flex-col bg-bg-overlay border border-solid border-line-strong rounded-[9px] overflow-hidden"
      >
        <header className="flex-none flex items-center justify-between gap-[var(--spacing-s4)] px-[var(--spacing-s5)] py-[var(--spacing-s4)] border-b border-solid border-line">
          <h2 className="text-[length:var(--text-lg)] font-medium">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-[var(--hit)] h-[var(--hit)] rounded-[5px] bg-transparent border-0 cursor-pointer text-ink-dim hover:text-ink transition-colors duration-[var(--dur-state)]"
          >
            ×
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-[var(--spacing-s5)] py-[var(--spacing-s4)]">
          {children}
        </div>
        {footer && (
          <footer className="flex-none flex justify-end gap-[var(--spacing-s2)] px-[var(--spacing-s5)] py-[var(--spacing-s4)] border-t border-solid border-line">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
