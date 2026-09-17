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
  big: `${base} h-[var(--hit)] px-[16px] bg-white/[0.03] border border-solid border-white/[0.08] rounded-[var(--radius-sm)] text-[13px] font-medium hover:bg-white/[0.06] hover:border-white/[0.14] active:scale-[0.98]`,
  ghost: `${base} inline-flex items-center h-[var(--hit)] px-[14px] bg-white/[0.03] border border-solid border-white/[0.06] rounded-[var(--radius-sm)] text-[12px] font-medium text-ink-dim hover:text-ink hover:bg-white/[0.06] hover:border-accent/20 active:scale-[0.98]`,
  primary: `${base} inline-flex items-center h-[var(--hit)] px-[18px] border-0 rounded-[var(--radius-sm)] text-[13px] font-semibold hover:brightness-[1.06] active:scale-[0.98]`,
  link: `${base} border-0 bg-transparent px-[6px] py-[2px] text-[12px] text-accent hover:text-accent hover:underline rounded-[var(--radius-sm)]`,
  panic: `${base} min-h-[var(--hit)] p-[8px] bg-danger/[0.06] border-2 border-solid border-danger/40 rounded-[var(--radius-sm)] text-[13px] font-semibold text-danger hover:bg-danger/[0.12] hover:border-danger/60 active:scale-[0.98]`,
  icon: `${base} border-0 bg-transparent p-[6px] rounded-[var(--radius-sm)] text-ink-dim hover:text-ink hover:bg-white/[0.06] active:scale-[0.95]`,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", active, wide, className = "", style, ...props }, ref) => {
    const cls = [variants[variant], wide ? "w-full" : "", className]
      .filter(Boolean)
      .join(" ");

    const activeStyle = active
      ? { background: "var(--lit-face)", borderColor: "transparent", color: "var(--lit-ink)", boxShadow: "var(--lit-edge), var(--lit-halo)" }
      : undefined;

    const primaryStyle = variant === "primary" && !active
      ? { background: "var(--lit-face)", color: "var(--lit-ink)", boxShadow: "var(--lit-edge), var(--lit-halo)" }
      : undefined;

    return (
      <button ref={ref} type="button" className={cls} style={{ ...activeStyle, ...primaryStyle, ...style }} {...props} />
    );
  },
);
Button.displayName = "Button";
