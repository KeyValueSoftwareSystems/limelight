"use client";

import { useState, useEffect } from "react";
import { usePortalStore } from "@/store/portal";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { RigPreview } from "./RigPreview";
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
      <div className="flex-none px-[22px] pt-[20px] pb-[14px]">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em] m-0 text-ink leading-[1.2]">
          Design for
        </h2>
        <p className="text-[13px] text-ink-dim mt-[5px] mb-[14px]">
          Pick the room, and the rig in it, that this show is built for.
        </p>
        <Input
          placeholder="Search rooms and rigs"
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
            className={`px-[22px] py-[14px] border-b border-solid border-[var(--edge)] ${
              v.locked ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-baseline gap-[var(--spacing-s2)]">
              <b className="text-[14px] font-semibold tracking-[-0.012em] text-ink">{v.name}</b>
              {v.locked && (
                <span className="liquid-well px-[7px] py-[2px] rounded-full text-[10.5px] text-warn leading-[15px]">Locked</span>
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
                    className={`w-full text-left px-[11px] py-[9px] rounded-[var(--radius-sm)] text-ink border-0 transition-colors duration-[var(--dur-state)] ${
                      v.locked
                        ? "cursor-default opacity-55"
                        : live
                          ? "liquid liquid-key cursor-pointer"
                          : "cursor-pointer hover:bg-white/[0.045]"
                    }`}
                  >
                    <div className="flex items-center gap-[10px]">
                    <RigPreview
                      fixtures={rig?.fixture_list ?? []}
                      dimmed={v.locked}
                      className="w-[58px] h-[34px] rounded-[4px] flex-none"
                    />
                    <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-[var(--spacing-s2)]">
                      <span className="text-[13px] font-medium">{l.name}</span>
                      {live && (
                        <span className="text-[10.5px] text-ink-dim">
                          Designing for
                        </span>
                      )}
                      <span className="flex-1" />
                      {(l.placeholder || rig?.placeholder) && (
                        <span className="flex-none text-[10.5px] text-warn">
                          stand-in rig
                        </span>
                      )}
                      {rig && (
                        <span className="mono flex-none text-[10.5px] text-ink-dimmer tabular-nums">
                          {rig.fixtures} fixtures · {rig.channels} channels
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-ink-dim tabular-nums mt-[3px]">
                      {rig ? rigSummary(rig.kinds) : "Rig unavailable"}
                    </div>
                    </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {v.locked && (
              <span className="text-[11.5px] text-warn mt-[8px] block leading-[1.5]">
                {v.locked_because || "locked"}
              </span>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="text-[13px] text-ink-dim text-center py-[40px]">No rooms match that search.</div>
        )}
      </div>
    </Sheet>
  );
}
