"use client";

interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A raised region with an optional header. Hierarchy from elevation and a
 *  hairline, never from a drawn box. */
export function Panel({
  title,
  actions,
  children,
  className = "",
}: PanelProps) {
  return (
    <section
      className={`flex flex-col min-h-0 bg-bg-raised border border-solid border-line rounded-[7px] overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <header className="flex-none flex items-center justify-between gap-[var(--spacing-s3)] px-[var(--spacing-s4)] py-[var(--spacing-s3)] border-b border-solid border-line">
          {title && <span className="label">{title}</span>}
          {actions}
        </header>
      )}
      <div className="flex-1 min-h-0 p-[var(--spacing-s4)]">{children}</div>
    </section>
  );
}

interface EmptyStateProps {
  title: string;
  /** Say what to do next, not that a count is zero. */
  body: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-[var(--spacing-s2)] py-[var(--spacing-s7)] px-[var(--spacing-s5)]">
      <p className="text-[length:var(--text-md)] text-ink">{title}</p>
      <p className="text-[length:var(--text-sm)] text-ink-dim max-w-[38ch]">
        {body}
      </p>
      {action && <div className="mt-[var(--spacing-s2)]">{action}</div>}
    </div>
  );
}
