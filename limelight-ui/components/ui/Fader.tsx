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
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-baseline justify-between gap-[var(--spacing-s2)]">
        <b className="text-[length:var(--text-md)] font-medium">{label}</b>
        <span className="font-mono text-[length:var(--text-md)] text-dim tabular-nums">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <div className="text-[length:var(--text-xs)] text-dimmer">{hint}</div>
      )}
    </div>
  );
}
