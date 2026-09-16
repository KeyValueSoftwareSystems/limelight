"use client";

import { useCallback, type ReactNode } from "react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, onClose, children }: SheetProps) {
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    /* The scrim has to actually put the page away. At 0.42 it did not: the
       sheet's edge sliced the control that opened it clean in half, and the
       surviving half sat on the same line as the sheet's own heading, so
       "Designing for  Desk Rig 1 beam, 4 pa" read as part of "Design for". A
       modal that leaves its own trigger legible underneath is a modal you have
       to read twice. */
    <div
      className="fixed inset-0 z-40 bg-[rgba(10,11,14,0.82)] backdrop-blur-[3px] flex items-start justify-center pt-[7vh] px-[var(--spacing-s5)] pb-[var(--spacing-s5)]"
      onClick={handleBackdrop}
    >
      <div className="w-[min(720px,100%)] max-h-[80vh] flex flex-col bg-bg-raised border border-solid border-line-strong rounded-lg overflow-hidden shadow-[var(--elev-popover)]">
        {children}
      </div>
    </div>
  );
}
