"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "default" | "big" | "ghost" | "primary" | "link" | "panic" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  wide?: boolean;
}

const base =
  "cursor-pointer font-body text-inherit transition-all duration-[var(--dur-state)] ease-[var(--ease)] disabled:cursor-default disabled:opacity-35 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  default: `${base} border-0 bg-transparent px-[10px] py-[4px] text-[13px] text-ink-dim hover:text-ink rounded-[var(--radius-sm)]`,
  big: `${base} h-[var(--hit)] px-[16px] bg-transparent border border-solid border-line-strong rounded-[var(--radius-sm)] text-[13px] font-medium hover:bg-bg-raised hover:border-line-strong active:scale-[0.98]`,
  ghost: `${base} inline-flex items-center h-[var(--hit)] px-[14px] bg-bg-raised/60 border border-solid border-line rounded-[var(--radius-sm)] text-[12px] font-medium text-ink-dim hover:text-ink hover:bg-bg-raised hover:border-line-strong active:scale-[0.98]`,
  primary: `${base} inline-flex items-center h-[var(--hit)] px-[18px] bg-accent border-0 rounded-[var(--radius-sm)] text-[13px] font-semibold text-[#0A0B0E] shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] hover:brightness-110 active:scale-[0.97] active:brightness-95`,
  link: `${base} border-0 bg-transparent px-[6px] py-[2px] text-[12px] text-ink-dim hover:text-ink rounded-[var(--radius-sm)]`,
  panic: `${base} min-h-[var(--hit)] p-[8px] bg-transparent border-2 border-solid border-danger/60 rounded-[var(--radius-sm)] text-[13px] font-semibold hover:bg-danger/10 hover:border-danger active:scale-[0.98]`,
  icon: `${base} border-0 bg-transparent p-[6px] rounded-[var(--radius-sm)] text-ink-dim hover:text-ink hover:bg-bg-raised active:scale-[0.95]`,
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
