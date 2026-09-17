"use client";

import { memo } from "react";
import Image from "next/image";
import { timeToX } from "@/lib/timeline";
import { beatsLabel, mmssms } from "@/lib/grid";
import { effectIcon } from "@/lib/effectIcons";
import { familyHue } from "@/lib/tokens";
import { useTimeline } from "./Timeline";
import type { Clip as ClipModel } from "@/lib/types";

export type Gesture = "move" | "trim-start" | "trim-end";

const MIN_CLIP_PX = 16;
const HANDLES_FIT_PX = 44;

function clipOpacity(clip: ClipModel): number {
  const amount = clip.params?.amount;
  if (typeof amount === "number") return 0.35 + amount * 0.65;
  if (clip.kind === "gesture") return 0.9;
  if (clip.kind === "binding") return 0.65;
  return 0.75;
}

function ClipBase({
  clip,
  selected,
  top,
  height,
  onSelect,
  onGesture,
  onZoomTo,
}: {
  clip: ClipModel;
  selected: boolean;
  top: number;
  height: number;
  onSelect?: (key: string, additive: boolean) => void;
  onGesture?: (clip: ClipModel, mode: Gesture, e: React.PointerEvent) => void;
  onZoomTo?: (clip: ClipModel) => void;
}) {
  const { view, width } = useTimeline();
  const x0 = timeToX(clip.startS, view, width);
  const x1 = timeToX(clip.endS, view, width);
  if (x1 < -MIN_CLIP_PX || x0 > width) return null;

  const w = Math.max(MIN_CLIP_PX, x1 - x0);
  const editable = !!onGesture;
  const showTrim = editable && (selected || w >= HANDLES_FIT_PX);
  const roomy = w >= HANDLES_FIT_PX;
  const grip = roomy ? { w: 8, out: 0 } : { w: 12, out: 12 };

  const famColour = familyHue(clip.family);
  const opacity = clipOpacity(clip);
  const isShort = clip.beats <= 2;

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect?.(clip.key, e.shiftKey);
        if (editable) onGesture!(clip, "move", e);
      }}
      onPointerEnter={(e) => { (e.currentTarget as HTMLElement).style.zIndex = "15"; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLElement).style.zIndex = selected ? "20" : "1"; }}
      onDoubleClick={(e) => { e.stopPropagation(); onZoomTo?.(clip); }}
      data-clip-key={clip.key}
      className={`absolute touch-none ${
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
      style={{
        left: x0,
        width: w,
        top: top + 1,
        height: height - 2,
        zIndex: selected ? 20 : 1,
        borderRadius: "4px",
        background: selected
          ? "var(--select)"
          : `color-mix(in srgb, ${famColour} ${Math.round(opacity * 55)}%, var(--bg-raised))`,
        borderLeft: selected ? "none" : `2px solid color-mix(in srgb, ${famColour} ${Math.round(opacity * 80)}%, transparent)`,
        boxShadow: selected
          ? "0 0 0 1px var(--select), 0 2px 4px rgba(0,0,0,0.2)"
          : `0 0 0 1px color-mix(in srgb, ${famColour} 15%, transparent)`,
        opacity: clip.overridden ? 0.3 : 1,
        transition: "box-shadow 150ms ease, opacity 150ms ease",
      }}
      title={
        `${clip.name} \u00b7 ${mmssms(clip.startS)} \u00b7 ${beatsLabel(clip.beats)} beat${clip.beats === 1 ? "" : "s"}` +
        ` \u00b7 bar ${clip.bar}\u00b7${beatsLabel(clip.beat)}`
      }
    >
      <span className="absolute inset-0 flex items-center gap-[4px] px-[6px] pointer-events-none overflow-hidden">
        {w > 28 && (
          <Image
            src={effectIcon({ id: clip.tile ?? clip.fx })}
            alt=""
            width={12}
            height={12}
            className="flex-none"
            style={selected ? { filter: "brightness(0) saturate(0)" } : { opacity: 0.85 }}
          />
        )}
        {w > 52 && (
          <span
            className="text-[10px] truncate font-medium leading-[12px]"
            style={{ color: selected ? "var(--bg)" : "var(--ink)", opacity: selected ? 1 : 0.85 }}
          >
            {clip.name}
          </span>
        )}
      </span>

      {showTrim && (
        <>
          <Grip side="start" width={grip.w} out={grip.out} selected={selected} famColour={famColour}
            onPointerDown={(e) => { e.stopPropagation(); onSelect?.(clip.key, false); onGesture!(clip, "trim-start", e); }} />
          <Grip side="end" width={grip.w} out={grip.out} selected={selected} famColour={famColour}
            onPointerDown={(e) => { e.stopPropagation(); onSelect?.(clip.key, false); onGesture!(clip, "trim-end", e); }} />
        </>
      )}
    </div>
  );
}

function Grip({
  side, width, out, selected, famColour, onPointerDown,
}: {
  side: "start" | "end"; width: number; out: number; selected: boolean;
  famColour: string; onPointerDown: (e: React.PointerEvent) => void;
}) {
  const outer = side === "start" ? { left: -out } : { right: -out };
  const fill = selected ? "var(--select)" : `color-mix(in srgb, ${famColour} 40%, var(--bg-raised))`;
  const mark = selected ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.2)";
  return (
    <span
      onPointerDown={onPointerDown}
      title={side === "start" ? "Drag to change start" : "Drag to change length"}
      className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize"
      style={{
        ...outer, width, zIndex: 22, background: fill,
        borderRadius: side === "start" ? "4px 0 0 4px" : "0 4px 4px 0",
      }}
    >
      <span aria-hidden style={{ width: 2, height: "40%", borderLeft: `1px solid ${mark}`, borderRight: `1px solid ${mark}` }} />
    </span>
  );
}

export const Clip = memo(ClipBase);
