"use client";

import { usePortalStore } from "@/store/portal";
import { rigSummary } from "@/lib/profiles";

interface TargetLineProps {
  onOpenVenuePicker: () => void;
}

export function TargetLine({ onOpenVenuePicker }: TargetLineProps) {
  const room = usePortalStore((s) => s.room);
  const show = usePortalStore((s) => s.show);
  const layout = usePortalStore((s) => s.layout);
  const layouts = usePortalStore((s) => s.layouts);
  const rooms = usePortalStore((s) => s.rooms);
  const role = usePortalStore((s) => s.role);

  if (role === "venue" || !show) return null;

  const rig = layouts.find((l) => l.file === (show.layout || layout));
  const venue = rooms.find((v) => v.id === room?.id);
  const lname = venue?.layouts.find((l) => l.file === (show.layout || room?.layout))?.name;

  /* Count by what a device DOES, not by its type name. The old form asked
     `k === "par7" ? "par" : "head"`, which called a blinder, a strobe, a pixel
     bar and a laser all "heads" the moment a rig carried anything but the
     original two devices. The picker says this the same way, from lib/profiles. */
  const rigText = rig ? rigSummary(rig.kinds, ", ") : "";

  return (
    <div className="flex-none flex items-center gap-[10px] px-[16px] py-[8px]">
      <span className="text-[11px] text-ink-dimmer flex-none">Designing for</span>
      <button
        type="button"
        onClick={onOpenVenuePicker}
        title="Choose the room this show is for"
        className="liquid liquid-key flex items-center gap-[8px] h-[28px] px-[11px] rounded-[var(--radius-sm)] cursor-pointer min-w-0"
      >
        <span className="text-[12.5px] font-medium text-ink truncate">
          {room?.name ?? "\u2014"}
          {lname && venue && venue.layouts.length > 1 ? ` \u00b7 ${lname}` : ""}
        </span>
        <span className="text-[11px] text-ink-dim truncate">{rigText}</span>
      </button>
      <span className="flex-1" />
    </div>
  );
}
