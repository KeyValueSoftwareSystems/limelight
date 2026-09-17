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
      className={`group flex flex-col text-left p-0 border border-solid border-white/[0.06] rounded-[var(--radius-md)] overflow-hidden text-inherit transition-all duration-200 ease-[var(--ease)] ${
        onClick && !disabled
          ? "cursor-pointer hover:border-accent/25 hover:-translate-y-[2px]"
          : ""
      } ${disabled ? "cursor-default opacity-40" : ""} ${className}`}
      style={{
        background: "linear-gradient(180deg, rgba(239, 231, 215, 0.04) 0%, rgba(239, 231, 215, 0.01) 100%)",
        boxShadow: "var(--elev-card)",
      }}
      onMouseEnter={(e) => {
        if (onClick && !disabled) {
          (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card-hover)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--elev-card)";
      }}
    >
      {children}
    </Tag>
  );
}
