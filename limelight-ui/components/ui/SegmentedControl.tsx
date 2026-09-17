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

/* A segmented control, one implementation. The selected segment is a raised
   surface rather than a colour wash, so the group reads as one object with one
   piece pushed forward instead of four buttons that happen to sit together. */
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
      className="inline-flex h-[var(--control-h)] items-center rounded-[var(--radius-sm)] p-[3px] gap-[2px]"
      style={{ background: "var(--surface-1)", border: "1px solid var(--edge)" }}
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
            className={`h-full px-[13px] rounded-[5px] border-0 text-[12px] font-semibold cursor-pointer
              transition-[color,background-color,box-shadow] duration-150 ease-[var(--ease)]
              ${on ? "text-ink" : "bg-transparent text-ink-dimmer hover:text-ink-dim"}`}
            style={on ? { background: "var(--surface-3)", boxShadow: "var(--elev-1), var(--inset-hi)" } : undefined}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
