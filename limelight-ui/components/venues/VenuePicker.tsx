"use client";

import { useState, useEffect } from "react";
import { usePortalStore } from "@/store/portal";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { rigSummary } from "@/lib/profiles";
import * as api from "@/lib/api";
import type { Venue } from "@/lib/types";

interface VenuePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (venue: Venue, layout: string) => void;
}

/**
 * The thing being chosen here is a RIG, not a room.
 *
 * The list used to name venues and their layouts and nothing else, so a room
 * reconfigured twice offered two pills reading "Main stage (placeholder rig)"
 * with nothing to tell them apart, and the one number that matters — what is
 * actually hanging — only appeared on the target line AFTER the choice was
 * made. Every layout now carries its own rig line, and the one already being
 * designed for says so.
 */
export function VenuePicker({ open, onClose, onPick }: VenuePickerProps) {
  const rooms = usePortalStore((s) => s.rooms);
  const setRooms = usePortalStore((s) => s.setRooms);
  /* the whole catalogue of rigs, loaded once by the portal layout */
  const layouts = usePortalStore((s) => s.layouts);
  const room = usePortalStore((s) => s.room);
  const show = usePortalStore((s) => s.show);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    if (rooms.length) return;
    api.venues.search("").then((d) => setRooms(d.venues)).catch(() => {});
  }, [open, rooms.length, setRooms]);

  /* which rig the editor is on right now, so the list can say "you are here" */
  const liveFile = show?.layout || room?.layout;

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
      {/* No second height cap here: the sheet already stops at 80vh, and a list
          capped at 60vh inside it threw away a fifth of the screen and hid the
          last venue below a fold with nothing to say it was there. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.map((v) => (
          <div
            key={v.id}
            className={`px-[var(--spacing-s5)] py-[var(--spacing-s3)] border-b border-solid border-line ${
              v.locked ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-baseline gap-[var(--spacing-s2)]">
              <b className="text-[length:var(--text-md)] font-medium">{v.name}</b>
              {v.locked && (
                <span className="text-[length:var(--text-xs)] text-warn">locked</span>
              )}
            </div>

            <div className="flex flex-col gap-[var(--spacing-s1)] mt-[var(--spacing-s2)]">
              {v.layouts.map((l) => {
                const rig = layouts.find((x) => x.file === l.file);
                /* a rig is only "the one you are on" inside the venue you are
                   on: two venues may list the same layout file */
                const live = v.id === room?.id && l.file === liveFile;
                return (
                  <button
                    key={l.file}
                    type="button"
                    disabled={v.locked}
                    aria-current={live ? "true" : undefined}
                    onClick={() => {
                      if (!v.locked) onPick(v, l.file);
                    }}
                    className={`w-full text-left px-[var(--spacing-s3)] py-[var(--spacing-s2)] border border-solid rounded-[5px] bg-transparent text-ink transition-colors duration-[var(--dur-state)] ${
                      v.locked
                        ? "border-line cursor-default"
                        : live
                          ? "border-accent bg-accent-soft cursor-pointer"
                          : "border-line cursor-pointer hover:border-line-strong hover:bg-bg-raised"
                    }`}
                  >
                    <div className="flex items-baseline gap-[var(--spacing-s2)]">
                      <span className="text-[length:var(--text-sm)]">{l.name}</span>
                      {live && (
                        <span className="text-[length:var(--text-2xs)] text-accent uppercase tracking-[0.08em]">
                          designing for
                        </span>
                      )}
                      <span className="flex-1" />
                      {(l.placeholder || rig?.placeholder) && (
                        <span className="flex-none text-[length:var(--text-2xs)] text-warn">
                          stand-in rig
                        </span>
                      )}
                      {rig && (
                        <span className="flex-none text-[length:var(--text-2xs)] text-ink-dimmer tabular-nums">
                          {rig.fixtures} fixtures · {rig.channels} channels
                        </span>
                      )}
                    </div>
                    <div className="text-[length:var(--text-xs)] text-ink-dim tabular-nums mt-[2px]">
                      {rig ? rigSummary(rig.kinds) : "rig unavailable"}
                    </div>
                  </button>
                );
              })}
            </div>

            {v.locked && (
              <span className="text-[length:var(--text-xs)] text-warn mt-[var(--spacing-s2)] block">
                {v.locked_because || "locked"}
              </span>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="text-ink-dim text-center py-[var(--spacing-s7)]">No venues found</div>
        )}
      </div>
    </Sheet>
  );
}
