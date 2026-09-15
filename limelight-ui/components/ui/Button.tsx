"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "default" | "big" | "link" | "panic" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  wide?: boolean;
}

const base =
  "cursor-pointer border-0 bg-transparent font-body text-inherit transition-colors disabled:cursor-default disabled:text-dimmer";

const variants: Record<Variant, string> = {
  default: `${base} px-[var(--spacing-s3)] py-[3px] text-[length:var(--text-xs)] tracking-[0.14em] uppercase text-dim hover:text-ink`,
  big: `${base} h-[var(--hit)] px-[var(--spacing-s3)] border border-solid border-line-strong rounded-[5px] text-[length:var(--text-sm)] tracking-[0.14em] uppercase hover:bg-accent-soft disabled:border-line disabled:bg-transparent`,
  link: `${base} px-[6px] py-1 text-[length:var(--text-xs)] tracking-[0.14em] uppercase text-dim hover:text-ink`,
  panic: `${base} min-h-[var(--hit)] p-[var(--spacing-s2)] border-2 border-solid border-line-strong rounded-[6px] text-[length:var(--text-sm)] font-medium tracking-[0.12em] uppercase hover:bg-accent-soft`,
  icon: `${base} p-1`,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", active, wide, className = "", ...props }, ref) => {
    const cls = [
      variants[variant],
      active ? "bg-accent border-accent text-bg" : "",
      wide ? "w-full" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return <button ref={ref} type="button" className={cls} {...props} />;
  },
);
Button.displayName = "Button";
