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
      className="liquid-well inline-flex h-[var(--control-h)] items-stretch gap-[2px] p-[2px] rounded-[7px]"
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
            className={`h-full px-[14px] rounded-[5px] border-0 cursor-pointer
              text-[12.5px] tracking-[-0.004em] transition-colors duration-[var(--dur-state)]
              ${on ? "liquid liquid-key font-medium text-ink" : "bg-transparent font-normal text-ink-dim hover:text-ink"}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
