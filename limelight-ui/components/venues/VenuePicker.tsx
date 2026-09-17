"use client";

import { useState, useEffect } from "react";
import { usePortalStore } from "@/store/portal";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { MediaCard, CardTag } from "@/components/ui/MediaCard";
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
 * Shows the same card the Venues page draws — live rig preview, title, channel
 * count, rig summary, layout pills — inside a Sheet. The creator picks by
 * sight rather than by reading channel numbers. Delegates every card to
 * MediaCard so spacing, hover states and elevation track the design system
 * automatically. Uses the project's `card-grid` class for consistent column
 * sizing and gap.
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
    api.venues
      .search("")
      .then((d) => setRooms(d.venues))
      .catch(() => {});
  }, [open, rooms.length, setRooms]);

  const liveFile = show?.layout || room?.layout;

  const filtered = rooms.filter((v) =>
    v.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Sheet open={open} onClose={onClose} wide>
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

      <div className="flex-1 min-h-0 overflow-y-auto px-[22px] pb-[22px]">
        {filtered.length > 0 && (
          <div className="card-grid pt-[4px]">
            {filtered.map((v, i) => (
              <div
                key={v.id}
                className="animate-in h-full"
                style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
              >
                <PickerCard
                  venue={v}
                  layouts={layouts}
                  liveFile={liveFile}
                  isLiveVenue={v.id === room?.id}
                  onPick={onPick}
                />
              </div>
            ))}
          </div>
        )}

        {!filtered.length && (
          <div className="flex flex-col items-center justify-center py-[76px]">
            <p className="text-[15px] font-semibold text-ink m-0">
              No rooms match &ldquo;{q}&rdquo;
            </p>
            <p className="text-[13px] text-ink-dim mt-[6px] m-0">
              Try a different name.
            </p>
            <button
              type="button"
              onClick={() => setQ("")}
              className="mt-[14px] text-[13px] text-ink border-0 bg-transparent cursor-pointer hover:underline font-medium p-0"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ── one card inside the picker ──────────────────────────────────────────── */

function PickerCard({
  venue,
  layouts,
  liveFile,
  isLiveVenue,
  onPick,
}: {
  venue: Venue;
  layouts: Layout[];
  liveFile: string | undefined;
  isLiveVenue: boolean;
  onPick: (venue: Venue, layout: string) => void;
}) {
  const [chosen, setChosen] = useState(venue.default);
  const locked = venue.locked;
  const rig = layouts.find((l) => l.file === chosen);
  const live = isLiveVenue && chosen === liveFile;
  const many = venue.layouts.length > 1;

  return (
    <MediaCard
      title={venue.name}
      hint={
        locked
          ? (venue.locked_because ?? "This rig is not open to you")
          : `Design for ${venue.name}`
      }
      disabled={locked}
      onOpen={() => onPick(venue, chosen)}
      media={
        <>
          <RigPreview
            fixtures={rig?.fixture_list ?? []}
            dimmed={locked}
            className="absolute inset-0"
          />
          {venue.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${api.BASE}${venue.logo_url}`}
              alt=""
              className="absolute left-[10px] top-[10px] h-[16px] w-auto max-w-[70px] object-contain opacity-75"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
        </>
      }
      overlay={
        live ? (
          <span
            className="absolute top-[8px] right-[8px] px-[8px] py-[3px] rounded-full text-[10.5px] font-medium leading-[15px]"
            style={{
              background: "rgba(236,238,246,0.12)",
              backdropFilter: "blur(8px)",
              color: "var(--accent)",
            }}
          >
            Designing for
          </span>
        ) : undefined
      }
      meta={
        rig
          ? `${rig.fixtures} fixtures · ${rig.channels} channels`
          : "Rig unavailable"
      }
      body={rig ? rigSummary(rig.kinds) : undefined}
      tags={
        <>
          {locked && <CardTag tone="warn">Locked</CardTag>}
          {many ? (
            venue.layouts.map((l) => (
              <CardTag
                key={l.file}
                on={l.file === chosen}
                onClick={() => setChosen(l.file)}
                hint={`Preview the ${l.name} rig`}
              >
                {l.name}
              </CardTag>
            ))
          ) : (
            <CardTag>{venue.layouts[0]?.name ?? "—"}</CardTag>
          )}
          {(rig?.placeholder || venue.rig_placeholder) && (
            <CardTag
              tone="warn"
              hint="The channel map behind this rig is invented. Every other device here was read from a real fixture definition."
            >
              Stand-in rig
            </CardTag>
          )}
        </>
      }
      footer={
        locked
          ? "Access is granted by the venue"
          : `${venue.layouts.length} rig${venue.layouts.length === 1 ? "" : "s"}`
      }
    />
  );
}
