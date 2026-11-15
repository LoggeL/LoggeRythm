import type { ReactElement, ReactNode } from "react";
import type { IconProps } from "./icons";

export type StatusTone = "ok" | "critical" | "neutral";

const numberFormatter = new Intl.NumberFormat("de-DE");
export const formatNumber = (value: number) => numberFormatter.format(value);

const TONE_TEXT: Record<StatusTone, string> = { ok: "text-foreground", critical: "text-danger", neutral: "text-muted" };
const TONE_RULE: Record<StatusTone, string> = { ok: "border-hairline", critical: "border-danger", neutral: "border-hairline" };
export const TONE_FILL: Record<StatusTone, string> = { ok: "bg-foreground", critical: "bg-danger", neutral: "bg-muted" };

const GLYPH_SIZE = { sm: "h-2 w-2", lg: "h-4 w-4 sm:h-5 sm:w-5" } as const;
const GLYPH_SHAPE: Record<StatusTone, string> = {
  ok: "rounded-full bg-success",
  critical: "rotate-45 rounded-[1px] bg-danger",
  neutral: "rounded-full border-[1.5px] border-subtle",
};

/** State mark that differs by shape as well as colour: disc = ok, diamond = fault, ring = not rated. */
export function ToneGlyph({ tone, size = "sm" }: { tone: StatusTone; size?: keyof typeof GLYPH_SIZE }) {
  return <span aria-hidden="true" data-tone={tone} className={`inline-block shrink-0 ${GLYPH_SIZE[size]} ${GLYPH_SHAPE[tone]}`} />;
}

export function Pill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] ${TONE_TEXT[tone]}`}>
      <ToneGlyph tone={tone} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

/** One instrument group: numbered heading on a hairline, its state opposite. */
export function Panel({
  id,
  index,
  title,
  Icon,
  summary,
  wide = false,
  children,
}: {
  id: string;
  index: string;
  title: string;
  Icon: (props: IconProps) => ReactElement;
  summary: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={`min-w-0 scroll-mt-24 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="section-heading flex-wrap items-center gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="label-mono tabular-nums text-subtle">
            {index}
          </span>
          <Icon className="h-[18px] w-[18px] shrink-0 text-muted" />
          <h2 id={headingId} className="min-w-0 [overflow-wrap:anywhere]">
            {title}
          </h2>
        </div>
        {summary}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-hairline py-3 text-sm">
      <span className="label-mono">{label}</span>
      <div className="min-w-0 text-right font-medium tabular-nums [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">{children}</dl>;
}

export function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col border-t border-hairline py-3">
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1.5 font-display text-2xl font-bold leading-tight tracking-[-0.03em] tabular-nums [overflow-wrap:anywhere]">
        {typeof value === "number" ? formatNumber(value) : value}
      </dd>
    </div>
  );
}

export function Signal({ label, value, tone }: { label: string; value: string; tone: StatusTone }) {
  return (
    <div className={`min-w-0 border-t-2 pt-3 ${TONE_RULE[tone]}`}>
      <dt className="label-mono">{label}</dt>
      <dd className={`mt-1.5 flex items-center gap-2 text-sm font-semibold ${tone === "critical" ? "text-danger" : "text-foreground"}`}>
        <ToneGlyph tone={tone} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
      </dd>
    </div>
  );
}
