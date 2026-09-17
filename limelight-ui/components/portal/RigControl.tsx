"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Radio, AlertTriangle, CheckCircle2, XCircle, ChevronDown, RefreshCw } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import type { RigStatus } from "@/lib/types";

type RigState = "ready" | "unreachable" | "sending" | "off";

interface RigInfo {
  state: RigState;
  icon: typeof Radio;
  colour: string;
  bgColour: string;
  borderColour: string;
  textColour: string;
  headline: string;
  detail: string;
  remedy: string | null;
}

function diagnose(r: RigStatus | null, _hasShow: boolean): RigInfo {
  if (!r)
    return {
      state: "unreachable", icon: XCircle,
      colour: "#F87171", bgColour: "rgba(248,113,113,0.06)", borderColour: "rgba(248,113,113,0.2)", textColour: "#FCA5A5",
      headline: "Portal unreachable",
      detail: "Cannot connect to the lighting server.",
      remedy: "Check that the portal process is running.",
    };

  if (!r.can_send)
    return {
      state: "unreachable", icon: AlertTriangle,
      colour: "#FBBF24", bgColour: "rgba(251,191,36,0.06)", borderColour: "rgba(251,191,36,0.2)", textColour: "#FDE68A",
      headline: "No output",
      detail: r.why_not ?? "The Art-Net socket is not open.",
      remedy: r.why_not ? null : "Check the cable and network interface.",
    };

  if (r.sending)
    return {
      state: "sending", icon: Radio,
      colour: "#34D399", bgColour: "rgba(52,211,153,0.06)", borderColour: "rgba(52,211,153,0.2)", textColour: "#6EE7B7",
      headline: `Sending \u00b7 ${r.frames_sent.toLocaleString()} frames`,
      detail: `40 fps \u2192 Art-Net ${r.gateway} universe ${r.universe}`,
      remedy: null,
    };

  if (r.armed) {
    if (r.last_error)
      return {
        state: "unreachable", icon: XCircle,
        colour: "#F87171", bgColour: "rgba(248,113,113,0.06)", borderColour: "rgba(248,113,113,0.2)", textColour: "#FCA5A5",
        headline: "Send failing",
        detail: r.last_error,
        remedy: "Check the rig connection and retry.",
      };
    return {
      state: "ready", icon: CheckCircle2,
      colour: "#34D399", bgColour: "rgba(52,211,153,0.06)", borderColour: "rgba(52,211,153,0.2)", textColour: "#6EE7B7",
      headline: `Armed \u00b7 ${r.frames_sent.toLocaleString()} sent`,
      detail: `Socket open to ${r.gateway} universe ${r.universe}`,
      remedy: null,
    };
  }

  return {
    state: "off", icon: Radio,
    colour: "#5A5F78", bgColour: "rgba(59, 227, 255, 0.04)", borderColour: "rgba(59, 227, 255, 0.1)", textColour: "#9095AD",
    headline: `Universe ${r.universe} \u00b7 via ${r.route_via ?? r.gateway}`,
    detail: r.conflict ? r.conflict : "Standby",
    remedy: null,
  };
}

export function RigControl({ onToggle }: { onToggle: () => void }) {
  const rig = usePortalStore((s) => s.rig);
  const show = usePortalStore((s) => s.show);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const info = diagnose(rig, !!show);
  const isSending = info.state === "sending";

  useEffect(() => {
    if (!expanded) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [expanded]);

  const label = isSending ? "Live" : info.state === "unreachable" ? "Offline" : info.state === "ready" ? "Armed" : "Standby";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="liquid liquid-key flex items-center gap-[7px] h-[30px] px-[11px] rounded-full cursor-pointer"
      >
        <span
          className={`w-[6px] h-[6px] rounded-full flex-none ${isSending ? "animate-sending" : ""}`}
          style={{ background: info.colour }}
        />
        <span className="text-[11.5px] font-medium" style={{ color: info.textColour }}>
          {label}
        </span>
        <ChevronDown size={10} className="text-ink-dimmer" />
      </button>

      {expanded && (
        <div
          className="liquid absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] rounded-[var(--radius-md)] overflow-hidden animate-scale-in"

        >
          <div className="p-[16px]" style={{ background: info.bgColour }}>
            <div className="flex items-start gap-[10px]">
              <info.icon size={16} style={{ color: info.colour }} className="flex-none mt-[1px]" />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13px] font-semibold text-ink">{info.headline}</p>
                <p className="m-0 mt-[4px] text-[12px] text-ink-dim leading-[1.6]">{info.detail}</p>
              </div>
            </div>
          </div>

          {info.remedy && (
            <div className="px-[16px] py-[12px] border-t border-solid border-white/[0.06]">
              <p className="m-0 text-[12px] text-ink-dim leading-[1.6]">
                {info.remedy}
              </p>
              <button
                type="button"
                onClick={() => { onToggle(); setExpanded(false); }}
                className="flex items-center gap-[6px] mt-[8px] h-[28px] px-[12px] rounded-[var(--radius-sm)] border border-solid border-white/[0.08] bg-white/[0.04] text-[12px] font-medium text-ink cursor-pointer hover:bg-accent/[0.08] hover:border-accent/20 transition-all duration-200 active:scale-[0.98]"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {rig && (
            <div className="px-[16px] py-[12px] border-t border-solid border-white/[0.06]">
              <div className="grid grid-cols-[auto_1fr] gap-x-[16px] gap-y-[6px] text-[11px]">
                {([
                  ["Gateway", rig.gateway],
                  ["Universe", String(rig.universe)],
                  ["Route", rig.route_via ?? "\u2014"],
                  ["Frames", rig.frames_sent.toLocaleString()],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="contents">
                    <span className="text-ink-dimmer">{k}</span>
                    <span className="mono text-ink-dim text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-[16px] py-[10px] border-t border-solid border-white/[0.06] flex justify-end">
            {rig?.armed ? (
              <button
                type="button"
                onClick={() => { onToggle(); setExpanded(false); }}
                className="h-[30px] px-[14px] rounded-[var(--radius-sm)] border border-solid border-danger/40 bg-danger/[0.08] text-[12px] font-semibold text-danger cursor-pointer hover:bg-danger/[0.15] transition-all duration-200 active:scale-[0.97]"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { onToggle(); setExpanded(false); }}
                disabled={!rig?.can_send || !show}
                className="h-[30px] px-[14px] rounded-[var(--radius-sm)] border-0 text-[12px] font-semibold text-white cursor-pointer hover:brightness-110 transition-all duration-200 active:scale-[0.97] disabled:opacity-35 disabled:pointer-events-none"
                style={{ background: "var(--grad-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.3), 0 0 12px -2px rgba(59, 227, 255, 0.3)" }}
              >
                Send to rig
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
