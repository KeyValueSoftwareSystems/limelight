"use client";

/** The MediaCard's own shape while it waits, so nothing jumps when it arrives. */
export function CardSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="card-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="panel flex flex-col rounded-[var(--radius-lg)] overflow-hidden animate-in"
          style={{ animationDelay: `${Math.min(i * 45, 360)}ms` }}
        >
          <div className="w-full aspect-[3/2] skeleton rounded-none" />
          <div className="flex flex-col gap-[8px] px-[14px] pt-[13px] pb-[14px]">
            <div className="h-[13px] w-[68%] skeleton" />
            <div className="h-[10px] w-[44%] skeleton" />
            <div className="h-[10px] w-full skeleton mt-[3px]" />
            <div className="h-[10px] w-[82%] skeleton" />
            <div className="flex gap-[5px] mt-[3px]">
              <div className="h-[17px] w-[54px] skeleton rounded-full" />
              <div className="h-[17px] w-[40px] skeleton rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
