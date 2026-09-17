"use client";

import { Star } from "lucide-react";

/** Five stars, filled to the rating. Half marks read as half a star. */
export function Stars({ rating, size = 11 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[1px]" aria-label={`${rating} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-ink-dimmer" strokeWidth={1.6} />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star
                size={size}
                className="text-warn"
                strokeWidth={1.6}
                fill="currentColor"
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** The tick, for a designer whose catalogue is real. */
export function Verified({ size = 12 }: { size?: number }) {
  return (
    <span
      title="Verified designer"
      className="inline-flex items-center justify-center rounded-full flex-none"
      style={{ width: size + 3, height: size + 3, background: "var(--accent)" }}
    >
      <svg width={size - 3} height={size - 3} viewBox="0 0 10 10" aria-hidden>
        <path
          d="M1.6 5.2 L4 7.5 L8.4 2.8"
          fill="none"
          stroke="#05070C"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">Verified designer</span>
    </span>
  );
}
