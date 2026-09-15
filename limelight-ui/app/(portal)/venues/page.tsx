"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { VenueCard } from "@/components/venues/VenueCard";
import { Input } from "@/components/ui/Input";
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

  const handleDesign = useCallback(
    (venue: Venue, layoutFile: string) => {
      setRoom({ id: venue.id, name: venue.name, layout: layoutFile, example: venue.example });
      setLayout(layoutFile);
      router.push("/library");
    },
    [setRoom, setLayout, router],
  );

  const shown = useMemo(
    () => rooms.filter((v) => (filter === "all" ? true : filter === "locked" ? v.locked : !v.locked)),
    [rooms, filter],
  );

  const openCount = rooms.filter((v) => !v.locked).length;

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <header className="flex-none px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s4)] border-b border-solid border-line">
        <div className="flex items-end justify-between gap-[var(--spacing-s4)] flex-wrap">
          <div>
            <h1 className="display m-0">Venues</h1>
            <p className="label mt-[7px] m-0">
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"}, {openCount} you can design for
            </p>
          </div>
          <Input
            placeholder="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            aria-label="Search venues"
          />
        </div>

        <div className="flex gap-[var(--spacing-s1)] mt-[var(--spacing-s4)]">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.id)}
                className={`px-[var(--spacing-s3)] h-[26px] border border-solid rounded-full text-[length:var(--text-xs)] bg-transparent cursor-pointer transition-colors duration-[var(--dur-state)] ${
                  on ? "border-line-strong text-ink" : "border-line text-dimmer hover:text-dim"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] auto-rows-max gap-[var(--spacing-s4)] px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s7)] content-start">
        {shown.map((v) => (
          <VenueCard key={v.id} venue={v} layouts={layouts} onDesign={handleDesign} />
        ))}

        {loaded && !shown.length && (
          <p className="col-span-full text-dim text-center py-[var(--spacing-s7)] m-0">
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
