"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/format";
import QueryError from "@/components/ui/QueryError";
import SectionHeader from "@/components/ui/SectionHeader";

const BIO_PREVIEW_LENGTH = 360;

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse gap-1 @3xl:flex-row-reverse @3xl:items-baseline @3xl:justify-between @3xl:gap-4 @3xl:border-b @3xl:border-hairline @3xl:py-3 @3xl:first:pt-0">
      <dt className="label-mono">{label}</dt>
      <dd className="font-display text-2xl font-extrabold leading-none tracking-[-0.03em] tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * "About" section for an artist: a Last.fm biography plus genre tags and
 * listen stats. Lazy-loaded (its own query) so it never blocks the page. It
 * renders nothing while loading or when Last.fm knows nothing about the
 * artist; a failed lookup is reported with a retry.
 */
export default function ArtistAbout({
  name,
  albumsCount = 0,
}: {
  name: string;
  picture?: string;
  albumsCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const about = useQuery({
    queryKey: ["artist-about", name],
    queryFn: () => api.artistAbout(name),
    enabled: !!name,
    staleTime: 60 * 60_000,
  });
  const data = about.data;

  if (!data) {
    if (!about.isError) return null;
    return (
      <section>
        <SectionHeader title={`Über ${name}`} />
        <QueryError label="Die Künstlerinfos" query={about} />
      </section>
    );
  }
  if (!data.bio && !data.listeners && !albumsCount) return null;

  const long = data.bio.length > BIO_PREVIEW_LENGTH;
  const text = expanded || !long ? data.bio : `${data.bio.slice(0, BIO_PREVIEW_LENGTH).trim()}…`;
  const hasStats = data.listeners > 0 || data.playcount > 0 || albumsCount > 0;

  return (
    <section className="@container">
      <SectionHeader title={`Über ${name}`} />
      <QueryError label="Die Künstlerinfos" query={about} className="mb-4" />
      <div className={hasStats ? "grid gap-x-14 gap-y-7 @3xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]" : undefined}>
        {hasStats && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-6 gap-y-5 self-start @3xl:block">
            {data.listeners > 0 && <Stat value={formatCompact(data.listeners)} label="Hörer*innen" />}
            {data.playcount > 0 && <Stat value={formatCompact(data.playcount)} label="Wiedergaben" />}
            {albumsCount > 0 && <Stat value={String(albumsCount)} label="Releases" />}
          </dl>
        )}

        {(data.bio || data.tags.length > 0) && (
          <div className="min-w-0">
            {data.bio && <p className="max-w-[68ch] whitespace-pre-line text-[0.9375rem] leading-7 text-muted [overflow-wrap:anywhere]">{text}</p>}
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="label-mono mt-1 inline-flex min-h-11 items-center text-foreground underline-offset-4 hover:underline"
              >
                {expanded ? "Weniger anzeigen" : "Mehr anzeigen"}
              </button>
            )}

            {data.tags.length > 0 && (
              <ul className={`flex flex-wrap gap-1.5 ${data.bio ? "mt-4" : ""}`} aria-label="Genres">
                {data.tags.map((tag) => (
                  <li key={tag} className="label-mono rounded-art border border-hairline px-2 py-1">
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
