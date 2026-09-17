"use client";

import { useEffect, useState } from "react";
import { Timeline } from "@/components/editor/Timeline";
import { Ruler } from "@/components/editor/Ruler";
import { SectionBand } from "@/components/editor/SectionBand";
import { MomentsBand } from "@/components/editor/MomentsBand";
import { Playhead } from "@/components/editor/Playhead";
import { fit, panBy, zoomAt } from "@/lib/timeline";
import type { Show } from "@/lib/types";

const MIN_SPAN_S = 1.5;

/**
 * The designer's song map without the lanes.
 *
 * An operator does not place effects, but they still need to see where they are
 * in the track and get somewhere quickly: the bars, the sections the score
 * found, and the moments inside them. Same bands, same position, one third the
 * height.
 */
export function OperatorTimeline({
  show,
  currentTime,
  onSeek,
}: {
  show: Show;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const duration = show.duration_s ?? 0;
  const [view, setView] = useState(() => fit(duration || 1));

  useEffect(() => { setView(fit(show.duration_s ?? 1)); }, [show]);

  return (
    <div className="flex-none border-b border-solid border-[var(--line-strong)]">
      <Timeline
        view={view}
        duration={duration}
        onScrub={onSeek}
        onBackground={() => false}
        onZoom={(anchorT, factor) => setView((v) => zoomAt(v, anchorT, factor, duration, MIN_SPAN_S))}
        onPan={(dt) => setView((v) => panBy(v, dt, duration, MIN_SPAN_S))}
      >
        <div className="flex flex-col">
          <Ruler grid={show.grid} />
          <SectionBand sections={show.sections} />
          <MomentsBand moments={show.moments} />
        </div>
        <Playhead t={currentTime} />
      </Timeline>
    </div>
  );
}
