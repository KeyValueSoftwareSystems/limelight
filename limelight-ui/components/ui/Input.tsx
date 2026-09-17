"use client";

import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  wide?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ wide, className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`liquid-well h-[var(--control-h)] px-[11px] rounded-[var(--radius-sm)]
          text-[13px] text-ink outline-none placeholder:text-ink-dimmer
          ${wide ? "flex-1 min-w-0" : ""} ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
