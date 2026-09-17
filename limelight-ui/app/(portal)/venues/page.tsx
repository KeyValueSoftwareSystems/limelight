"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { VenueCard } from "@/components/venues/VenueCard";
import { CardSkeleton } from "@/components/ui";
import { NewShowDialog } from "@/components/shows/NewShowDialog";
import { Field, SegmentedControl } from "@/components/ui";
import { Search } from "lucide-react";
import type { Venue, Layout } from "@/lib/types";

type Filter = "all" | "open" | "locked";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open to you" },
  { id: "locked", label: "Locked" },
];

export default function VenuesPage() {
  const rooms = usePortalStore((s) => s.rooms);
  const setRooms = usePortalStore((s) => s.setRooms);
  const setRoom = usePortalStore((s) => s.setRoom);
  const setLayout = usePortalStore((s) => s.setLayout);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState<{ venue: string; layout: string } | null>(null);
  const songs = usePortalStore((s) => s.songs);
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setEdits = usePortalStore((s) => s.setEdits);
  const setWant = usePortalStore((s) => s.setWant);
  const setSetlist = usePortalStore((s) => s.setSetlist);
  const resetForShow = usePortalStore((s) => s.resetForShow);
  const router = useRouter();

  useEffect(() => {
    let live = true;
    api.venues
      .search(q)
      .then((d) => {
        if (!live) return;
        setRooms(d.venues);
        /* the rigs arrive with the catalogue, so a card can draw its room without
           a second round trip per venue */
        if (d.layouts) {
          setLayouts(Object.fromEntries(d.layouts.map((l) => [l.file, l])));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { live = false; };
  }, [q, setRooms]);

  /* Designing for a room starts the same way designing anything does: by
     choosing the songs. The room is already decided, so the picker opens here
     rather than bouncing through the shows index. */
  const handleDesign = useCallback(
    (venue: Venue, layoutFile: string) => {
      setRoom({ id: venue.id, name: venue.name, layout: layoutFile, example: venue.example });
      setLayout(layoutFile);
      setPicking({ venue: venue.name, layout: layoutFile });
    },
    [setRoom, setLayout],
  );

  const startShow = useCallback(
    (names: string[]) => {
      if (!names.length) return;
      const first = songs.find((s) => s.name === names[0]);
      resetForShow();
      setSetlist(names);
      if (first) setSong(first);
      setSeed(1);
      setEdits([]);
      setWant(null);
      const layoutQ = picking?.layout ? `&layout=${encodeURIComponent(picking.layout)}` : "";
      const listQ = names.length > 1 ? `&songs=${names.map(encodeURIComponent).join(",")}` : "";
      router.push(
        `/stage?song=${encodeURIComponent(names[0])}&seed=1${layoutQ}${listQ}`,
      );
    },
    [songs, picking, resetForShow, setSetlist, setSong, setSeed, setEdits, setWant, router],
  );

  const shown = useMemo(
    () => rooms.filter((v) => (filter === "all" ? true : filter === "locked" ? v.locked : !v.locked)),
    [rooms, filter],
  );

  const openCount = rooms.filter((v) => !v.locked).length;

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <NewShowDialog
        open={!!picking}
        onClose={() => setPicking(null)}
        onCreate={startShow}
        forRoom={picking?.venue}
      />

      <header className="flex-none px-[28px] pt-[24px] pb-[18px]">
        <div className="flex items-center gap-[20px] flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-[-0.025em] m-0 leading-[1.15] text-ink">
              Venues
            </h1>
            <p className="text-[12.5px] text-ink-dimmer mt-[4px] m-0 leading-[1.3]">
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"} · {openCount} you can design for
            </p>
          </div>

          <span className="flex-1 min-w-[16px]" />

          <div className="w-[240px] max-w-full">
            <Field
              icon={<Search size={14} />}
              type="text"
              placeholder="Search rooms"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
              aria-label="Search venues"
            />
          </div>
          <SegmentedControl
            aria-label="Filter venues"
            value={filter}
            onChange={setFilter}
            segments={FILTERS}
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-[28px] pt-[18px] pb-[48px]">
        {!loaded && <CardSkeleton count={8} />}

        {loaded && shown.length > 0 && (
          <div className="card-grid">
            {shown.map((v, i) => (
              <div
                key={v.id}
                className="animate-in h-full"
                style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
              >
                <VenueCard venue={v} layouts={layouts} onDesign={handleDesign} />
              </div>
            ))}
          </div>
        )}

        {loaded && !shown.length && (
          <p className="text-[13px] text-ink-dim text-center py-[48px] m-0">
            {q
              ? `No venue matches “${q}”.`
              : filter === "locked"
                ? "No locked venues. Everything in the catalogue is open to you."
                : "No venues open to you yet."}
          </p>
        )}
      </div>
    </div>
  );
}
