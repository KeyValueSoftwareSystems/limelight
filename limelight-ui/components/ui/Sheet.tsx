"use client";

import { useCallback, type ReactNode } from "react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** widen the panel for content that benefits from more horizontal room */
  wide?: boolean;
}

export function Sheet({ open, onClose, children, wide }: SheetProps) {
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
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[7vh] px-[20px] pb-[20px]"
      style={{ background: "rgba(2,3,8,0.72)", backdropFilter: "blur(6px)" }}
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
    >
      <div className={`liquid ${wide ? "w-[min(960px,100%)]" : "w-[min(760px,100%)]"} max-h-[82vh] flex flex-col rounded-[var(--radius-xl)] overflow-hidden animate-scale-in`}>
        {children}
      </div>
    </div>
  );
}
