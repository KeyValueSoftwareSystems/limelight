"use client";

import { useRef, useEffect } from "react";
import type { Venue } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { drawMonogram } from "@/lib/cover";

interface VenueCardProps {
  venue: Venue;
  onDesign: (venue: Venue) => void;
}

export function VenueCard({ venue, onDesign }: VenueCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (cv) drawMonogram(cv, venue.name);
  }, [venue.name]);

  const locked = venue.locked;
  const rigNote = venue.rig_placeholder_note ?? venue.note;

  return (
    <Card onClick={!locked ? () => onDesign(venue) : undefined} disabled={locked}>
      <div className="relative aspect-[5/3] bg-[#0d0f14]">
        <canvas
          ref={canvasRef}
          width={320}
          height={192}
          className="block w-full h-full object-cover"
        />
        {venue.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={venue.logo_url}
            alt=""
            className="absolute inset-0 block w-full h-full object-contain p-[var(--spacing-s4)]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>
      <div className="px-[var(--spacing-s3)] pt-[var(--spacing-s3)] pb-[var(--spacing-s2)]">
        <b className="block text-[length:var(--text-lg)] font-medium truncate">{venue.name}</b>
        <div className="flex flex-wrap gap-1 mt-[var(--spacing-s2)]">
          {venue.layouts.map((l) => (
            <Badge key={l.file}>{l.name}</Badge>
          ))}
        </div>
        {rigNote && (
          <span className="block mt-[var(--spacing-s2)] text-[length:var(--text-sm)] text-dim">
            {rigNote}
          </span>
        )}
        {locked && (
          <span className="block mt-[var(--spacing-s2)] text-[length:var(--text-sm)] text-warn">
            {venue.locked_because ?? "locked"}
          </span>
        )}
        {venue.example && <Badge variant="accent" className="mt-[var(--spacing-s2)]">example</Badge>}
      </div>
    </Card>
  );
}
