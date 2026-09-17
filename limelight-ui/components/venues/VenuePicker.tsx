"use client";

import { useState, useEffect, useMemo } from "react";
import { usePortalStore } from "@/store/portal";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { CardTag } from "@/components/ui/MediaCard";
import { RigPreview } from "./RigPreview";
import { rigSummary } from "@/lib/profiles";
import * as api from "@/lib/api";
import type { Venue, Layout } from "@/lib/types";

interface VenuePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (venue: Venue, layout: string) => void;
}

/**
 * Visual venue/rig picker.
 *
 * Each room is a full-width row: a live rig preview on the left, room name and
 * rig info on the right. When a room has several rigs, pill tabs switch the
 * preview — the same interaction as VenueCard on the Venues page. The row
 * layout fills the sheet width naturally and makes every venue an obvious,
 * generously-sized click target.
 */
export function VenuePicker({ open, onClose, onPick }: VenuePickerProps) {
  const rooms = usePortalStore((s) => s.rooms);
  const setRooms = usePortalStore((s) => s.setRooms);
  const layouts = usePortalStore((s) => s.layouts);
  const room = usePortalStore((s) => s.room);
  const show = usePortalStore((s) => s.show);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    if (rooms.length) return;
    api.venues.search("").then((d) => setRooms(d.venues)).catch(() => {});
  }, [open, rooms.length, setRooms]);

  const liveFile = show?.layout || room?.layout;

  const filtered = useMemo(
    () =>
      rooms.filter((v) => {
        if (!q) return true;
        const lq = q.toLowerCase();
        if (v.name.toLowerCase().includes(lq)) return true;
        return v.layouts.some((l) => l.name.toLowerCase().includes(lq));
      }),
    [rooms, q],
  );

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex-none px-[22px] pt-[20px] pb-[14px]">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] m-0 text-ink leading-[1.2]">
          Design for
        </h2>
        <p className="text-[12.5px] text-ink-dim mt-[4px] mb-[12px] leading-[1.3]">
          Pick the room and rig this show is built for.
        </p>
        <Input
          placeholder="Search rooms and rigs"
          wide
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-[2px] pb-[8px]">
          {filtered.map((v, i) => (
            <VenueRow
              key={v.id}
              venue={v}
              layouts={layouts}
              liveFile={liveFile}
              isLiveVenue={v.id === room?.id}
              onPick={onPick}
              delay={Math.min(i * 40, 320)}
            />
          ))}
        </div>

        {!filtered.length && (
          <div className="flex flex-col items-center justify-center py-[56px]">
            <p className="text-[14px] font-semibold text-ink m-0">
              No rooms match &ldquo;{q}&rdquo;
            </p>
            <p className="text-[12.5px] text-ink-dim mt-[4px] m-0">
              Try a different name.
            </p>
            <button
              type="button"
              onClick={() => setQ("")}
              className="mt-[10px] text-[12.5px] text-ink border-0 bg-transparent cursor-pointer hover:underline font-medium p-0"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ── one venue row ───────────────────────────────────────────────────────── */

function VenueRow({
  venue,
  layouts,
  liveFile,
  isLiveVenue,
  onPick,
  delay,
}: {
  venue: Venue;
  layouts: Layout[];
  liveFile: string | undefined;
  isLiveVenue: boolean;
  onPick: (venue: Venue, layout: string) => void;
  delay: number;
}) {
  const [chosen, setChosen] = useState(venue.default);
  const locked = venue.locked;
  const rig = layouts.find((l) => l.file === chosen);
  const live = isLiveVenue && chosen === liveFile;
  const many = venue.layouts.length > 1;
  const clickable = !locked;

  return (
    <article
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-disabled={locked || undefined}
      aria-current={live ? "true" : undefined}
      onClick={() => { if (clickable) onPick(venue, chosen); }}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onPick(venue, chosen);
        }
      }}
      title={locked ? venue.locked_because ?? "This rig is not open to you" : `Design for ${venue.name}`}
      className={`group flex items-stretch gap-0 mx-[10px] rounded-[var(--radius-md)] overflow-hidden transition-all duration-[var(--dur-state)] animate-in ${
        locked
          ? "opacity-55 cursor-default"
          : live
            ? "bg-[var(--surface-2)] cursor-pointer hover:bg-[var(--surface-3)]"
            : "cursor-pointer hover:bg-[var(--surface-1)]"
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* rig preview */}
      <div className="relative flex-none w-[168px] overflow-hidden rounded-l-[var(--radius-md)]">
        <div className="absolute inset-0">
          <RigPreview
            fixtures={rig?.fixture_list ?? []}
            dimmed={locked}
            className="absolute inset-0"
          />
        </div>
        {/* hover dim */}
        {clickable && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-150" />
        )}
      </div>

      {/* info */}
      <div className="flex-1 min-w-0 py-[12px] px-[16px] flex flex-col justify-center gap-[4px]">
        {/* name row */}
        <div className="flex items-center gap-[8px] min-w-0">
          <span className="text-[14px] font-semibold tracking-[-0.012em] text-ink truncate">
            {venue.name}
          </span>
          {live && (
            <span
              className="flex-none px-[7px] py-[1px] rounded-full text-[10px] font-medium leading-[14px]"
              style={{ background: "rgba(59,227,255,0.12)", color: "var(--accent)" }}
            >
              Current
            </span>
          )}
          {locked && (
            <span className="flex-none text-[10.5px] text-warn">Locked</span>
          )}
        </div>

        {/* rig stats */}
        <div className="flex items-baseline gap-[6px] min-w-0">
          <span className="mono text-[11px] text-ink-dim tabular-nums truncate">
            {rig
              ? `${rig.fixtures} fixtures · ${rig.channels} channels`
              : "Rig unavailable"}
          </span>
        </div>

        {/* rig summary */}
        <span className="text-[11px] text-ink-dimmer truncate">
          {rig ? rigSummary(rig.kinds) : ""}
        </span>

        {/* layout pills / tags */}
        <div className="flex items-center gap-[5px] flex-wrap mt-[2px]">
          {many
            ? venue.layouts.map((l) => (
                <CardTag
                  key={l.file}
                  on={l.file === chosen}
                  onClick={() => setChosen(l.file)}
                  hint={`Preview the ${l.name} rig`}
                >
                  {l.name}
                </CardTag>
              ))
            : (
              <CardTag>{venue.layouts[0]?.name ?? "—"}</CardTag>
            )}
          {(rig?.placeholder || venue.rig_placeholder) && (
            <CardTag tone="warn">Stand-in</CardTag>
          )}
        </div>

        {locked && venue.locked_because && (
          <span className="text-[10.5px] text-warn leading-[1.4] mt-[2px]">
            {venue.locked_because}
          </span>
        )}
      </div>
    </article>
  );
}
