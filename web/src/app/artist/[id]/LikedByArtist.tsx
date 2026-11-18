"use client";

import { useState } from "react";
import { useMe } from "@/hooks/useAuth";
import { useLikes } from "@/hooks/useLibrary";
import { LIKED_BY_ARTIST_PREVIEW, likedTracksByArtist } from "@/lib/likedByArtist";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import { TrackListHeader } from "@/components/TrackList";
import QueryError from "@/components/ui/QueryError";
import SectionHeader from "@/components/ui/SectionHeader";

const LIST_ID = "artist-liked-list";

/**
 * The signed-in user's liked songs that credit this artist, most recently
 * liked first. It reads the shared likes query, so liking or unliking a song
 * anywhere updates it at once. Renders nothing for signed-out visitors, while
 * the likes are still unknown and when none match; a failed likes query is
 * reported in place. Playing a row queues the whole list, not just the
 * visible preview.
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
  const visible = expanded ? liked : liked.slice(0, LIKED_BY_ARTIST_PREVIEW);

  return (
    <section aria-labelledby="artist-liked">
      <SectionHeader
        id="artist-liked"
        title="Deine Lieblingssongs"
        description={`Songs von ${artistName}, die du geliked hast`}
        action={
          liked.length > LIKED_BY_ARTIST_PREVIEW ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={LIST_ID}
              onClick={() => setExpanded((value) => !value)}
              className="label-mono inline-flex min-h-11 shrink-0 items-center text-foreground underline-offset-4 hover:underline"
            >
              {expanded ? "Weniger anzeigen" : `Alle ${liked.length} anzeigen`}
            </button>
          ) : liked.length > 0 ? (
            <span className="label-mono shrink-0 tabular-nums">{`${liked.length} ${liked.length === 1 ? "Song" : "Songs"}`}</span>
          ) : undefined
        }
      />
      <QueryError label="Deine Lieblingssongs" query={likes} className={liked.length > 0 ? "mb-4" : ""} />
      {liked.length > 0 && (
        <div id={LIST_ID}>
          <TrackListHeader />
          {visible.map((track, index) => (
            <TrackRow key={track.id} track={track} index={index} onPlay={() => playQueue(liked, index, context)} />
          ))}
        </div>
      )}
    </section>
  );
}
