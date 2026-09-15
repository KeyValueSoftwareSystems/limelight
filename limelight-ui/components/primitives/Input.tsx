"use client";

import { type InputHTMLAttributes, forwardRef, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  wide?: boolean;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ wide, invalid, className = "", ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`h-[var(--hit)] px-[var(--spacing-s2)] rounded-[5px] bg-bg-sunken border border-solid outline-none text-[length:var(--text-sm)] text-ink transition-colors duration-[var(--dur-state)] disabled:opacity-40 ${
        invalid ? "border-danger" : "border-line-strong focus:border-ink-dim"
      } ${wide ? "w-full" : ""} ${className}`}
      {...props}
    />
  ),
);
Input.displayName = "Input";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}

/** Pairs a label with whatever control it describes, wiring up the id so the
 *  label is clickable and the hint is announced. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {error ? (
        <span className="text-[length:var(--text-xs)] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[length:var(--text-xs)] text-ink-dimmer">{hint}</span>
      ) : null}
    </div>
  );
}
