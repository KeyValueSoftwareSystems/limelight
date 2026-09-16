"use client";

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "default" | "big" | "ghost" | "primary" | "link" | "panic" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  wide?: boolean;
}

/* No border or background in `base`: a variant owns both. While base carried
   `border-0 bg-transparent`, those fought the variant's own `border` and
   `bg-*` — same property, so the winner was decided by Tailwind's stylesheet
   order rather than the order written here, and every bordered variant
   silently rendered flat. */
const base =
  "cursor-pointer font-body text-inherit transition-colors duration-[var(--dur-state)] disabled:cursor-default disabled:text-dimmer";

/** For the variants that really are just text. */
const bare = "border-0 bg-transparent";

const variants: Record<Variant, string> = {
  default: `${base} ${bare} px-[var(--spacing-s3)] py-[3px] text-[length:var(--text-xs)] tracking-[0.14em] uppercase text-dim hover:text-ink`,
  big: `${base} h-[var(--hit)] px-[var(--spacing-s3)] bg-transparent border border-solid border-line-strong rounded-[5px] text-[length:var(--text-sm)] tracking-[0.14em] uppercase hover:bg-accent-soft disabled:border-line disabled:bg-transparent`,
  /* An actual button: a surface and a rim, so it reads as pressable next to a
     heading. `link` looked identical to the labels around it. */
  ghost: `${base} inline-flex items-center h-[var(--hit)] px-[var(--spacing-s3)] bg-panel border border-solid border-line-strong rounded-[4px] text-[length:var(--text-xs)] tracking-[0.1em] uppercase text-dim hover:text-ink hover:border-ink-dimmer disabled:border-line disabled:bg-transparent`,
  primary: `${base} inline-flex items-center h-[var(--hit)] px-[var(--spacing-s4)] bg-accent border border-solid border-accent rounded-[4px] text-[length:var(--text-xs)] tracking-[0.1em] uppercase text-bg font-medium hover:brightness-110 disabled:bg-transparent disabled:border-line disabled:text-dimmer`,
  link: `${base} ${bare} px-[6px] py-1 text-[length:var(--text-xs)] tracking-[0.14em] uppercase text-dim hover:text-ink`,
  panic: `${base} min-h-[var(--hit)] p-[var(--spacing-s2)] bg-transparent border-2 border-solid border-line-strong rounded-[6px] text-[length:var(--text-sm)] font-medium tracking-[0.12em] uppercase hover:bg-accent-soft`,
  icon: `${base} ${bare} p-1`,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", active, wide, className = "", style, ...props }, ref) => {
    const cls = [variants[variant], wide ? "w-full" : "", className]
      .filter(Boolean)
      .join(" ");
    /* Inline, not a class: `active` has to beat whatever background and border
       the variant already set, and two utilities for one property resolve by
       stylesheet order, which this component cannot control. */
    const on = active
      ? { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--bg)" }
      : undefined;
    return (
      <button ref={ref} type="button" className={cls} style={{ ...on, ...style }} {...props} />
    );
  },
);
Button.displayName = "Button";
