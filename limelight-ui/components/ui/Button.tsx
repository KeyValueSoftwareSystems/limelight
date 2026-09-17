"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "default" | "big" | "ghost" | "primary" | "link" | "panic" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  wide?: boolean;
}

const base =
  "cursor-pointer font-body text-inherit transition-all duration-200 ease-[var(--ease)] disabled:cursor-default disabled:opacity-35 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  default: `${base} border-0 bg-transparent px-[10px] py-[4px] text-[13px] text-ink-dim hover:text-ink hover:bg-white/[0.04] rounded-[var(--radius-sm)]`,
  big: `${base} liquid liquid-key liquid-accent h-[var(--control-h)] px-[18px] rounded-[var(--radius-sm)] text-[13px] font-semibold`,
  ghost: `${base} inline-flex items-center h-[var(--hit)] px-[14px] bg-white/[0.03] border border-solid border-white/[0.06] rounded-[var(--radius-sm)] text-[12px] font-medium text-ink-dim hover:text-ink hover:bg-white/[0.06] hover:border-accent/20 active:scale-[0.98]`,
  primary: `${base} liquid liquid-key liquid-accent inline-flex items-center justify-center h-[var(--control-h)] px-[15px] rounded-[var(--radius-sm)] text-[13px] font-semibold tracking-[-0.004em]`,
  link: `${base} border-0 bg-transparent px-[6px] py-[2px] text-[12px] text-accent hover:text-accent hover:underline rounded-[var(--radius-sm)]`,
  panic: `${base} min-h-[var(--hit)] p-[8px] bg-danger/[0.06] border-2 border-solid border-danger/40 rounded-[var(--radius-sm)] text-[13px] font-semibold text-danger hover:bg-danger/[0.12] hover:border-danger/60 active:scale-[0.98]`,
  icon: `${base} border-0 bg-transparent p-[6px] rounded-[var(--radius-sm)] text-ink-dim hover:text-ink hover:bg-white/[0.06] active:scale-[0.95]`,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", active, wide, className = "", style, ...props }, ref) => {
    const cls = [variants[variant], wide ? "w-full" : "", className]
      .filter(Boolean)
      .join(" ");

    const mat = variant === "primary" ? "" : active ? "liquid-well" : "liquid liquid-key";

    return (
      <button
        ref={ref}
        type="button"
        className={`${cls} ${mat}`.trim()}
        style={style}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
