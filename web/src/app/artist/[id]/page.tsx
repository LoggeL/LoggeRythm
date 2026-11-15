"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import PopularTrackTable from "@/components/PopularTrackTable";
import ArtistSongSearch from "@/components/ArtistSongSearch";
import ArtistAbout from "@/components/ArtistAbout";
import SectionHeader from "@/components/ui/SectionHeader";
import Shelf from "@/components/browse/Shelf";
import { RowListSkeleton } from "@/components/Skeleton";
import CollectionPageState from "@/app/playlist/_components/CollectionPageState";
import { PlayCollectionButton, ShuffleCollectionButton } from "@/app/playlist/_components/CollectionActions";
import { formatCompact } from "@/lib/format";
import type { Artist } from "@/types";
import ArtistHero, { type ArtistFigure } from "./ArtistHero";
import { FollowButton, FollowErrors } from "./FollowButton";
import styles from "./artist.module.css";

const POPULAR_LIMIT = 10;

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const artist = useQuery<Artist>({
    queryKey: ["artist", id],
    queryFn: () => api.artist(id),
    enabled: !!id,
  });

  return (
    <CollectionPageState query={artist} label="Die Künstlerdaten" missing="Künstler nicht gefunden" skeleton={<ArtistSkeleton />}>
      {(data) => <ArtistView artist={data} />}
    </CollectionPageState>
  );
}

/** Loading placeholder with the geometry of `ArtistHero` and the track table below it. */
function ArtistSkeleton() {
  return (
    <div>
      <div role="status" aria-label="Wird geladen" className={styles.hero}>
        <div className={styles.layout}>
          <div className={styles.portrait}>
            <div className="skeleton" />
          </div>
          <div className={styles.info}>
            <div className="skeleton mb-3 h-4 w-20 rounded" />
            <div className={`${styles.name} skeleton w-3/5 rounded-[var(--radius-card)]`} data-size="md" aria-hidden="true">
              &nbsp;
            </div>
            <div className={styles.meta}>
              <div className="skeleton h-4 w-44 rounded" />
            </div>
            <div className={styles.actions}>
              <div className="skeleton h-14 w-14 rounded-full" />
              <div className="skeleton h-11 w-11 rounded-[var(--radius-control)]" />
              <div className="skeleton h-[42px] w-[7.75rem] rounded-[var(--radius-control)]" />
            </div>
          </div>
        </div>
      </div>
      <div className="section-heading">
        <div className="skeleton h-7 w-28 rounded" />
      </div>
      <RowListSkeleton count={POPULAR_LIMIT} />
    </div>
  );
}

function Count({ children }: { children: string }) {
  return <span className="label-mono shrink-0 tabular-nums">{children}</span>;
}

function ArtistView({ artist }: { artist: Artist }) {
  const tracks = artist.top ?? [];
  const albums = artist.albums ?? [];
  const related = artist.related ?? [];
  const fans = artist.fans ?? 0;
  const popular = tracks.slice(0, POPULAR_LIMIT);
  const figures: ArtistFigure[] = [];
  if (fans > 0) figures.push({ value: formatCompact(fans), label: "Fans" });
  if (artist.albums_count) figures.push({ value: String(artist.albums_count), label: "Releases" });

  return (
    <>
      <ArtistHero
        name={artist.name}
        picture={artist.picture}
        figures={figures}
        actions={
          <>
            <PlayCollectionButton tracks={tracks} context={artist.name} />
            <ShuffleCollectionButton tracks={tracks} context={artist.name} />
            <FollowButton artist={{ id: artist.id, name: artist.name, picture: artist.picture }} />
          </>
        }
      />
      <FollowErrors />

      <div className="flex flex-col gap-9 md:gap-11">
        {popular.length > 0 && (
          <section aria-labelledby="artist-popular">
            <SectionHeader id="artist-popular" title="Beliebt" action={<Count>{`Top ${popular.length}`}</Count>} />
            <PopularTrackTable tracks={popular} context={artist.name} showPlays />
          </section>
        )}

        <ArtistSongSearch artistId={String(artist.id)} artistName={artist.name} />

        {albums.length > 0 && (
          <section aria-labelledby="artist-discography">
            <SectionHeader id="artist-discography" title="Diskografie" action={<Count>{`${albums.length} ${albums.length === 1 ? "Release" : "Releases"}`}</Count>} />
            <Shelf label={`Diskografie von ${artist.name}`}>
              {albums.map((album) => (
                <AlbumCard key={String(album.id)} album={album} />
              ))}
            </Shelf>
          </section>
        )}

        {related.length > 0 && (
          <section aria-labelledby="artist-related">
            <SectionHeader id="artist-related" title="Ähnliche Künstler" />
            <Shelf label={`Ähnliche Künstler wie ${artist.name}`}>
              {related.map((other) => (
                <ArtistCard key={String(other.id)} artist={other} />
              ))}
            </Shelf>
          </section>
        )}

        <ArtistAbout name={artist.name} picture={artist.picture} albumsCount={artist.albums_count} />
      </div>
    </>
  );
}
