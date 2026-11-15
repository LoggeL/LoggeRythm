const DEFAULT_GRID = "grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

/**
 * Placeholder tiles with the padding, artwork radius and text rhythm of the `cards.module.css` tiles.
 * `grid` takes the grid classes of the list that replaces it when they differ from the default.
 */
export function CardGridSkeleton({ count = 10, grid = DEFAULT_GRID }: { count?: number; grid?: string }) {
  return (
    <div role="status" aria-label="Wird geladen" className={grid}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="min-w-0 p-1.5 sm:p-2">
          <div className="skeleton mb-3 aspect-square w-full rounded-art" />
          <div className="skeleton my-[3px] h-3.5 w-3/4 rounded" />
          <div className="skeleton mb-[3px] mt-1.5 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows with the height and rhythm of TrackRow. */
export function RowListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-label="Titel werden geladen" className="flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-2 py-1.5 sm:px-3">
          <div className="skeleton hidden h-3 w-4 shrink-0 rounded sm:mx-2.5 sm:block" />
          <div className="skeleton h-11 w-11 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="skeleton mb-2 h-3.5 w-2/5 rounded" />
            <div className="skeleton h-3 w-1/4 rounded" />
          </div>
          <div className="skeleton h-3 w-9 shrink-0 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder with the proportions of CollectionHero (artwork, title, actions). */
export function DetailHeaderSkeleton({ round = false }: { round?: boolean }) {
  return (
    <div role="status" aria-label="Wird geladen" className="pb-4 pt-2 sm:pb-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-[clamp(1.25rem,3vw,2.25rem)]">
        <div className={`skeleton aspect-square w-[min(58vw,14rem)] shrink-0 max-sm:mx-auto sm:w-[clamp(11rem,22vw,17rem)] ${round ? "rounded-full" : "rounded-[var(--radius-card)]"}`} />
        <div className="min-w-0 flex-1 pb-1">
          <div className="skeleton mb-3 h-4 w-16 rounded" />
          <div className="skeleton h-[clamp(1.75rem,7.6vw,2.25rem)] w-2/3 rounded-[var(--radius-card)] sm:h-[clamp(2.125rem,4.6vw,4rem)]" />
          <div className="skeleton mt-3 h-5 w-1/3 rounded" />
        </div>
      </div>
      <div className="mt-6 flex min-h-14 items-center gap-x-3">
        <div className="skeleton h-14 w-14 rounded-full" />
        <div className="skeleton h-11 w-11 rounded-[var(--radius-control)]" />
        <div className="skeleton h-11 w-11 rounded-[var(--radius-control)]" />
      </div>
    </div>
  );
}
