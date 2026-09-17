"use client";

type State = "live" | "ready" | "warn" | "error" | "off" | "sending";

interface PillProps {
  state: State;
  label: string;
  onClick?: () => void;
}

const styles: Record<State, { bg: string; border: string; dot: string; text: string }> = {
  live: { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", dot: "#34D399", text: "#6EE7B7" },
  ready: { bg: "rgba(129,140,248,0.08)", border: "rgba(129,140,248,0.25)", dot: "#818CF8", text: "#A5B4FC" },
  warn: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.25)", dot: "#FBBF24", text: "#FDE68A" },
  error: { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.25)", dot: "#F87171", text: "#FCA5A5" },
  off: { bg: "rgba(139,92,246,0.04)", border: "rgba(139,92,246,0.1)", dot: "#5A5F78", text: "#9095AD" },
  sending: { bg: "rgba(52,211,153,0.06)", border: "rgba(52,211,153,0.2)", dot: "#34D399", text: "#6EE7B7" },
};

export function Pill({ state, label, onClick }: PillProps) {
  const s = styles[state] || styles.off;
  const Tag = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-[6px] h-[26px] px-[10px] rounded-full text-[11px] font-semibold transition-all duration-200 ${
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
