"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/format";

/**
 * "About" section for an artist: a Last.fm biography plus genre tags and
 * listen stats. Lazy-loaded (its own query) so it never blocks the page, and
 * it simply renders nothing when no biography is available.
 */
export default function ArtistAbout({
  name,
  picture,
  albumsCount = 0,
}: {
  name: string;
  picture?: string;
  albumsCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({
    queryKey: ["artist-about", name],
    queryFn: () => api.artistAbout(name),
    enabled: !!name,
    staleTime: 60 * 60_000,
  });

  if (!data || (!data.bio && !data.listeners && !albumsCount)) return null;

  const long = data.bio.length > 360;
  const text = expanded || !long ? data.bio : `${data.bio.slice(0, 360).trim()}…`;

  return (
    <section className="mb-10">
      <h2 className="text-2xl font-bold mb-4">Über {name}</h2>
      <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-6 flex flex-col sm:flex-row gap-6">
        {picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture}
            alt={name}
            className="w-28 h-28 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10"
          />
        )}
        <div className="min-w-0">
          {(data.listeners > 0 || data.playcount > 0 || albumsCount > 0) && (
            <div className="flex flex-wrap gap-8 mb-4">
              {data.listeners > 0 && (
                <div>
                  <div className="text-xl font-bold">
                    {formatCompact(data.listeners)}
                  </div>
                  <div className="text-xs text-muted uppercase tracking-wide">
                    Hörer*innen
                  </div>
                </div>
              )}
              {data.playcount > 0 && (
                <div>
                  <div className="text-xl font-bold">
                    {formatCompact(data.playcount)}
                  </div>
                  <div className="text-xs text-muted uppercase tracking-wide">
                    Wiedergaben
                  </div>
                </div>
              )}
              {albumsCount > 0 && (
                <div>
                  <div className="text-xl font-bold">{albumsCount}</div>
                  <div className="text-xs text-muted uppercase tracking-wide">
                    Releases
                  </div>
                </div>
              )}
            </div>
          )}

          {data.bio && (
            <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-line">
              {text}
              {long && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="ml-1 text-accent hover:underline font-medium"
                >
                  {expanded ? "weniger" : "mehr"}
                </button>
              )}
            </p>
          )}

          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {data.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 rounded-full bg-white/[0.06] text-xs text-muted capitalize"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
