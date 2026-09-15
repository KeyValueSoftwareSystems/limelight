"use client";

import { type SelectHTMLAttributes, forwardRef } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = "", ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`h-[var(--hit)] px-[var(--spacing-s2)] text-[length:var(--text-md)] bg-panel border border-solid border-line-strong rounded outline-none text-inherit focus:border-accent ${className}`}
        {...props}
      />
    );
  },
);
Select.displayName = "Select";
