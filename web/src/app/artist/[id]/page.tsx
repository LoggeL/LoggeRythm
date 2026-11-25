"use client";

import { use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import { CARD_GRID } from "@/components/cardGrid";
import PopularTrackTable from "@/components/PopularTrackTable";
import ArtistSongSearch from "@/components/ArtistSongSearch";
import ArtistAbout from "@/components/ArtistAbout";
import SectionHeader from "@/components/ui/SectionHeader";
import Shelf from "@/components/browse/Shelf";
import { RowListSkeleton } from "@/components/Skeleton";
import CollectionPageState from "@/app/playlist/_components/CollectionPageState";
import { PlayCollectionButton, ShuffleCollectionButton } from "@/app/playlist/_components/CollectionActions";
import { formatCompact } from "@/lib/format";
import { useMe } from "@/hooks/useAuth";
import { useLikes } from "@/hooks/useLibrary";
import type { Artist } from "@/types";
import ArtistHero, { ArtistEyebrowPlaceholder, ArtistNamePlaceholder, ArtistPortraitPlaceholder, type ArtistFigure } from "./ArtistHero";
import { FollowButton, FollowErrors } from "./FollowButton";
import LikedByArtist from "./LikedByArtist";
import styles from "./artist.module.css";

const POPULAR_LIMIT = 10;

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const artist = useQuery<Artist>({
    queryKey: ["artist", id],
    queryFn: () => api.artist(id),
    enabled: !!id,
  });
  // Request the likes alongside the artist, so the liked block is usually
  // known when the page first renders instead of pushing the sections down.
  useLikes(!!useMe().data);

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
          <ArtistPortraitPlaceholder />
          <div className={styles.info}>
            <ArtistEyebrowPlaceholder />
            <ArtistNamePlaceholder />
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

type DiscographySort = "newest" | "oldest" | "title";

function ArtistView({ artist }: { artist: Artist }) {
  const [discographySort, setDiscographySort] = useState<DiscographySort>("newest");
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const tracks = artist.top ?? [];
  const albums = useMemo(() => artist.albums ?? [], [artist.albums]);
  const related = artist.related ?? [];
  const fans = artist.fans ?? 0;
  const popular = tracks.slice(0, POPULAR_LIMIT);
  const sortedAlbums = useMemo(() => {
    const list = [...albums];
    if (discographySort === "title") {
      return list.sort((a, b) => a.title.localeCompare(b.title, "de"));
    }
    if (discographySort === "oldest") {
      return list.sort((a, b) => (a.release_date || "9999").localeCompare(b.release_date || "9999"));
    }
    return list.sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
  }, [albums, discographySort]);
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
        <LikedByArtist key={String(artist.id)} artistId={artist.id} artistName={artist.name} />

        {popular.length > 0 && (
          <section aria-labelledby="artist-popular">
            <SectionHeader id="artist-popular" title="Beliebt" action={<Count>{`Top ${popular.length}`}</Count>} />
            <PopularTrackTable tracks={popular} context={artist.name} showPlays />
          </section>
        )}

        <ArtistSongSearch artistId={String(artist.id)} artistName={artist.name} />

        {albums.length > 0 && (
          <section aria-labelledby="artist-discography">
            <SectionHeader
              id="artist-discography"
              title="Diskografie"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Diskografie sortieren"
                    value={discographySort}
                    onChange={(event) => setDiscographySort(event.target.value as DiscographySort)}
                    className="field-input min-h-8 w-auto rounded-full py-1 pl-3 pr-2 text-xs font-semibold"
                  >
                    <option value="newest">Neueste zuerst</option>
                    <option value="oldest">Älteste zuerst</option>
                    <option value="title">Titel A–Z</option>
                  </select>
                  {albums.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllAlbums((v) => !v)}
                      aria-expanded={showAllAlbums}
                      className="filter-chip min-h-8 px-3 text-xs"
                    >
                      {showAllAlbums ? "Kompakt" : `Alle ${albums.length} anzeigen`}
                    </button>
                  )}
                </div>
              }
            />
            {showAllAlbums ? (
              <div className={CARD_GRID}>
                {sortedAlbums.map((album) => (
                  <AlbumCard key={String(album.id)} album={album} />
                ))}
              </div>
            ) : (
              <Shelf label={`Diskografie von ${artist.name}`}>
                {sortedAlbums.map((album) => (
                  <AlbumCard key={String(album.id)} album={album} />
                ))}
              </Shelf>
            )}
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
