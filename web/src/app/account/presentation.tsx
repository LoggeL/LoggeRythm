import type { ReactNode } from "react";

export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("Ungültiger Speicherwert: eine nicht-negative ganze Zahl wird erwartet.");
  }
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  if (index >= units.length) throw new Error("Ungültiger Speicherwert: der Wert muss kleiner als 1 PB sein.");
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

/** Small state label: a coloured dot plus text on a tinted pill. */
export function Badge({ tone, children }: { tone: "success" | "warning" | "accent" | "neutral"; children: ReactNode }) {
  const tones = {
    success: "bg-success/10 text-success",
    warning: "bg-white/[0.07] text-foreground",
    accent: "bg-accent/15 text-accent-soft",
    neutral: "bg-white/[0.07] text-muted",
  } as const;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {tone !== "accent" && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone === "warning" ? "bg-danger" : "bg-current"}`} />}
      {children}
    </span>
  );
}

export function StatusBadge({ approved }: { approved: boolean }) {
  return <Badge tone={approved ? "success" : "warning"}>{approved ? "Freigegeben" : "Wartet auf Freigabe"}</Badge>;
}

/** A titled group of settings. `action` sits opposite the title. */
export function SettingsCard({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="surface-card min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/12 text-accent-soft">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

/** One setting: label and explanation on the left, its control on the right. */
export function SettingsRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-hairline py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {description && <p className="mt-0.5 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Accessible on/off switch. The whole 44px-high label is the hit target. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the visible text shows the current state. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`inline-flex min-h-11 items-center gap-3 text-sm text-muted ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <span aria-hidden="true" className="min-w-8 text-right">{checked ? "An" : "Aus"}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-white/15 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-foreground after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-soft motion-reduce:transition-none motion-reduce:after:transition-none"
      />
    </label>
  );
}

/**
 * Figure with a mono caption. Cells are separated by hairlines: by default a
 * rule above each cell, or the caller's own cell classes via `className`.
 */
export function Metric({
  value,
  label,
  size = "md",
  truncate = false,
  className = "border-t border-hairline pt-3",
}: {
  value: ReactNode;
  label: string;
  size?: "md" | "lg";
  /** Keep the value on one line; the full text stays available as a tooltip. */
  truncate?: boolean;
  className?: string;
}) {
  const sizes = {
    md: "text-2xl tracking-[-0.03em]",
    lg: "text-[clamp(1.5rem,6.4vw,2.75rem)] tracking-[-0.04em]",
  } as const;
  return (
    <div className={`flex min-w-0 flex-col-reverse justify-end gap-2 ${className}`}>
      <dt className="label-mono [overflow-wrap:anywhere]">{label}</dt>
      <dd
        title={truncate && typeof value === "string" ? value : undefined}
        className={`font-display font-extrabold tabular-nums text-foreground ${sizes[size]} ${truncate ? "-my-[0.15em] truncate py-[0.15em] leading-none" : "leading-none [overflow-wrap:anywhere]"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** Failed section load with the cause and a retry button. */
export function SectionError({ label, error, retrying, onRetry }: { label: string; error: Error; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="error-panel flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 [overflow-wrap:anywhere]">
        {label} konnten nicht geladen werden: {error.message}
      </p>
      <button type="button" onClick={onRetry} disabled={retrying} className="action-secondary min-h-9 px-4 text-xs">
        {retrying ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function RowsSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <span className="skeleton h-10 w-10 shrink-0 rounded-full" />
          <span className="flex-1">
            <span className="skeleton mb-2 block h-3.5 w-2/5 rounded" />
            <span className="skeleton block h-3 w-1/4 rounded" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
