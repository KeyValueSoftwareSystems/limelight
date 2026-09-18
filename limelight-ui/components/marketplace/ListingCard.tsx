"use client";

import { useEffect, useRef, useState } from "react";
import { Heart, Tag } from "lucide-react";
import { MediaCard, CardTag } from "@/components/ui";
import { LivePreview } from "./LivePreview";
import { Stars, Verified } from "./Stars";
import type { MarketListing, Song } from "@/lib/types";

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
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const tel = listing.telemetry;

  return (
    <MediaCard
      title={show.name}
      onOpen={() => onOpen(listing)}
      hint={`${show.name} \u00b7 ${money(listing.price_usd)}`}
      media={
        <div
          ref={boxRef}
          className="absolute inset-0 bg-[#05070C]"
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
        >
          {listing.thumbnail ? (
            <img
              src={listing.thumbnail}
              alt={show.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <LivePreview show={show} visible={visible} running={hover} />
          )}
        </div>
      }
      meta={
        <span className="flex items-center gap-[5px] min-w-0">
          <span className="truncate">
            {show.author ? `${show.song} · by ${show.author}` : show.song}
          </span>
          {listing.verified && <Verified />}
        </span>
      }
      body={listing.blurb || undefined}
      tags={
        <>
          {listing.rating != null && (
            <span className="flex items-center gap-[5px] flex-none mr-[2px]">
              <Stars rating={listing.rating} />
              <span className="mono text-[10.5px] text-ink-dim tabular-nums">
                {listing.rating.toFixed(1)}
              </span>
              <span className="mono text-[10.5px] text-ink-dimmer tabular-nums">
                ({listing.ratings_count ?? 0})
              </span>
            </span>
          )}
          {listing.stand_in && <CardTag tone="warn">Stand-in rig</CardTag>}
        </>
      }
      footer={
        <span className="flex items-baseline gap-[7px] min-w-0">
          <span
            className="flex items-center gap-[4px] font-semibold flex-none"
            style={{ color: "var(--accent)" }}
          >
            <Tag size={11} strokeWidth={2.4} className="translate-y-[1px]" />
            {money(listing.price_usd)}
          </span>
          {listing.likes != null && (
            <span className="flex items-center gap-[4px] text-ink-dimmer flex-none">
              <Heart size={11} strokeWidth={2.2} className="translate-y-[1px]" />
              {listing.likes.toLocaleString()}
            </span>
          )}
          {tel.measured && (
            <span className="text-ink-dimmer truncate">
              {`${tel.plays ?? 0} play${tel.plays === 1 ? "" : "s"}`}
              {tel.took_control ? ` · took control ${tel.took_control}\u00d7` : ""}
            </span>
          )}
        </span>
      }
    />
  );
}
