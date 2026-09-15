"use client";

interface CardProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function Card({ children, onClick, disabled, className = "" }: CardProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={!disabled ? onClick : undefined}
      className={`flex flex-col text-left p-0 border border-solid border-line rounded-[7px] bg-panel overflow-hidden text-inherit ${
        onClick && !disabled ? "cursor-pointer hover:border-accent" : ""
      } ${disabled ? "cursor-default opacity-[0.62]" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
