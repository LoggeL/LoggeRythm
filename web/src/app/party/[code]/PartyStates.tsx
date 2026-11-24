import Link from "next/link";

/** Full-page states shown before the party itself can be rendered or after it ended. */

export function PartySkeleton() {
  return (
    <div role="status" aria-label="Party wird geladen" className="animate-in">
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="space-y-4">
          <div className="skeleton h-3 w-36 rounded-sm" />
          <div className="skeleton h-14 w-80 max-w-full rounded-xl" />
          <div className="skeleton h-3 w-56 max-w-full rounded-sm" />
        </div>
        <div className="skeleton h-16 w-full rounded-xl lg:w-60" />
      </div>
      <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-10">
          <div className="skeleton h-14 rounded-xl" />
          <div className="space-y-3 border-t border-hairline pt-4">
            {Array.from({ length: 5 }, (_, row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="skeleton h-11 w-11 shrink-0 rounded-art" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton h-3 w-2/5 rounded-sm" />
                  <div className="skeleton h-2.5 w-1/4 rounded-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4 border-t border-hairline pt-4">
          <div className="skeleton h-6 w-32 rounded-sm" />
          <div className="skeleton h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function PartyBlocked({
  title,
  message,
  retryLabel,
  busyLabel,
  busy,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  busyLabel: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="animate-in max-w-2xl py-6 sm:py-10">
      <p className="page-eyebrow">Gemeinsam hören · Jam</p>
      <h1 className="font-display text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-none tracking-[-0.04em] text-balance">{title}</h1>
      <p role="alert" className="error-panel mt-6">
        {message}
      </p>
      <button type="button" onClick={onRetry} disabled={busy} className="action-primary mt-5">
        {busy ? busyLabel : retryLabel}
      </button>
    </div>
  );
}

export function PartyEnded({
  reason,
  homeHref = "/",
  homeLabel = "Zur Startseite",
}: {
  reason: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="animate-in max-w-2xl py-6 sm:py-10">
      <p className="page-eyebrow">Gemeinsam hören · Jam</p>
      <h1 className="font-display text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-none tracking-[-0.04em] text-balance">
        Jam beendet
      </h1>
      <p role="status" className="mt-5 text-[15px] leading-relaxed text-muted">
        {reason}
      </p>
      <Link href={homeHref} className="action-primary mt-6 inline-flex">
        {homeLabel}
      </Link>
    </div>
  );
}
