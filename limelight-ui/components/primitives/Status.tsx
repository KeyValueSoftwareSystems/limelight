"use client";

type Tone = "neutral" | "ok" | "warn" | "danger";

const toneText: Record<Tone, string> = {
  neutral: "text-ink-dim border-line",
  ok: "text-ok border-ok",
  warn: "text-warn border-warn",
  danger: "text-danger border-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block px-[9px] py-[3px] rounded-full border border-solid text-[length:var(--text-xs)] whitespace-nowrap ${toneText[tone]}`}
    >
      {children}
    </span>
  );
}

const toneDot: Record<Tone, string> = {
  neutral: "bg-ink-dimmer",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** State is carried by the label as well as the colour — a dot alone is not a
 *  status, and colour alone is not an accessible signal. */
export function StatusDot({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-[var(--spacing-s2)] text-[length:var(--text-xs)] text-ink-dim whitespace-nowrap"
      title={title}
    >
      <span className={`w-[7px] h-[7px] rounded-full flex-none ${toneDot[tone]}`} />
      {children}
    </span>
  );
}
