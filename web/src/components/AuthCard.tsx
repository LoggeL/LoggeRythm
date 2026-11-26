import type { ReactNode } from "react";
import Link from "next/link";
import Logo, { Wordmark } from "@/components/Logo";

const FEATURES = ["Songtexte", "Partys", "Offline"] as const;

/**
 * Two-part entrance for everything outside the signed-in app: login, register,
 * the landing gate and the "waiting for approval" screen. The masthead carries
 * the brand and the claim; the content column stays flat on the page.
 *
 * `compact` folds the claim away on small screens so a form starts right under
 * the brand row. `claimHeading` makes the claim the page's `h1`.
 */
export function AuthShell({ children, compact = false, claimHeading = false }: { children: ReactNode; compact?: boolean; claimHeading?: boolean }) {
  const Claim = claimHeading ? "h1" : "p";
  return (
    <div className="grid min-h-full grid-rows-[auto_1fr] bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-1">
      <header className="flex flex-col border-b border-hairline bg-backdrop px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:pb-10 lg:pt-[calc(2.5rem+env(safe-area-inset-top))]">
        <Link href="/" aria-label="LoggeRythm Startseite" className="flex min-h-11 items-center gap-2.5 self-start rounded-[var(--radius-control)] pr-2 transition-opacity hover:opacity-80">
          <Logo size={30} />
          <Wordmark />
        </Link>
        <div className={`${compact ? "hidden lg:flex" : "flex"} @container flex-1 flex-col justify-end pb-4 pt-10 lg:pb-12 lg:pt-16`}>
          <span className="page-eyebrow">Privater Musikplayer</span>
          <Claim className="font-display text-[length:clamp(2.75rem,14cqi,6rem)] font-extrabold leading-[0.92] tracking-[-0.045em]">
            Deine Musik.
            <br />
            Dein Stream.
          </Claim>
        </div>
        <ul aria-hidden="true" className="hidden grid-cols-3 border-t border-hairline pt-4 lg:grid">
          {FEATURES.map((feature, index) => (
            <li key={feature} className="label-mono flex flex-col gap-1.5">
              <span className="tabular-nums text-subtle">{String(index + 1).padStart(2, "0")}</span>
              <span className="text-foreground">{feature}</span>
            </li>
          ))}
        </ul>
      </header>
      <div className="flex flex-col justify-center px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-9 sm:px-8 lg:px-12 lg:py-12">
        <div className="animate-in mx-auto w-full max-w-[26rem]">{children}</div>
      </div>
    </div>
  );
}

/** Flat form column inside the {@link AuthShell}. */
export default function AuthCard({
  title,
  subtitle,
  footer,
  eyebrow,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <AuthShell compact>
      <section aria-labelledby="auth-title">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1 id="auth-title" className="text-[clamp(2rem,5vw,2.75rem)] font-extrabold leading-none tracking-[-0.04em] [text-wrap:balance]">
          {title}
        </h1>
        {subtitle && <p className="mt-3 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </section>
      {footer && <p className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-5 text-sm text-muted">{footer}</p>}
    </AuthShell>
  );
}
