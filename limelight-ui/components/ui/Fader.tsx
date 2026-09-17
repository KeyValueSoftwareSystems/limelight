"use client";

interface FaderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue: string;
  hint?: string;
  onChange: (value: number) => void;
}

export function Fader({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  displayValue,
  hint,
  onChange,
}: FaderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="mono text-[11.5px] text-ink-dim tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        className="fader"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="m-0 text-[11px] text-ink-dimmer leading-[1.5]">{hint}</p>}
    </div>
  );
}
