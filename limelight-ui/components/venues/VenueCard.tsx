"use client";

import { useState } from "react";
import { MediaCard, CardTag } from "@/components/ui";
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
      tags={
        <>
          {locked && <CardTag tone="warn">Locked</CardTag>}
          {many ? (
            venue.layouts.map((l) => (
              <CardTag
                key={l.file}
                on={l.file === chosen}
                onClick={() => pick(l)}
                hint={`Preview the ${l.name} rig`}
              >
                {l.name}
              </CardTag>
            ))
          ) : (
            <CardTag>{venue.layouts[0]?.name ?? "—"}</CardTag>
          )}
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
