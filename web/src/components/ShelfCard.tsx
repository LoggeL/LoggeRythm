"use client";

import Link from "next/link";
import type { HomeShelf } from "@/types";
import { usePlayerStore } from "@/store/player";
import { PlayIcon, ChevronRightIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";

const THEMES = ["gradient-violet", "gradient-blue", "gradient-teal", "gradient-orange"];
const TAGS: Record<string, string> = { weekly: "Dein Mix", chill: "Entspannt", discover: "Neue Entdeckungen", "release-radar": "Release Radar" };

export default function ShelfCard({ shelf, index = 0, variant = "collection", href, highlighted = false, statusBadge }: {
  shelf: HomeShelf;
  index?: number;
  variant?: "hero" | "collection";
  href?: string;
  highlighted?: boolean;
  statusBadge?: string;
}) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover;
  const hero = variant === "hero";
  const className = `group relative w-full overflow-hidden text-left ${hero ? "surface-card flex min-h-40 items-center gap-4 p-5 hover:bg-panel-hover" : "music-card block p-2.5 sm:p-3"} ${highlighted ? "new-content-highlight" : ""}`;
  const art = cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <div className={`grid h-full w-full place-items-center ${THEMES[index % THEMES.length]}`}><CoverPlaceholder className="h-12 w-12 bg-transparent" /></div>
  );
  const contents = hero ? (
    <>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-accent-soft">{TAGS[shelf.key] || "Für dich"}</p>
        <h3 className="text-lg font-semibold leading-tight tracking-tight">{shelf.title}</h3>
        {shelf.subtitle && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{shelf.subtitle}</p>}
        <span className="mt-3 inline-flex items-center gap-2 text-xs text-muted">{shelf.tracks.length} Titel {href ? <ChevronRightIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}</span>
      </div>
      <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl shadow-lg sm:h-28 sm:w-28">{art}</div>
    </>
  ) : (
    <>
      <div className="relative mb-3 aspect-[4/3] overflow-hidden rounded-xl">
        {art}
        <span className="absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-accent text-white opacity-0 shadow-lg transition group-hover:opacity-100">{href ? <ChevronRightIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}</span>
      </div>
      <h3 className="truncate text-sm font-semibold">{shelf.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-muted">{shelf.subtitle || `${shelf.tracks.length} Titel`}</p>
    </>
  );
  const badge = statusBadge && <span className="absolute right-3 top-3 z-10 rounded-md bg-accent-solid px-2 py-1 text-[10px] font-semibold text-white">{statusBadge}</span>;

  return href ? (
    <Link href={href} className={className} aria-label={statusBadge ? `${shelf.title}, ${statusBadge}` : shelf.title}>{contents}{badge}</Link>
  ) : (
    <button type="button" onClick={() => playQueue(shelf.tracks, 0, shelf.title)} disabled={shelf.tracks.length === 0} className={`${className} disabled:opacity-50`} aria-label={`${shelf.title} abspielen`}>{contents}{badge}</button>
  );
}
