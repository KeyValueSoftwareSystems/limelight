"use client";

import { AlertTriangle } from "lucide-react";
import { MediaCard, CardTag } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import { LivePreview } from "@/components/marketplace/LivePreview";
import { showColours } from "./showColours";
import type { ShowFile, Song } from "@/lib/types";

export function ShowCard({
  show,
  song,
  onOpen,
}: {
  show: ShowFile;
  song?: Song;
  onOpen: (show: ShowFile) => void;
}) {
  const colours = showColours(show);
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

  return (
    <MediaCard
      title={show.name}
      hint={`Open ${show.name}`}
      onOpen={() => onOpen(show)}
      media={
        <>
          <div
            ref={boxRef}
            className="absolute inset-0 bg-[#0B0E15]"
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
          >
            <LivePreview show={show} visible={visible} running={hover} />
          </div>
          <span className="absolute inset-x-0 bottom-0 pointer-events-none flex items-center gap-[3px] px-[10px] pb-[9px] z-10" aria-hidden>
            {colours.map((c, i) => (
              <span
                key={i}
                className="block h-[3px] flex-1 rounded-full"
                style={{ background: c, boxShadow: `0 0 7px -1px ${c}` }}
              />
            ))}
          </span>
        </>
      }
      overlay={
        show.invalid ? (
          <span className="absolute left-[8px] top-[8px] pointer-events-none flex items-center gap-[3px] px-[6px] py-[2px] rounded-[4px] bg-black/65 backdrop-blur-md text-[10px] text-warn leading-[14px] z-10">
            <AlertTriangle size={10} className="flex-none" />
            Needs a look
          </span>
        ) : undefined
      }
      meta={song?.title ?? show.song}
      tags={
        <>
          <CardTag>{show.designed_for?.venue_name ?? "Any rig"}</CardTag>
          {show.author && <CardTag>{show.author}</CardTag>}
        </>
      }
      footer={`v${show.version} · ${show.edits.length} edit${show.edits.length === 1 ? "" : "s"}`}
    />
  );
}
