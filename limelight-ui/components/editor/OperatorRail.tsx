"use client";

import { useEffect, useState } from "react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { SetlistPanel } from "./SetlistPanel";
import { RigPreview } from "@/components/venues/RigPreview";
import type { Venue, Layout } from "@/lib/types";

/** The rig this desk is driving, and every other rig it could drive. */
export function OperatorRail({
  onPickRig,
}: {
  onPickRig: (venue: Venue, layoutFile: string) => void;
}) {
  const rooms = usePortalStore((s) => s.rooms);
  const setRooms = usePortalStore((s) => s.setRooms);
  const room = usePortalStore((s) => s.room);
  const show = usePortalStore((s) => s.show);
  const [byFile, setByFile] = useState<Record<string, Layout>>({});

  useEffect(() => {
    api.venues
      .search()
      .then((d) => {
        if (d.venues) setRooms(d.venues);
        if (d.layouts) setByFile(Object.fromEntries(d.layouts.map((l) => [l.file, l])));
      })
      .catch(() => {});
  }, [setRooms]);

  const liveFile = show?.layout || room?.layout;

  return (
    <nav className="h-full flex flex-col min-h-0">
      <SetlistPanel />

      <div className="flex-none px-[16px] pt-[12px] pb-[8px]">
        <span className="text-[11px] font-medium text-ink-dimmer">Rig</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[8px] pb-[12px]">
        {rooms.length === 0 && (
          <p className="m-0 px-[8px] text-[11.5px] text-ink-dimmer leading-[1.5]">
            No rooms available.
          </p>
        )}

        {rooms.map((v) => (
          <div key={v.id} className="mb-[8px]">
            <div className="flex items-baseline gap-[6px] px-[8px] pb-[3px]">
              <span className="text-[11.5px] font-medium text-ink-dim truncate">{v.name}</span>
              {v.locked && (
                <span className="text-[10px] text-warn flex-none">Locked</span>
              )}
            </div>

            {v.layouts.map((l) => {
              const live = l.file === liveFile;
              const layout = byFile[l.file];
              return (
                <button
                  key={l.file}
                  type="button"
                  disabled={v.locked}
                  onClick={() => onPickRig(v, l.file)}
                  aria-current={live ? "true" : undefined}
                  title={v.locked ? "This rig is not open to you" : `Drive ${v.name} · ${l.name}`}
                  className={`w-full text-left px-[8px] py-[6px] rounded-[6px] border-0 transition-colors duration-150 ${
                    v.locked
                      ? "cursor-default opacity-50 bg-transparent"
                      : live
                        ? "liquid-well cursor-pointer"
                        : "cursor-pointer bg-transparent hover:bg-white/[0.045]"
                  }`}
                >
                  <span className="flex items-center gap-[9px] min-w-0">
                    <RigPreview
                      fixtures={layout?.fixture_list ?? []}
                      dimmed={v.locked}
                      className="w-[52px] h-[30px] rounded-[4px] flex-none"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-[6px]">
                        <span className={`text-[12px] truncate ${live ? "text-ink font-medium" : "text-ink-dim"}`}>
                          {l.name}
                        </span>
                        <span className="flex-1" />
                        {live && (
                          <span className="text-[10px] flex-none" style={{ color: "var(--accent)" }}>
                            Driving
                          </span>
                        )}
                      </span>
                      <span className="mono block mt-[2px] text-[10px] text-ink-dimmer tabular-nums truncate">
                        {layout ? `${layout.fixtures} fixtures · ${layout.channels} ch` : "\u2014"}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
