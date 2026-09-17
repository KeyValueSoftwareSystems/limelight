"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "default" | "big" | "ghost" | "primary" | "link" | "panic" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  wide?: boolean;
}

const base =
  "cursor-pointer font-body text-inherit transition-all duration-[var(--dur-state)] disabled:cursor-default disabled:opacity-40";

const bare = "border-0 bg-transparent";

const variants: Record<Variant, string> = {
  default: `${base} ${bare} px-[12px] py-[3px] text-[12px] tracking-[0.04em] text-ink-dim hover:text-ink`,
  big: `${base} h-[var(--hit)] px-[14px] bg-transparent border border-solid border-line-strong rounded-[6px] text-[13px] tracking-[0.04em] hover:bg-accent-soft`,
  ghost: `${base} inline-flex items-center h-[var(--hit)] px-[14px] bg-bg-raised border border-solid border-line-strong rounded-[6px] text-[12px] tracking-[0.04em] text-ink-dim hover:text-ink hover:border-line-strong`,
  primary: `${base} inline-flex items-center h-[var(--hit)] px-[16px] bg-accent border border-solid border-accent rounded-[6px] text-[13px] tracking-[0.02em] text-[#0B0C0E] font-medium hover:brightness-110`,
  link: `${base} ${bare} px-[6px] py-1 text-[12px] tracking-[0.04em] text-ink-dim hover:text-ink`,
  panic: `${base} min-h-[var(--hit)] p-[8px] bg-transparent border-2 border-solid border-danger rounded-[6px] text-[13px] font-medium tracking-[0.04em] hover:bg-danger/10`,
  icon: `${base} ${bare} p-[4px] rounded-[4px] hover:bg-bg-raised`,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", active, wide, className = "", style, ...props }, ref) => {
    const cls = [variants[variant], wide ? "w-full" : "", className]
      .filter(Boolean)
      .join(" ");
    const on = active
      ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--bg)" }
      : undefined;
    return (
      <button ref={ref} type="button" className={cls} style={{ ...on, ...style }} {...props} />
    );
  },
);
Button.displayName = "Button";
