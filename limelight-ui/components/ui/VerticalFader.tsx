"use client";

import { useCallback, useRef } from "react";

interface VerticalFaderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue: string;
  height?: number;
  onChange: (value: number) => void;
}

export function VerticalFader({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  displayValue,
  height = 90,
  onChange,
}: VerticalFaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const thumbBottom = fill;

  const valFromY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return value;
      const r = el.getBoundingClientRect();
      const pct = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      const raw = min + pct * (max - min);
      return step > 0 ? Math.round(raw / step) * step : raw;
    },
    [min, max, step, value],
  );

  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      onChange(valFromY(e.clientY));
      const move = (ev: PointerEvent) => onChange(valFromY(ev.clientY));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onChange, valFromY],
  );

  return (
    <div className="gma-fader-unit select-none">
      <span className="gma-fader-readout">{displayValue}</span>
      <div ref={trackRef} className="gma-fader-slot" style={{ height }} onPointerDown={start}>
        <div className="gma-fader-groove" />
        <div className="gma-fader-fill-glow" style={{ height: `${fill}%` }} />
        <div className="gma-fader-cap" style={{ bottom: `calc(${thumbBottom}% - 13px)` }}>
          <div className="gma-fader-grip" />
          <div className="gma-fader-grip" />
          <div className="gma-fader-grip" />
        </div>
      </div>
      <span className="gma-fader-label">{label}</span>
    </div>
  );
}

interface ConsoleKnobProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  displayValue: string;
  onChange: (value: number) => void;
}

export function ConsoleKnob({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  displayValue,
  onChange,
}: ConsoleKnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startValRef = useRef(0);
  const pct = max > min ? (value - min) / (max - min) : 0;
  const angle = -135 + pct * 270;

  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;
      startValRef.current = value;
      const move = (ev: PointerEvent) => {
        const dy = startYRef.current - ev.clientY;
        const range = max - min;
        const raw = startValRef.current + (dy / 120) * range;
        const clamped = Math.max(min, Math.min(max, raw));
        onChange(step > 0 ? Math.round(clamped / step) * step : clamped);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [value, min, max, step, onChange],
  );

  return (
    <div className="gma-knob-unit select-none">
      <div ref={knobRef} className="gma-knob" onPointerDown={start}>
        <div className="gma-knob-body" style={{ transform: `rotate(${angle}deg)` }}>
          <div className="gma-knob-indicator" />
        </div>
        <svg className="gma-knob-arc" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2"
            strokeDasharray={`${pct * 188.5} 999`}
            strokeLinecap="round"
            transform="rotate(-225 24 24)"
          />
          <circle cx="24" cy="24" r="20" fill="none" stroke="var(--accent)" strokeWidth="2"
            strokeDasharray={`${pct * 188.5} 999`}
            strokeLinecap="round"
            transform="rotate(-225 24 24)"
            opacity="0.7"
          />
        </svg>
      </div>
      <span className="gma-knob-value">{displayValue}</span>
      <span className="gma-knob-label">{label}</span>
    </div>
  );
}

interface ConsoleButtonProps {
  label: string;
  active?: boolean;
  tone?: "amber" | "red" | "blue" | "green" | "default";
  onClick?: () => void;
  onDown?: () => void;
  onUp?: () => void;
}

export function ConsoleButton({
  label,
  active = false,
  tone = "default",
  onClick,
  onDown,
  onUp,
}: ConsoleButtonProps) {
  const isHold = !!onDown;
  return (
    <button
      type="button"
      onClick={!isHold ? onClick : undefined}
      onPointerDown={isHold ? (e) => { e.currentTarget.setPointerCapture(e.pointerId); onDown?.(); } : undefined}
      onPointerUp={isHold ? onUp : undefined}
      onPointerCancel={isHold ? onUp : undefined}
      onLostPointerCapture={isHold ? onUp : undefined}
      className={`gma-btn ${active ? "gma-btn-active" : ""}`}
      data-tone={tone}
    >
      <span className="gma-btn-led" />
      {label}
    </button>
  );
}
