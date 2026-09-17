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
      className={`group flex flex-col text-left p-0 border-0 rounded-[var(--radius-md)] bg-bg-raised overflow-hidden text-inherit transition-all duration-[var(--dur-state)] ${
        onClick && !disabled
          ? "cursor-pointer hover:bg-bg-overlay hover:shadow-[var(--elev-card-hover)] hover:-translate-y-[1px]"
          : ""
      } ${disabled ? "cursor-default opacity-50" : ""} shadow-[var(--elev-card)] ${className}`}
    >
      {children}
    </Tag>
  );
}
