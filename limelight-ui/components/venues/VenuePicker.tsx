"use client";

import { useState, useEffect } from "react";
import { usePortalStore } from "@/store/portal";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import * as api from "@/lib/api";
import type { Venue } from "@/lib/types";

interface VenuePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (venue: Venue, layout: string) => void;
}

export function VenuePicker({ open, onClose, onPick }: VenuePickerProps) {
  const rooms = usePortalStore((s) => s.rooms);
  const setRooms = usePortalStore((s) => s.setRooms);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    if (rooms.length) return;
    api.venues.search("").then((d) => setRooms(d.venues)).catch(() => {});
  }, [open, rooms.length, setRooms]);

  const filtered = rooms.filter((v) =>
    v.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex items-center gap-[var(--spacing-s3)] p-[var(--spacing-s5)] border-b border-solid border-line">
        <div className="label">Design for</div>
        <Input
          placeholder="search venues"
          wide
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto max-h-[60vh]">
        {filtered.map((v) => (
          <div
            key={v.id}
            className={`px-[var(--spacing-s5)] py-[var(--spacing-s3)] border-b border-solid border-line transition-colors ${
              v.locked
                ? "opacity-50 cursor-default"
                : "cursor-pointer hover:bg-accent-soft"
            }`}
          >
            <b className="block text-[length:var(--text-md)] font-medium">{v.name}</b>
            <div className="flex flex-wrap gap-1 mt-1">
              {v.layouts.map((l) => (
                <button
                  key={l.file}
                  type="button"
                  disabled={v.locked}
                  onClick={() => {
                    if (!v.locked) onPick(v, l.file);
                  }}
                  className={`inline-block px-[9px] py-[3px] border border-solid rounded-full text-[length:var(--text-sm)] bg-transparent cursor-pointer ${
                    v.locked
                      ? "border-line text-dimmer cursor-default"
                      : "border-line text-dim hover:border-accent hover:text-accent"
                  }`}
                >
                  {l.name}{l.placeholder ? " (placeholder)" : ""}
                </button>
              ))}
            </div>
            {v.locked && (
              <span className="text-[length:var(--text-xs)] text-warn mt-1 block">
                {v.locked_because || "locked"}
              </span>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="text-dim text-center py-[var(--spacing-s7)]">No venues found</div>
        )}
      </div>
    </Sheet>
  );
}
