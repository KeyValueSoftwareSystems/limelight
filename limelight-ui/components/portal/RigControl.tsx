"use client";

import { useState, useCallback } from "react";
import { usePortalStore } from "@/store/portal";
import type { RigStatus } from "@/lib/types";

type RigState = "ready" | "unreachable" | "sending" | "off";

interface RigInfo {
  state: RigState;
  colour: string;
  headline: string;
  detail: string;
  remedy: string | null;
  action: "send" | "stop" | "retry" | null;
}

function diagnose(r: RigStatus | null, hasShow: boolean): RigInfo {
  if (!r)
    return {
      state: "unreachable",
      colour: "var(--danger)",
      headline: "Portal unreachable",
      detail: "Cannot connect to the lighting server.",
      remedy: "Check that the portal process is running.",
      action: "retry",
    };

  if (!r.can_send)
    return {
      state: "unreachable",
      colour: "var(--warn)",
      headline: "No output",
      detail: r.why_not ?? "The Art-Net socket is not open.",
      remedy: r.why_not
        ? "Check the cable and the network interface."
        : null,
      action: "retry",
    };

  if (r.sending)
    return {
      state: "sending",
      colour: "var(--ok)",
      headline: `Sending · ${r.frames_sent.toLocaleString()} frames`,
      detail: `40 fps → Art-Net ${r.gateway} universe ${r.universe}`,
      remedy: null,
      action: "stop",
    };

  if (r.armed) {
    if (r.last_error)
      return {
        state: "unreachable",
        colour: "var(--danger)",
        headline: "Send failing",
        detail: r.last_error,
        remedy: "Check the rig connection and retry.",
        action: "retry",
      };
    return {
      state: "ready",
      colour: "var(--ok)",
      headline: `Armed · ${r.frames_sent.toLocaleString()} frames sent`,
      detail: `Socket open to ${r.gateway} universe ${r.universe}`,
      remedy: null,
      action: "stop",
    };
  }

  return {
    state: "ready",
    colour: "var(--ink-dimmer)",
    headline: `Rig ready · universe ${r.universe} · via ${r.route_via ?? r.gateway}`,
    detail: r.conflict
      ? `${r.conflict} · socket open, sending nothing`
      : "Socket open, sending nothing",
    remedy: null,
    action: hasShow && r.can_send ? "send" : null,
  };
}

export function RigControl({ onToggle }: { onToggle: () => void }) {
  const rig = usePortalStore((s) => s.rig);
  const show = usePortalStore((s) => s.show);
  const [expanded, setExpanded] = useState(false);

  const info = diagnose(rig, !!show);
  const isSending = info.state === "sending";
  const canSend = rig?.can_send && !!show;

  const handleRetry = useCallback(() => {
    onToggle();
  }, [onToggle]);

  return (
    <div className="relative flex items-center gap-[8px]">
      {/* Status indicator */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-[8px] px-[10px] h-[var(--hit)] rounded-[6px] border border-solid bg-transparent cursor-pointer transition-colors duration-[var(--dur-state)] hover:bg-bg-raised"
        style={{ borderColor: info.colour === "var(--ink-dimmer)" ? "var(--line)" : info.colour }}
        title={`${info.headline}\n${info.detail}`}
      >
        <span
          className={`w-[7px] h-[7px] rounded-full flex-none ${isSending ? "animate-sending" : ""}`}
          style={{ background: info.colour }}
        />
        <span className="text-[12px] tracking-[0.04em] whitespace-nowrap" style={{ color: info.colour === "var(--ink-dimmer)" ? "var(--ink-dim)" : info.colour }}>
          {info.state === "ready" && !rig?.armed ? "Standby" : info.state === "sending" ? "Sending" : info.state === "unreachable" ? "No output" : "Armed"}
        </span>
      </button>

      {/* Primary action button */}
      {info.action === "send" && (
        <button
          type="button"
          onClick={onToggle}
          disabled={!canSend}
          className="h-[var(--hit)] px-[16px] rounded-[6px] border-0 bg-accent text-[#0B0C0E] text-[13px] font-medium tracking-[0.02em] cursor-pointer transition-all duration-[var(--dur-state)] hover:brightness-110 disabled:opacity-40 disabled:cursor-default"
        >
          Send to the rig
        </button>
      )}
      {info.action === "stop" && (
        <button
          type="button"
          onClick={onToggle}
          className="h-[var(--hit)] px-[16px] rounded-[6px] border border-solid border-danger bg-transparent text-danger text-[13px] font-medium tracking-[0.02em] cursor-pointer transition-colors duration-[var(--dur-state)] hover:bg-danger hover:text-[#0B0C0E]"
        >
          Stop sending
        </button>
      )}

      {/* Expanded detail panel */}
      {expanded && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[340px] rounded-[8px] border border-solid border-line-strong bg-bg-overlay p-[16px] text-[13px]"
          style={{ boxShadow: "var(--elev-popover)" }}
        >
          <div className="flex items-start gap-[10px] mb-[10px]">
            <span
              className={`mt-[3px] w-[8px] h-[8px] rounded-full flex-none ${isSending ? "animate-sending" : ""}`}
              style={{ background: info.colour }}
            />
            <div className="min-w-0">
              <p className="m-0 font-medium text-ink">{info.headline}</p>
              <p className="m-0 mt-[4px] text-[12px] text-ink-dim leading-[1.5]">{info.detail}</p>
            </div>
          </div>

          {info.remedy && (
            <div className="mt-[12px] pt-[12px] border-t border-solid border-line">
              <p className="m-0 text-[12px] text-ink-dim leading-[1.5]">
                <span className="text-warn font-medium">How to fix: </span>
                {info.remedy}
              </p>
              {info.action === "retry" && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-[8px] h-[28px] px-[12px] rounded-[4px] border border-solid border-line-strong bg-bg-raised text-[12px] text-ink cursor-pointer transition-colors duration-[var(--dur-state)] hover:bg-bg-overlay"
                >
                  Retry connection
                </button>
              )}
            </div>
          )}

          {rig && (
            <div className="mt-[12px] pt-[12px] border-t border-solid border-line">
              <div className="grid grid-cols-2 gap-x-[16px] gap-y-[4px] text-[11px]">
                <span className="text-ink-dimmer">Gateway</span>
                <span className="mono text-ink-dim">{rig.gateway}</span>
                <span className="text-ink-dimmer">Universe</span>
                <span className="mono text-ink-dim">{rig.universe}</span>
                <span className="text-ink-dimmer">Route</span>
                <span className="mono text-ink-dim">{rig.route_via ?? "—"}</span>
                <span className="text-ink-dimmer">Frames sent</span>
                <span className="mono text-ink-dim">{rig.frames_sent.toLocaleString()}</span>
                {rig.conflict && (
                  <>
                    <span className="text-ink-dimmer">Conflict</span>
                    <span className="text-warn text-[11px]">{rig.conflict}</span>
                  </>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute top-[10px] right-[10px] w-[24px] h-[24px] flex items-center justify-center rounded-[4px] border-0 bg-transparent text-ink-dimmer cursor-pointer hover:text-ink hover:bg-bg-raised transition-colors"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
