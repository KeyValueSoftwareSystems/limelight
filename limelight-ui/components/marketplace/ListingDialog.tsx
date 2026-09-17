"use client";

import { useEffect, useState } from "react";
import { X, Check } from "lucide-react";
import { LivePreview } from "./LivePreview";
import { CardTag } from "@/components/ui";
import type { MarketListing } from "@/lib/types";

function money(v: number | null | undefined) {
  if (!v) return "Free";
  return `$${v.toLocaleString("en-US")}`;
}

function sentence(v: string | null | undefined) {
  const t = (v ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

export function ListingDialog({
  listing,
  onClose,
}: {
  listing: MarketListing | null;
  onClose: () => void;
}) {
  const [bought, setBought] = useState(false);

  useEffect(() => { setBought(false); }, [listing?.show_id]);
  useEffect(() => {
    if (!listing) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [listing, onClose]);

  if (!listing) return null;
  const { show } = listing;
  const tel = listing.telemetry;
  const kind = sentence(listing.kind);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-[20px]"
      style={{ background: "rgba(2,3,8,0.72)", backdropFilter: "blur(6px)" }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={show.name}
    >
      <div className="liquid flex flex-col w-full max-w-[680px] max-h-[86vh] rounded-[var(--radius-xl)] overflow-hidden animate-scale-in">
        <div className="relative w-full aspect-[16/9] bg-[#05070C] flex-none">
          <LivePreview show={show} visible />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-[10px] top-[10px] flex items-center justify-center w-[28px] h-[28px] rounded-[6px] border-0 bg-black/55 backdrop-blur-md text-white/80 hover:text-white cursor-pointer transition-colors duration-150"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-[22px] pt-[16px] pb-[18px] flex flex-col gap-[12px]">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold tracking-[-0.02em] m-0 text-ink leading-[1.2]">
              {show.name}
            </h2>
            <p className="text-[13px] text-ink-dim mt-[5px] m-0">
              {show.song}
              {show.author ? ` · by ${show.author}` : ""}
            </p>
          </div>

          {listing.blurb && (
            <p className="m-0 text-[13px] text-ink-dim leading-[1.6]">{listing.blurb}</p>
          )}

          <div className="flex items-center gap-[5px] flex-wrap">
            <CardTag>{listing.tier === "free" ? "Free" : "Paid"}</CardTag>
            {kind && <CardTag>{kind}</CardTag>}
            {listing.stand_in && <CardTag tone="warn">Stand-in rig</CardTag>}
            {listing.example && <CardTag>Example</CardTag>}
          </div>

          <dl className="grid grid-cols-2 gap-x-[16px] gap-y-[7px] m-0 mt-[2px]">
            {[
              ["Track", show.song],
              ["Designer", show.author || "Unknown"],
              ["Version", `v${show.version ?? 1}`],
              ["Edits", String(show.edits?.length ?? 0)],
              ["Plays", tel.measured ? String(tel.plays ?? 0) : "No telemetry yet"],
              [
                "Blackouts",
                tel.measured ? String(tel.blackout ?? 0) : "—",
              ],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-[10px] min-w-0">
                <dt className="text-[11.5px] text-ink-dimmer flex-none">{k}</dt>
                <dd className="mono m-0 text-[11.5px] text-ink-dim tabular-nums truncate">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex-none flex items-center gap-[14px] px-[22px] h-[66px] border-t border-solid border-[var(--edge)]">
          <span className="flex flex-col leading-none gap-[3px]">
            <span className="text-[17px] font-semibold text-ink">{money(listing.price_usd)}</span>
            <span className="text-[10.5px] text-ink-dimmer">
              {listing.price_usd ? "One room, unlimited plays" : "Yours to play"}
            </span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="liquid liquid-key h-[var(--control-h)] px-[15px] rounded-[var(--radius-sm)] text-[13px] font-medium text-ink-dim cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            disabled={bought}
            onClick={() => setBought(true)}
            className="liquid liquid-key liquid-accent inline-flex items-center gap-[7px] h-[var(--control-h)] px-[17px] rounded-[var(--radius-sm)] text-[13px] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-default"
          >
            {bought ? <Check size={15} strokeWidth={2.6} /> : null}
            {bought
              ? "Added"
              : listing.price_usd
                ? `Buy for ${money(listing.price_usd)}`
                : "Add to my shows"}
          </button>
        </div>

        {bought && (
          <p className="flex-none m-0 px-[22px] pb-[14px] text-[11.5px] text-ink-dimmer leading-[1.5]">
            Nothing was charged. The marketplace is a surface: there is no payment
            path behind this button yet.
          </p>
        )}
      </div>
    </div>
  );
}
