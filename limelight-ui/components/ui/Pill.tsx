"use client";

type State = "live" | "ready" | "warn" | "error" | "off" | "sending";

interface PillProps {
  state: State;
  label: string;
  onClick?: () => void;
}

const styles: Record<State, { bg: string; border: string; dot: string; text: string }> = {
  live: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)", dot: "#10B981", text: "#6EE7B7" },
  ready: { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)", dot: "#3B82F6", text: "#93C5FD" },
  warn: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", dot: "#F59E0B", text: "#FCD34D" },
  error: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", dot: "#EF4444", text: "#FCA5A5" },
  off: { bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.06)", dot: "#555A6B", text: "#8E93A3" },
  sending: { bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.15)", dot: "#10B981", text: "#6EE7B7" },
};

export function Pill({ state, label, onClick }: PillProps) {
  const s = styles[state] || styles.off;
  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-[6px] h-[26px] px-[10px] rounded-full text-[11px] font-medium transition-all duration-200 ${
        onClick ? "cursor-pointer hover:brightness-110" : ""
      }`}
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.text,
      }}
    >
      <span
        className={`w-[6px] h-[6px] rounded-full flex-none ${state === "live" || state === "sending" ? "animate-sending" : ""}`}
        style={{ background: s.dot }}
      />
      {label}
    </Tag>
  );
}
