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
      className={`flex flex-col border border-solid rounded-[7px] bg-panel overflow-hidden transition-colors duration-[var(--dur-state)] ${
        locked ? "border-line" : "border-line hover:border-line-strong"
      }`}
    >
      <RigPreview
        fixtures={layout?.fixture_list ?? []}
        dimmed={locked}
        className="aspect-[16/9] w-full"
      />

      <div className="flex flex-col flex-1 gap-[var(--spacing-s2)] p-[var(--spacing-s3)]">
        <div className="flex items-center justify-between gap-[var(--spacing-s2)]">
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
            <h2 className="text-[length:var(--text-lg)] font-medium truncate m-0">{venue.name}</h2>
          </div>
          {locked && (
            <span className="flex-none text-[length:var(--text-xs)] text-warn">locked</span>
          )}
        </div>

        <p className="m-0 text-[length:var(--text-sm)] text-dim tabular-nums">
          {rigSummary(layout?.kinds)}
        </p>
        <p className="m-0 text-[length:var(--text-xs)] text-dimmer tabular-nums">
          {layout ? `${layout.fixtures} fixtures · ${layout.channels} channels` : "rig unavailable"}
        </p>

        {many && (
          <div className="flex flex-wrap gap-1 pt-[var(--spacing-s1)]">
            {venue.layouts.map((l) => {
              const on = l.file === chosen;
              return (
                <button
                  key={l.file}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(l)}
                  className={`px-[9px] py-[3px] border border-solid rounded-full text-[length:var(--text-xs)] cursor-pointer bg-transparent transition-colors duration-[var(--dur-state)] ${
                    on ? "border-line-strong text-ink" : "border-line text-dimmer hover:text-dim"
                  }`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-auto pt-[var(--spacing-s1)] flex flex-col gap-[var(--spacing-s2)]">
        {locked ? (
          <p className="m-0 text-[length:var(--text-xs)] text-dim leading-[1.45]">
            {venue.locked_because ?? "This venue has not granted you access to its rig."}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onDesign(venue, chosen)}
            className="h-[var(--hit)] px-[var(--spacing-s3)] border border-solid border-line-strong rounded-[5px] bg-transparent text-ink text-[length:var(--text-sm)] cursor-pointer transition-colors duration-[var(--dur-state)] hover:bg-bg-overlay"
          >
            Design for this room
          </button>
        )}

        {(venue.rig_placeholder_note || invented.length > 0) && (
          <details>
            <summary className="text-[length:var(--text-xs)] text-dimmer cursor-pointer list-none marker:hidden">
              What this rig is, and is not
            </summary>
            <div className="pt-[var(--spacing-s2)] flex flex-col gap-[var(--spacing-s2)]">
              {venue.rig_placeholder_note && (
                <p className="m-0 text-[length:var(--text-xs)] text-dim leading-[1.5]">
                  {venue.rig_placeholder_note}
                </p>
              )}
              {invented.length > 0 && (
                <p className="m-0 text-[length:var(--text-xs)] text-warn leading-[1.5]">
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
