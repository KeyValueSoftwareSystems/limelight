"use client";

type PillState = "off" | "live" | "armed" | "dead" | "unknown";

interface PillProps {
  state: PillState;
  children: React.ReactNode;
  title?: string;
}

const stateStyles: Record<PillState, string> = {
  off: "border-line text-dim",
  live: "bg-ok border-ok text-[#05130c]",
  armed: "border-warn text-warn",
  dead: "border-danger text-danger",
  unknown: "border-line text-dim",
};

export function Pill({ state, children, title }: PillProps) {
  return (
    <span
      className={`inline-block whitespace-nowrap px-[10px] py-[5px] rounded-full border text-[length:var(--text-xs)] tracking-[0.12em] uppercase tabular-nums ${stateStyles[state]}`}
      title={title}
    >
      {children}
    </span>
  );
}
