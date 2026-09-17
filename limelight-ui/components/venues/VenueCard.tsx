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

  const pick = (l: VenueLayout) => setChosen(l.file);
  const summary = rigSummary(layout?.kinds);

  return (
    <article
      className={`panel flex flex-col rounded-[var(--radius-lg)] overflow-hidden ${
        locked ? "opacity-70" : "panel-lift"
      }`}
    >
      <div className="relative w-full aspect-[3/2] overflow-hidden">
        <RigPreview
          fixtures={layout?.fixture_list ?? []}
          dimmed={locked}
          className="absolute inset-0"
        />
        {venue.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${api.BASE}${venue.logo_url}`}
            alt=""
            className="absolute left-[10px] top-[10px] h-[16px] w-auto max-w-[70px] object-contain opacity-75"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>

      <div className="flex flex-col gap-[7px] px-[14px] pt-[12px] pb-[13px] min-w-0">
        <div className="flex items-start gap-[8px] min-w-0">
          <div className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold tracking-[-0.012em] text-ink truncate">
              {venue.name}
            </span>
            <span className="mono block mt-[3px] text-[11.5px] text-ink-dim tabular-nums truncate">
              {layout ? `${layout.fixtures} fixtures \u00b7 ${layout.channels} channels` : "Rig unavailable"}
            </span>
          </div>
          {locked && (
            <span className="liquid-well flex-none px-[7px] py-[2px] rounded-full text-[10.5px] text-warn leading-[15px]">
              Locked
            </span>
          )}
        </div>

        <p
          className="m-0 text-[12px] text-ink-dim leading-[1.5] overflow-hidden"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", minHeight: "36px" }}
          title={summary}
        >
          {summary}
        </p>

        <div className="flex items-center gap-[5px] flex-wrap min-h-[21px]">
          {many ? (
            venue.layouts.map((l) => {
              const on = l.file === chosen;
              return (
                <button
                  key={l.file}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(l)}
                  title={`Show the ${l.name} rig`}
                  className={`px-[7px] py-[2px] rounded-full text-[10.5px] leading-[15px] border-0 cursor-pointer
                    transition-colors duration-[var(--dur-state)] ${
                    on ? "liquid liquid-key text-ink" : "liquid-well text-ink-dimmer hover:text-ink-dim"
                  }`}
                >
                  {l.name}
                </button>
              );
            })
          ) : (
            <span className="liquid-well px-[7px] py-[2px] rounded-full text-[10.5px] text-ink-dim leading-[15px] truncate max-w-full">
              {venue.layouts[0]?.name ?? "\u2014"}
            </span>
          )}
          {invented.length > 0 && (
            <span className="liquid-well px-[7px] py-[2px] rounded-full text-[10.5px] text-warn leading-[15px]">
              Stand-in rig
            </span>
          )}
        </div>

        {locked ? (
          <p
            className="m-0 text-[10.5px] text-ink-dimmer leading-[1.5] overflow-hidden"
            style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
          >
            {venue.locked_because ?? "This venue has not granted you access to its rig."}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onDesign(venue, chosen)}
            className="liquid liquid-key liquid-accent w-full h-[var(--control-h)] px-[16px] rounded-[var(--radius-sm)] text-[13px] font-semibold cursor-pointer mt-[1px]"
          >
            Design for this room
          </button>
        )}

        {venue.rig_placeholder_note && (
          <details className="mt-[1px]">
            <summary className="text-[10.5px] text-ink-dimmer cursor-pointer list-none marker:hidden hover:text-ink-dim transition-colors duration-150">
              What this rig is, and is not
            </summary>
            <div className="pt-[7px] flex flex-col gap-[6px]">
              <p className="m-0 text-[11px] text-ink-dim leading-[1.5]">{venue.rig_placeholder_note}</p>
              {invented.length > 0 && (
                <p className="m-0 text-[11px] text-warn leading-[1.5]">
                  The {invented.join(" and ")} channel map is invented. Every other device here
                  was read from a real fixture definition.
                </p>
              )}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
