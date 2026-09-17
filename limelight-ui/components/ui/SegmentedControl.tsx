"use client";

interface Segment<T extends string> {
  id: T;
  label: string;
}

interface Props<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  ...rest
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={rest["aria-label"]}
      className="inline-flex h-[var(--control-h)] items-stretch gap-[3px] p-[3px] rounded-[9px]"
      style={{ background: "var(--well-face)", boxShadow: "var(--well-edge)" }}
    >
      {segments.map((s) => {
        const on = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(s.id)}
            className={`relative h-full px-[13px] rounded-[6px] border-0 cursor-pointer
              text-[12.5px] font-medium tracking-[-0.004em]
              transition-[color,box-shadow,background] duration-[var(--dur-state)]
              ${on ? "text-ink" : "text-ink-dimmer hover:text-ink-dim"}`}
            style={
              on
                ? { background: "var(--key-on-face)", boxShadow: "var(--key-on-edge)" }
                : { background: "transparent" }
            }
          >
            {on && (
              <span
                aria-hidden
                className="absolute left-[9px] right-[9px] top-[4px] h-[2px] rounded-full"
                style={{ background: "var(--accent)", boxShadow: "0 0 8px 0 var(--accent-glow)" }}
              />
            )}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
