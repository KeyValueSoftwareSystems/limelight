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
    <div
      className="fixed inset-0 z-40 bg-[rgba(20,18,14,0.42)] flex items-start justify-center pt-[7vh] px-[var(--spacing-s5)] pb-[var(--spacing-s5)]"
      onClick={handleBackdrop}
    >
      <div className="w-[min(720px,100%)] max-h-[80vh] flex flex-col bg-bg border border-solid border-line-strong rounded-lg overflow-hidden">
        {children}
      </div>
    </div>
  );
}
