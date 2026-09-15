"use client";

import { useRef, useState, useEffect } from "react";
import type { MarketListing } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LivePreview } from "./LivePreview";

interface ListingCardProps {
  listing: MarketListing;
}

export function ListingCard({ listing }: ListingCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { show } = listing;
  const tel = listing.telemetry;

  return (
    <Card>
      <div ref={containerRef} className="aspect-video bg-[#07090f]">
        <LivePreview listing={listing} visible={visible} />
      </div>
      <div className="px-[var(--spacing-s3)] pt-[var(--spacing-s3)] pb-[var(--spacing-s2)]">
        <b className="block text-[length:var(--text-lg)] font-medium truncate">{show.name}</b>
        <span className="block mt-1 text-[length:var(--text-sm)] text-dim">
          by {show.author} · {show.song} · seed {show.seed}
        </span>
        {listing.blurb && (
          <p className="mt-[var(--spacing-s2)] text-[length:var(--text-sm)] text-dim leading-[1.5] m-0">
            {listing.blurb}
          </p>
        )}
        <div className="flex items-center gap-[var(--spacing-s2)] mt-[var(--spacing-s3)]">
          <Badge>{listing.tier}</Badge>
          <Badge>{listing.kind}</Badge>
          {listing.stand_in && <Badge variant="warn">stand-in</Badge>}
          {listing.example && <Badge variant="accent">example</Badge>}
        </div>
        {tel.measured && (
          <span className="block mt-[var(--spacing-s2)] text-[length:var(--text-xs)] text-dimmer">
            {tel.plays != null ? `${tel.plays} plays` : "no telemetry"}
            {tel.took_control ? ` · took control ${tel.took_control}×` : ""}
            {tel.blackout ? ` · blacked out ${tel.blackout}×` : ""}
          </span>
        )}
      </div>
    </Card>
  );
}
