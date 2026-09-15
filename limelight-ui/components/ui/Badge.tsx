"use client";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "accent" | "warn" | "danger" | "ok";
  className?: string;
}

const variantStyles: Record<string, string> = {
  default: "border-line text-dim",
  accent: "border-accent text-accent bg-accent-soft",
  warn: "border-warn text-warn",
  danger: "border-danger text-danger",
  ok: "border-ok text-ok",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-block px-[9px] py-[3px] border border-solid rounded-full text-[length:var(--text-sm)] ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
