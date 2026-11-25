"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import { CollectionSkeleton, useLoadingPlaceholder } from "@/app/playlist/_components/CollectionPageState";
import { CollectionMenu, PlayCollectionButton, ShuffleCollectionButton, useQueueAllItem, useSaveAsPlaylistItem } from "@/app/playlist/_components/CollectionActions";
import { tracksSummary } from "@/app/playlist/_components/collectionMeta";
import type { HomeShelf } from "@/types";

// Home links to mixes from three feeds:
// - `byl-*` ("because you listened")
// - `on-repeat`, `forgotten-favorites`, `unheard-cuts` (personal mixes from play history)
// - all other keys belong to the Deezer-backed home mixes.
const BECAUSE_YOU_LISTENED_PREFIX = "byl-";
const PERSONAL_MIX_KEYS = new Set(["on-repeat", "forgotten-favorites", "unheard-cuts"]);

function mixSource(key: string, userId: string | null) {
  if (key.startsWith(BECAUSE_YOU_LISTENED_PREFIX)) {
    return { queryKey: ["because-you-listened", userId], queryFn: () => api.becauseYouListened(), label: "Empfehlungen zu deiner Musik" };
  }
  if (PERSONAL_MIX_KEYS.has(key)) {
    return { queryKey: ["home-personal-mixes", userId], queryFn: () => api.homePersonalMixes(), label: "Aus deinem Hörverlauf" };
  }
  return { queryKey: ["home-mixes", userId], queryFn: () => api.homeMixes(), label: "Deine Mixe" };
}

export default function MixPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const key = decodeURIComponent(rawKey);
  const account = useMe();
  const me = account.data;
  const userId = me ? String(me.id) : null;
  const source = mixSource(key, userId);
  const mixes = useQuery<HomeShelf[]>({
    queryKey: source.queryKey,
    queryFn: source.queryFn,
    enabled: userId !== null,
  });

  const loading = useLoadingPlaceholder(account.isLoading || mixes.isLoading);
  if (loading) return <CollectionSkeleton />;

  if (!me) {
    // A failed account lookup is not the same as being signed out.
    if (account.isError) return <QueryError label="Deine Kontodaten" query={account} />;
    return (
      <EmptyState
        title="Melde dich an, um deine Mixe zu hören"
        action={
          <Link href="/login" className="action-primary">
            Anmelden
          </Link>
        }
      >
        Mixe werden aus der Musik zusammengestellt, die du hörst.
      </EmptyState>
    );
  }

  if (mixes.data === undefined) return <QueryError label={source.label} query={mixes} />;

  const mix = mixes.data.find((candidate) => candidate.key === key);
  if (!mix) {
    return (
      <EmptyState
        title="Playlist nicht gefunden"
        action={
          <Link href="/" className="action-secondary">
            Zur Startseite
          </Link>
        }
      >
        Dieser Mix gehört nicht mehr zu deinen aktuellen Empfehlungen.
      </EmptyState>
    );
  }

  return (
    <div>
      <QueryError label="Deine Kontodaten" query={account} className="mb-4" />
      <QueryError label={source.label} query={mixes} className="mb-4" />
      <MixView mix={mix} />
    </div>
  );
}

function MixView({ mix }: { mix: HomeShelf }) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const tracks = mix.tracks;
  const cover = mix.cover || tracks.find((track) => track.cover)?.cover;
  const queueAll = useQueueAllItem(tracks);
  const savePlaylist = useSaveAsPlaylistItem(mix.title, tracks, mix.subtitle);

  return (
    <>
      <CollectionHero
        eyebrow="Für dich gemixt"
        title={mix.title}
        description={mix.subtitle}
        metadata={tracksSummary(tracks)}
        coverUrl={cover}
        artwork={<Cover src={cover} eager />}
        actions={
          <>
            <PlayCollectionButton tracks={tracks} context={mix.title} />
            <ShuffleCollectionButton tracks={tracks} context={mix.title} />
            {tracks.length > 0 && <CollectionMenu label="Weitere Optionen für diesen Mix" items={[queueAll, savePlaylist]} />}
          </>
        }
      />
      <CollectionTracks count={tracks.length}>
        {tracks.length === 0 ? (
          <EmptyState
            title="Diese Playlist ist leer"
            action={
              <Link href="/search" className="action-secondary">
                Musik entdecken
              </Link>
            }
          >
            Höre mehr Musik, damit dieser Mix gefüllt werden kann.
          </EmptyState>
        ) : (
          tracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} onPlay={() => playQueue(tracks, index, mix.title)} />)
        )}
      </CollectionTracks>
    </>
  );
}
