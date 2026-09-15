"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  wide?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-[var(--spacing-s2)] h-[var(--hit)] " +
  "px-[var(--spacing-s3)] rounded-[5px] border border-solid cursor-pointer " +
  "text-[length:var(--text-sm)] whitespace-nowrap " +
  "transition-colors duration-[var(--dur-state)] " +
  "disabled:cursor-default disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-bg border-ink hover:opacity-90",
  secondary: "bg-bg-raised text-ink border-line-strong hover:border-ink-dim",
  ghost: "bg-transparent text-ink-dim border-transparent hover:text-ink hover:bg-bg-raised",
  danger: "bg-transparent text-danger border-danger hover:bg-danger hover:text-bg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", wide, className = "", ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`${base} ${variants[variant]} ${wide ? "w-full" : ""} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, className = "", children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`inline-flex items-center justify-center w-[var(--hit)] h-[var(--hit)] rounded-[5px] border border-solid cursor-pointer transition-colors duration-[var(--dur-state)] disabled:cursor-default disabled:opacity-40 ${
        active
          ? "bg-bg-raised text-ink border-line-strong"
          : "bg-transparent text-ink-dim border-transparent hover:text-ink hover:bg-bg-raised"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";
