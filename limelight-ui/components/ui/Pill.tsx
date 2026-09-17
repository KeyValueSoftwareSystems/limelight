"use client";

type PillState = "off" | "live" | "armed" | "dead" | "unknown";

interface PillProps {
  state: PillState;
  children: React.ReactNode;
  title?: string;
}

const stateStyles: Record<PillState, string> = {
  off: "bg-bg-raised text-ink-dimmer",
  live: "bg-ok/15 text-ok border-ok/30",
  armed: "bg-warn/10 text-warn border-warn/30",
  dead: "bg-danger/10 text-danger border-danger/30",
  unknown: "bg-bg-raised text-ink-dimmer",
};

export function Pill({ state, children, title }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-[6px] whitespace-nowrap px-[10px] py-[4px] rounded-full border border-solid text-[11px] font-medium tracking-[0.02em] tabular-nums transition-colors duration-[var(--dur-state)] ${stateStyles[state]}`}
      title={title}
    >
      {(state === "live" || state === "armed") && (
        <span
          className={`w-[5px] h-[5px] rounded-full flex-none ${state === "live" ? "bg-ok animate-sending" : "bg-warn"}`}
        />
      )}
      {children}
    </span>
  );
}
