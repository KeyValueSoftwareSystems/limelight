"use client";

import { useState } from "react";
import type { Venue, Layout, VenueLayout } from "@/lib/types";
import { RigPreview } from "./RigPreview";
import { rigSummary } from "@/lib/profiles";
import * as api from "@/lib/api";

interface VenueCardProps {
  venue: Venue;
  /** every rig this box can render, keyed by layout file */
  layouts: Record<string, Layout>;
  onDesign: (venue: Venue, layoutFile: string) => void;
}

export function VenueCard({ venue, layouts, onDesign }: VenueCardProps) {
  const [chosen, setChosen] = useState(venue.default);
  const locked = venue.locked;
  const layout = layouts[chosen];
  const many = venue.layouts.length > 1;

  /* a rig carrying a device nobody can point at a real fixture should say so */
  const invented = Object.entries(layout?.profiles ?? {})
    .filter(([, p]) => p.invented)
    .map(([t]) => t);

  const pick = (l: VenueLayout) => {
    setChosen(l.file);
  };

  return (
    <article
      className={`panel flex flex-col rounded-[var(--radius-lg)] overflow-hidden ${
        locked ? "opacity-70" : "panel-lift"
      }`}
    >
      <RigPreview
        fixtures={layout?.fixture_list ?? []}
        dimmed={locked}
        className="aspect-[3/2] w-full"
      />

      <div className="flex flex-col flex-1 gap-[7px] px-[14px] pt-[12px] pb-[13px]">
        <div className="flex items-center justify-between gap-[8px]">
          <div className="flex items-center gap-[var(--spacing-s2)] min-w-0">
            {venue.logo_url && (
              /* the venue's own mark, at reading size. It identifies the room; it
                 does not get to sit on top of the rig. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${api.BASE}${venue.logo_url}`}
                alt=""
                className="flex-none h-[18px] w-auto max-w-[72px] object-contain opacity-80"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <h2 className="text-[15px] font-semibold tracking-[-0.012em] text-ink truncate m-0">{venue.name}</h2>
          </div>
          {locked && (
            <span className="liquid-well flex-none px-[7px] py-[2px] rounded-full text-[10.5px] text-warn leading-[15px]">
              Locked
            </span>
          )}
        </div>

        <p
          className="m-0 text-[12.5px] text-ink-dim leading-[1.45] tabular-nums overflow-hidden"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", minHeight: "36px" }}
          title={rigSummary(layout?.kinds)}
        >
          {rigSummary(layout?.kinds)}
        </p>
        <p className="mono m-0 text-[11px] text-ink-dimmer tabular-nums">
          {layout ? `${layout.fixtures} fixtures \u00b7 ${layout.channels} channels` : "Rig unavailable"}
        </p>

        <div className="min-h-[30px] flex items-start">
        {many && (
          <div className="liquid-well inline-flex items-stretch gap-[2px] p-[2px] rounded-[7px] mt-[2px] self-start max-w-full flex-wrap">
            {venue.layouts.map((l) => {
              const on = l.file === chosen;
              return (
                <button
                  key={l.file}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(l)}
                  className={`px-[10px] h-[26px] rounded-[5px] border-0 text-[11.5px] cursor-pointer
                    transition-colors duration-[var(--dur-state)] ${
                    on ? "liquid liquid-key font-medium text-ink" : "bg-transparent text-ink-dim hover:text-ink"
                  }`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        )}
        </div>

        <div className="pt-[4px] flex flex-col gap-[8px]">
        {locked ? (
          <p
            className="m-0 text-[11.5px] text-ink-dim leading-[1.5] overflow-hidden"
            style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
          >
            {venue.locked_because ?? "This venue has not granted you access to its rig."}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onDesign(venue, chosen)}
            className="liquid liquid-key liquid-accent w-full h-[var(--control-h)] px-[16px] rounded-[var(--radius-sm)] text-[13px] font-semibold cursor-pointer"
          >
            Design for this room
          </button>
        )}

        {(venue.rig_placeholder_note || invented.length > 0) && (
          <details>
            <summary className="text-[11px] text-ink-dimmer cursor-pointer list-none marker:hidden hover:text-ink-dim transition-colors duration-150">
              What this rig is, and is not
            </summary>
            <div className="pt-[var(--spacing-s2)] flex flex-col gap-[var(--spacing-s2)]">
              {venue.rig_placeholder_note && (
                <p className="m-0 text-[11.5px] text-ink-dim leading-[1.5]">
                  {venue.rig_placeholder_note}
                </p>
              )}
              {invented.length > 0 && (
                <p className="m-0 text-[11.5px] text-warn leading-[1.5]">
                  The {invented.join(" and ")} channel map is invented. Every other device here
                  was read from a real fixture definition.
                </p>
              )}
            </div>
          </details>
        )}
        </div>
      </div>
    </article>
  );
}
