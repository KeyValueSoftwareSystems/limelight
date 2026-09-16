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
    <div className="flex-none flex items-baseline gap-[var(--spacing-s3)] px-[var(--spacing-s6)] pt-[var(--spacing-s2)]">
      <span className="label">Designing for</span>
      <button
        type="button"
        onClick={onOpenVenuePicker}
        className="flex items-baseline gap-[var(--spacing-s2)] px-2 py-[2px] pb-[3px] border border-solid border-line rounded bg-transparent cursor-pointer text-inherit hover:border-accent"
      >
        <b className="text-[length:var(--text-md)] font-medium">
          {room?.name ?? "—"}
          {lname && venue && venue.layouts.length > 1 ? ` · ${lname}` : ""}
        </b>
        <span className="text-[length:var(--text-sm)] text-dim">{rigText}</span>
      </button>
      <span className="flex-1" />
    </div>
  );
}
