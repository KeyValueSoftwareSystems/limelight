"use client";

import { useRef, useState, useEffect } from "react";
import type { MarketListing } from "@/lib/types";
import { LivePreview } from "./LivePreview";

interface ListingCardProps {
  listing: MarketListing;
}

function sentence(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

function Tag({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  return (
    <span
      className={`liquid-well px-[7px] py-[2px] rounded-full text-[10.5px] leading-[15px] flex-none ${
        tone === "warn" ? "text-warn" : "text-ink-dim"
      }`}
    >
      {children}
    </span>
  );
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
    <article className="panel panel-lift flex flex-col rounded-[var(--radius-lg)] overflow-hidden">
      <div ref={containerRef} className="aspect-[3/2] bg-[#05070C]">
        <LivePreview listing={listing} visible={visible} />
      </div>

      <div className="flex flex-col gap-[7px] px-[14px] pt-[12px] pb-[13px]">
        <div className="min-w-0">
          <span className="block text-[14px] font-semibold tracking-[-0.012em] text-ink truncate">
            {show.name}
          </span>
          <span className="block mt-[3px] text-[11.5px] text-ink-dim truncate">
            {show.song}
            {show.author ? ` · by ${show.author}` : ""}
          </span>
        </div>

        {listing.blurb && (
          <p
            className="m-0 text-[12px] text-ink-dim leading-[1.5] overflow-hidden"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", minHeight: "36px" }}
          >
            {listing.blurb}
          </p>
        )}

        <div className="flex items-center gap-[5px] flex-wrap">
          {sentence(listing.tier) && <Tag>{listing.tier === "free" ? "Free" : "Paid"}</Tag>}
          {sentence(listing.kind) && <Tag>{sentence(listing.kind)}</Tag>}
          {listing.stand_in && <Tag tone="warn">Stand-in rig</Tag>}
          {listing.example && <Tag>Example</Tag>}
        </div>

        <span className="mono text-[10.5px] text-ink-dimmer tabular-nums">
          {tel.measured
            ? `${tel.plays ?? 0} play${tel.plays === 1 ? "" : "s"}` +
              (tel.took_control ? ` · took control ${tel.took_control}×` : "") +
              (tel.blackout ? ` · blacked out ${tel.blackout}×` : "")
            : "No telemetry yet"}
        </span>
      </div>
    </article>
  );
}
