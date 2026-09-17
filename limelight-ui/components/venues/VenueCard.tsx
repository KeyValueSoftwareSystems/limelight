"use client";

import { MediaCard, CardTag } from "@/components/ui";
import type { Venue, Layout } from "@/lib/types";
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
  const chosen = venue.default;
  const locked = venue.locked;
  const layout = layouts[chosen];

  /* a rig carrying a device nobody can point at a real fixture should say so */
  const invented = Object.entries(layout?.profiles ?? {})
    .filter(([, p]) => p.invented)
    .map(([t]) => t);


  return (
    <MediaCard
      title={venue.name}
      hint={locked ? venue.locked_because ?? "This rig is not open to you" : `Design for ${venue.name}`}
      disabled={locked}
      onOpen={() => onDesign(venue, chosen)}
      media={
        <>
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
        </>
      }
      meta={
        layout ? `${layout.fixtures} fixtures · ${layout.channels} channels` : "Rig unavailable"
      }
      body={rigSummary(layout?.kinds)}
      /* The card names the rig it is showing; it does not offer to switch it.
         A row of half-truncated rig names reads as stray buttons, and choosing
         between a venue's rigs is what the picker is for. */
      tags={
        <>
          {locked && <CardTag tone="warn">Locked</CardTag>}
          <CardTag>{venue.layouts.find((l) => l.file === chosen)?.name ?? "—"}</CardTag>
          {invented.length > 0 && (
            <CardTag
              tone="warn"
              hint={`The ${invented.join(" and ")} channel map is invented. Every other device here was read from a real fixture definition.`}
            >
              Stand-in rig
            </CardTag>
          )}
        </>
      }
      footer={
        locked
          ? "Access is granted by the venue"
          : `${venue.layouts.length} rig${venue.layouts.length === 1 ? "" : "s"}`
      }
    />
  );
}
