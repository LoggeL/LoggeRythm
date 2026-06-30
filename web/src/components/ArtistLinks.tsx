import { Fragment } from "react";
import Link from "next/link";
import type { Track } from "@/types";

interface ArtistLinksProps {
  track: Track;
  /** Applied to the wrapping element. */
  className?: string;
  /** Applied to each individual artist link. */
  linkClassName?: string;
  /** Called when an artist link is followed (e.g. to close a fullscreen view). */
  onNavigate?: () => void;
}

/**
 * Render a track's performers as comma-separated links. Uses the full
 * ``artists`` credit list when present (a song can have several performers),
 * otherwise falls back to the single ``artist``/``artist_id``.
 */
export default function ArtistLinks({
  track,
  className,
  linkClassName = "hover:underline hover:text-foreground",
  onNavigate,
}: ArtistLinksProps) {
  const artists =
    track.artists && track.artists.length > 0
      ? track.artists
      : [{ id: track.artist_id ?? "", name: track.artist }];

  return (
    <span className={className}>
      {artists.map((a, i) => (
        <Fragment key={`${a.id}-${i}`}>
          {i > 0 && ", "}
          {a.id ? (
            <Link
              href={`/artist/${a.id}`}
              onClick={onNavigate}
              className={linkClassName}
            >
              {a.name}
            </Link>
          ) : (
            a.name
          )}
        </Fragment>
      ))}
    </span>
  );
}
