"use client";

interface CardProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

export function Card({ children, onClick, disabled, className = "", title }: CardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={!disabled ? onClick : undefined}
      title={title}
      className={`flex flex-col text-left p-0 border border-solid border-line rounded-[6px] bg-panel overflow-hidden text-inherit transition-colors duration-[var(--dur-state)] ${
        onClick && !disabled ? "cursor-pointer hover:border-ink-dimmer hover:bg-bg-overlay" : ""
      } ${disabled ? "cursor-default opacity-[0.62]" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
