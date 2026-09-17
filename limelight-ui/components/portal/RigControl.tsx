"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Radio, AlertTriangle, CheckCircle2, XCircle, ChevronDown, RefreshCw, ExternalLink } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import type { RigStatus } from "@/lib/types";

type RigState = "ready" | "unreachable" | "sending" | "off";

interface RigInfo {
  state: RigState;
  icon: typeof Radio;
  colour: string;
  bgColour: string;
  headline: string;
  detail: string;
  remedy: string | null;
}

function diagnose(r: RigStatus | null, hasShow: boolean): RigInfo {
  if (!r)
    return {
      state: "unreachable", icon: XCircle,
      colour: "var(--danger)", bgColour: "rgba(248, 113, 113, 0.08)",
      headline: "Portal unreachable",
      detail: "Cannot connect to the lighting server.",
      remedy: "Check that the portal process is running.",
    };

  if (!r.can_send)
    return {
      state: "unreachable", icon: AlertTriangle,
      colour: "var(--warn)", bgColour: "rgba(251, 191, 36, 0.08)",
      headline: "No output",
      detail: r.why_not ?? "The Art-Net socket is not open.",
      remedy: r.why_not ? null : "Check the cable and the network interface.",
    };

  if (r.sending)
    return {
      state: "sending", icon: Radio,
      colour: "var(--ok)", bgColour: "rgba(52, 211, 153, 0.08)",
      headline: `Sending · ${r.frames_sent.toLocaleString()} frames`,
      detail: `40 fps → Art-Net ${r.gateway} universe ${r.universe}`,
      remedy: null,
    };

  if (r.armed) {
    if (r.last_error)
      return {
        state: "unreachable", icon: XCircle,
        colour: "var(--danger)", bgColour: "rgba(248, 113, 113, 0.08)",
        headline: "Send failing",
        detail: r.last_error,
        remedy: "Check the rig connection and retry.",
      };
    return {
      state: "ready", icon: CheckCircle2,
      colour: "var(--ok)", bgColour: "rgba(52, 211, 153, 0.08)",
      headline: `Armed · ${r.frames_sent.toLocaleString()} sent`,
      detail: `Socket open to ${r.gateway} universe ${r.universe}`,
      remedy: null,
    };
  }

  return {
    state: "ready", icon: Radio,
    colour: "var(--ink-dimmer)", bgColour: "transparent",
    headline: `Universe ${r.universe} · via ${r.route_via ?? r.gateway}`,
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

  const handleRetry = useCallback(() => { onToggle(); }, [onToggle]);

  const _showStatus = info.state !== "off" as string || info.state === ("ready" as string);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-[7px] h-[32px] px-[10px] rounded-[var(--radius-sm)] border border-solid cursor-pointer transition-all duration-[var(--dur-state)] hover:bg-bg-raised"
        style={{
          borderColor: info.colour === "var(--ink-dimmer)" ? "var(--line)" : `color-mix(in srgb, ${info.colour} 30%, transparent)`,
          background: info.bgColour,
        }}
      >
        <span
          className={`w-[6px] h-[6px] rounded-full flex-none ${isSending ? "animate-sending" : ""}`}
          style={{ background: info.colour }}
        />
        <span className="text-[12px] font-medium" style={{ color: info.colour === "var(--ink-dimmer)" ? "var(--ink-dim)" : info.colour }}>
          {info.state === "sending" ? "Live" : info.state === "unreachable" ? "Offline" : info.state === "ready" && rig?.armed ? "Armed" : "Standby"}
        </span>
        <ChevronDown size={11} className="text-ink-dimmer" />
      </button>

      {expanded && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[320px] rounded-[var(--radius-md)] bg-bg-overlay p-0 overflow-hidden animate-scale-in"
          style={{ boxShadow: "var(--elev-popover)" }}
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
            <div className="px-[16px] py-[12px] border-t border-solid border-line">
              <p className="m-0 text-[12px] text-ink-dim leading-[1.6]">
                {info.remedy}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-[6px] mt-[8px] h-[28px] px-[12px] rounded-[var(--radius-sm)] border border-solid border-line-strong bg-bg-raised text-[12px] font-medium text-ink cursor-pointer hover:bg-bg-overlay transition-all duration-[var(--dur-state)] active:scale-[0.98]"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {rig && (
            <div className="px-[16px] py-[12px] border-t border-solid border-line">
              <div className="grid grid-cols-[auto_1fr] gap-x-[16px] gap-y-[6px] text-[11px]">
                {([
                  ["Gateway", rig.gateway],
                  ["Universe", String(rig.universe)],
                  ["Route", rig.route_via ?? "—"],
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

          <div className="px-[16px] py-[10px] border-t border-solid border-line flex justify-end">
            {rig?.armed ? (
              <button
                type="button"
                onClick={() => { onToggle(); setExpanded(false); }}
                className="h-[30px] px-[14px] rounded-[var(--radius-sm)] border border-solid border-danger/40 bg-danger/10 text-[12px] font-semibold text-danger cursor-pointer hover:bg-danger/20 transition-all duration-[var(--dur-state)] active:scale-[0.97]"
              >
                Stop sending
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { onToggle(); setExpanded(false); }}
                disabled={!rig?.can_send || !show}
                className="h-[30px] px-[14px] rounded-[var(--radius-sm)] border-0 bg-accent text-[12px] font-semibold text-[#0A0B0E] cursor-pointer hover:brightness-110 transition-all duration-[var(--dur-state)] active:scale-[0.97] disabled:opacity-35 disabled:pointer-events-none"
              >
                Send to the rig
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
