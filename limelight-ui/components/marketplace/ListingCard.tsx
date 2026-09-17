"use client";

import { useRef, useState, useEffect } from "react";
import { MediaCard, CardTag } from "@/components/ui";
import type { MarketListing } from "@/lib/types";
import { LivePreview } from "./LivePreview";

function sentence(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

export function ListingCard({ listing }: { listing: MarketListing }) {
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
  const kind = sentence(listing.kind);

  return (
    <MediaCard
      title={show.name}
      media={
        <div ref={containerRef} className="absolute inset-0 bg-[#05070C]">
          <LivePreview listing={listing} visible={visible} />
        </div>
      }
      meta={show.author ? `${show.song} · by ${show.author}` : show.song}
      body={listing.blurb || undefined}
      tags={
        <>
          <CardTag>{listing.tier === "free" ? "Free" : "Paid"}</CardTag>
          {kind && <CardTag>{kind}</CardTag>}
          {listing.stand_in && <CardTag tone="warn">Stand-in rig</CardTag>}
          {listing.example && <CardTag>Example</CardTag>}
        </>
      }
      footer={
        tel.measured
          ? `${tel.plays ?? 0} play${tel.plays === 1 ? "" : "s"}` +
            (tel.took_control ? ` · took control ${tel.took_control}×` : "") +
            (tel.blackout ? ` · blacked out ${tel.blackout}×` : "")
          : "No telemetry yet"
      }
    />
  );
}
