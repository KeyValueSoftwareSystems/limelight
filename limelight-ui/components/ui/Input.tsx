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
        className={`h-[var(--hit)] px-[var(--spacing-s2)] text-[length:var(--text-md)] bg-panel border border-solid border-line-strong rounded outline-none text-inherit focus:border-accent ${wide ? "flex-1 min-w-0" : ""} ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
