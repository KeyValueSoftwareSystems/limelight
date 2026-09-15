"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { VenueCard } from "@/components/venues/VenueCard";
import { Input } from "@/components/ui/Input";
import type { Venue } from "@/lib/types";

export default function VenuesPage() {
  const rooms = usePortalStore((s) => s.rooms);
  const setRooms = usePortalStore((s) => s.setRooms);
  const setRoom = usePortalStore((s) => s.setRoom);
  const setLayout = usePortalStore((s) => s.setLayout);
  const [q, setQ] = useState("");
  const router = useRouter();

  useEffect(() => {
    api.venues
      .search(q)
      .then((d) => setRooms(d.venues))
      .catch(() => {});
  }, [q, setRooms]);

  const handleDesign = useCallback(
    (venue: Venue) => {
      setRoom({ id: venue.id, name: venue.name, layout: venue.default, example: venue.example });
      setLayout(venue.default);
      router.push("/library");
    },
    [setRoom, setLayout, router],
  );

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <div className="flex-none px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s4)] border-b border-solid border-line">
        <div className="flex items-end justify-between gap-[var(--spacing-s4)]">
          <div>
            <div className="display">Venues</div>
            <div className="label mt-[7px]">{rooms.length} venue{rooms.length === 1 ? "" : "s"}</div>
          </div>
          <Input
            placeholder="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] auto-rows-max gap-[var(--spacing-s4)] px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s7)] content-start">
        {rooms.map((v) => (
          <VenueCard key={v.id} venue={v} onDesign={handleDesign} />
        ))}
        {!rooms.length && (
          <div className="col-span-full text-dim text-center py-8">No venues found</div>
        )}
      </div>
    </div>
  );
}
