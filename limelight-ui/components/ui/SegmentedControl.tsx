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
      className="inline-flex h-[var(--control-h)] items-stretch gap-[20px]"
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
            className={`group relative h-full border-0 bg-transparent px-0 cursor-pointer
              text-[13px] font-medium tracking-[-0.006em]
              transition-colors duration-[var(--dur-state)]
              ${on ? "text-ink" : "text-ink-dimmer hover:text-ink-dim"}`}
          >
            {s.label}
            <span
              aria-hidden
              className={`absolute left-0 right-0 bottom-[7px] h-[2px] rounded-full transition-opacity duration-[var(--dur-state)]
                ${on ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}
              style={{ background: "var(--accent)", boxShadow: "0 -5px 12px -2px var(--accent-glow)" }}
            />
          </button>
        );
      })}
    </div>
  );
}
