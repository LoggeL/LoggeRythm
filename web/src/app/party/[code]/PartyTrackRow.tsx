import type { ReactNode } from "react";
import CacheMarker from "@/components/CacheMarker";
import Cover from "@/components/ui/Cover";

const currentBand =
  "bg-[linear-gradient(to_right,color-mix(in_srgb,var(--accent)_13%,transparent),rgb(244_240_230/0.03)_62%)] shadow-[inset_3px_0_0_var(--accent)]";

/**
 * One track line in the party: artwork, title, normal stored/downloaded
 * CacheMarker + secondary line, and trailing controls. `onActivate` turns the
 * artwork/title block into a button.
 */
export default function PartyTrackRow({
  trackId,
  cover,
  title,
  subtitle,
  serverStored = false,
  isGuest = false,
  cacheError = null,
  onRetryCache,
  current = false,
  position,
  played = false,
  onActivate,
  activateLabel,
  activateDisabled = false,
  children,
}: {
  trackId: string | number;
  cover: string;
  title: string;
  subtitle: ReactNode;
  /** Authoritative server-stored status (`PartyTrack.is_stored` or `/party/{code}/cached-tracks`). */
  serverStored?: boolean;
  /** Anonymous party guests use party-scoped cache state instead of `/api/cached-tracks`. */
  isGuest?: boolean;
  cacheError?: string | null;
  onRetryCache?: () => void | Promise<void>;
  /** Highlights the row as the track that is playing right now. */
  current?: boolean;
  /** 1-based place in the queue, shown as a mono index from 640px. */
  position?: number;
  /** The track is already behind the playing one. */
  played?: boolean;
  onActivate?: () => void;
  activateLabel?: string;
  activateDisabled?: boolean;
  /** Trailing controls (duration, actions). */
  children?: ReactNode;
}) {
  const body = (
    <>
      {position !== undefined && (
        <span
          aria-hidden="true"
          className={`hidden w-6 shrink-0 text-center font-mono text-xs tabular-nums sm:block ${current ? "text-accent" : "text-subtle"}`}
        >
          {String(position).padStart(2, "0")}
        </span>
      )}
      <Cover src={cover} className={`rounded-art ${current ? "h-14 w-14" : "h-11 w-11"} ${played ? "opacity-60" : ""}`} />
      <span className="min-w-0 flex-1">
        {current && (
          <span className="mb-1 flex items-center gap-2 font-mono text-[0.625rem] font-medium uppercase leading-none tracking-[0.16em] text-accent">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            Läuft jetzt
          </span>
        )}
        <span
          className={`block truncate ${current ? "font-display text-base font-bold tracking-tight text-foreground" : "text-sm font-medium"} ${
            played ? "text-muted" : "text-foreground"
          }`}
        >
          {title}
        </span>
        <span className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs ${played ? "text-subtle" : "text-muted"}`}>
          <CacheMarker
            trackId={trackId}
            serverStored={serverStored}
            skipStoreFetch={isGuest}
            externalError={cacheError}
            onRetryExternal={onRetryCache}
          />
          <span className="min-w-0 truncate">{subtitle}</span>
        </span>
      </span>
    </>
  );
  return (
    <li
      aria-current={current ? "true" : undefined}
      className={`flex flex-wrap items-center gap-x-3 rounded-xl px-2 transition-colors hover:bg-foreground/[0.07] focus-within:bg-foreground/[0.05] motion-reduce:transition-none sm:px-3 ${
        current ? `py-2.5 ${currentBand}` : "py-1.5"
      }`}
    >
      {onActivate ? (
        <button
          type="button"
          onClick={onActivate}
          disabled={activateDisabled}
          aria-label={activateLabel}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {children}
    </li>
  );
}

/** Placeholder rows shown while tracks are being fetched. */
export function PartyTrackRowsSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3 px-2 py-1.5 sm:px-3">
          <div className="skeleton h-11 w-11 shrink-0 rounded-art" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3 w-2/5 rounded-sm" />
            <div className="skeleton h-2.5 w-1/4 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
