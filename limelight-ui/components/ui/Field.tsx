"use client";

import { type InputHTMLAttributes, type ReactNode, forwardRef } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  wide?: boolean;
}

/* One text field for the whole app. Every page was rolling its own with its
   own height, border colour and focus shadow, which is why no two looked
   alike. Focus is left to the global :focus-visible ring so a field never
   draws two of them. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ icon, wide, className = "", ...props }, ref) => (
    <div className={`relative ${wide ? "flex-1 min-w-0" : ""}`}>
      {icon && (
        <span className="absolute left-[12px] top-1/2 -translate-y-1/2 text-ink-dimmer pointer-events-none flex items-center">
          {icon}
        </span>
      )}
      <input
        ref={ref}
        className={`w-full h-[var(--control-h)] ${icon ? "pl-[36px]" : "pl-[12px]"} pr-[12px]
          rounded-[var(--radius-sm)] border border-solid text-[13px] font-medium text-ink
          transition-[background-color,border-color] duration-150 ease-[var(--ease)]
          placeholder:text-ink-dimmer placeholder:font-normal
          ${className}`}
        style={{ background: "var(--well-face)", borderColor: "transparent", boxShadow: "var(--well-edge)" }}
        {...props}
      />
    </div>
  ),
);
Field.displayName = "Field";
