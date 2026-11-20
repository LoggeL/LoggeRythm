"use client";

import { useState } from "react";
import { useMe } from "@/hooks/useAuth";
import { useLikes } from "@/hooks/useLibrary";
import { likedTracksByArtist } from "@/lib/likedByArtist";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import { TrackListHeader } from "@/components/TrackList";
import QueryError from "@/components/ui/QueryError";
import SectionHeader from "@/components/ui/SectionHeader";
import { ChevronDownIcon } from "@/components/icons";

const LIST_ID = "artist-liked-list";

/**
 * The signed-in user's liked songs that credit this artist, most recently
 * liked first. It reads the shared likes query, so liking or unliking a song
 * anywhere updates it at once. Renders nothing for signed-out visitors, while
 * the likes are still unknown and when none match; a failed likes query is
 * reported in place. The block starts collapsed to its heading and song
 * count, so it does not repeat the Popular list below it; "Anzeigen" lists
 * every song. Playing a row queues the whole list.
 */
export default function LikedByArtist({ artistId, artistName }: { artistId: string | number; artistName: string }) {
  const account = useMe();
  const likes = useLikes(!!account.data);
  const playQueue = usePlayerStore((state) => state.playQueue);
  const [expanded, setExpanded] = useState(false);

  // Account failures are reported by `FollowErrors` right above this block.
  if (!account.data) return null;
  const liked = likes.data ? likedTracksByArtist(likes.data, artistId, artistName) : [];
  if (liked.length === 0 && !likes.isError) return null;

  const context = `Lieblingssongs von ${artistName}`;
  const countLabel = `${liked.length} ${liked.length === 1 ? "Song" : "Songs"}`;

  return (
    <section aria-labelledby="artist-liked">
      <SectionHeader
        id="artist-liked"
        title="Deine Lieblingssongs"
        description={liked.length > 0 ? `${countLabel} von ${artistName}, die du geliked hast` : `Songs von ${artistName}, die du geliked hast`}
        action={
          liked.length > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={LIST_ID}
              aria-label={expanded ? `Lieblingssongs von ${artistName} ausblenden` : `Alle ${countLabel} von ${artistName} anzeigen`}
              onClick={() => setExpanded((value) => !value)}
              className="label-mono inline-flex min-h-11 shrink-0 items-center gap-1 text-foreground underline-offset-4 hover:underline"
            >
              {expanded ? "Ausblenden" : "Anzeigen"}
              <ChevronDownIcon
                width={16}
                height={16}
                aria-hidden="true"
                className={`transition-transform duration-300 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          ) : undefined
        }
      />
      <QueryError label="Deine Lieblingssongs" query={likes} className={liked.length > 0 && expanded ? "mb-4" : ""} />
      {liked.length > 0 && (
        // The list element stays mounted for `aria-controls`; rows render only when expanded.
        <div id={LIST_ID} hidden={!expanded}>
          {expanded && (
            <>
              <TrackListHeader />
              {liked.map((track, index) => (
                <TrackRow key={track.id} track={track} index={index} onPlay={() => playQueue(liked, index, context)} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
