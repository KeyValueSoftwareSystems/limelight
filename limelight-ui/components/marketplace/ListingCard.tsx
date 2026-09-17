"use client";

import { MediaCard, CardTag } from "@/components/ui";
import { CoverCanvas } from "@/components/library/CoverCanvas";
import type { MarketListing, Song } from "@/lib/types";

function sentence(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

function money(v: number | null | undefined) {
  if (!v) return "Free";
  return `$${v.toLocaleString("en-US")}`;
}

export function ListingCard({
  listing,
  song,
  onOpen,
}: {
  listing: MarketListing;
  song?: Song;
  onOpen: (l: MarketListing) => void;
}) {
  const { show } = listing;
  const tel = listing.telemetry;
  const kind = sentence(listing.kind);

  return (
    <MediaCard
      title={show.name}
      onOpen={() => onOpen(listing)}
      hint={`${show.name} \u00b7 ${money(listing.price_usd)}`}
      media={
        song ? <CoverCanvas song={song} /> : <div className="absolute inset-0 bg-[#05070C]" />
      }
      meta={show.author ? `${show.song} · by ${show.author}` : show.song}
      body={listing.blurb || undefined}
      tags={
        <>
          <CardTag>{money(listing.price_usd)}</CardTag>
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
