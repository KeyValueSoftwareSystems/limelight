"use client";

import { Play } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The one card. Shows, Venues and Marketplace all draw the same object — 3:2
 * media, a title, a mono line, an optional two-line description, a pill row and
 * a mono footer — and differ only in what they put in it. Three near-identical
 * components is how they drifted apart the first time.
 *
 * It is an <article> rather than a <button> because the pill row is interactive
 * and a button inside a button is not a thing; the whole card still opens on
 * click and on Enter or Space.
 */
export function MediaCard({
  media,
  overlay,
  title,
  meta,
  body,
  tags,
  footer,
  onOpen,
  disabled,
  hint,
}: {
  media: ReactNode;
  overlay?: ReactNode;
  title: string;
  meta?: ReactNode;
  body?: string;
  tags?: ReactNode;
  footer?: ReactNode;
  onOpen?: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  const live = !!onOpen && !disabled;

  return (
    <article
      role={live ? "button" : undefined}
      tabIndex={live ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onClick={live ? onOpen : undefined}
      onKeyDown={
        live
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen!();
              }
            }
          : undefined
      }
      title={hint ?? title}
      className={`panel group flex flex-col h-full rounded-[var(--radius-lg)] overflow-hidden ${
        disabled ? "opacity-70 cursor-default" : live ? "panel-lift cursor-pointer" : "panel-lift"
      }`}
    >
      <div className="relative w-full aspect-[3/2] overflow-hidden">
        {media}

        {live && (
          <div className="absolute inset-0 pointer-events-none bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center">
            <span
              className="w-[34px] h-[34px] rounded-full flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-250 ease-[var(--ease-spring)]"
              style={{
                background: "rgba(236,238,246,0.95)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 2px 10px rgba(0,0,0,0.45)",
              }}
            >
              <Play size={14} fill="#0B0E15" stroke="#0B0E15" className="ml-[1px]" />
            </span>
          </div>
        )}

        {overlay}
      </div>

      <div className="flex flex-col gap-[7px] px-[14px] pt-[12px] pb-[13px] min-w-0 flex-1">
        <div className="min-w-0">
          <span className="block text-[14px] font-semibold tracking-[-0.012em] text-ink truncate">
            {title}
          </span>
          {meta && (
            <span className="block mt-[3px] text-[11.5px] text-ink-dim truncate">{meta}</span>
          )}
        </div>

        {body && (
          <p
            className="m-0 text-[12px] text-ink-dim leading-[1.5] overflow-hidden"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              minHeight: "36px",
            }}
            title={body}
          >
            {body}
          </p>
        )}

        {tags && (
          <div className="flex items-center gap-[5px] flex-nowrap overflow-hidden h-[21px] flex-none">
            {tags}
          </div>
        )}

        {footer && (
          <span className="mono flex items-baseline text-[11px] text-ink-dimmer tabular-nums truncate mt-auto pt-[1px]">
            {footer}
          </span>
        )}
      </div>
    </article>
  );
}

/** The one pill. */
export function CardTag({
  children,
  tone = "plain",
  on,
  onClick,
  hint,
}: {
  children: ReactNode;
  tone?: "plain" | "warn";
  on?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  const base = "px-[7px] py-[2px] rounded-full text-[10.5px] leading-[15px] max-w-full truncate";
  const tint = tone === "warn" ? "text-warn" : on ? "text-ink" : "text-ink-dim";

  if (!onClick) {
    return <span className={`liquid-well ${base} ${tint}`} title={hint}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`${base} ${tint} border-0 cursor-pointer transition-colors duration-[var(--dur-state)] ${
        on ? "liquid liquid-key" : "liquid-well hover:text-ink-dim"
      }`}
    >
      {children}
    </button>
  );
}
