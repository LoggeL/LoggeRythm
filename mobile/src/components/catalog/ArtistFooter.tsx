import React from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  AlbumSummary,
  ArtistAbout as ArtistAboutData,
  ArtistSummary,
} from '../../api/types';
import { catalogTestIdSegment, type AlbumRouteParams, type ArtistRouteParams } from '../../screens/catalogModel';
import { catalogStrings } from '../../screens/catalogStrings';
import { layout } from '../../theme';
import { SectionHeader } from '../ui';
import { ArtistAbout, artistAboutHasContent } from './ArtistAbout';
import { CatalogAlbumCard, CatalogArtistCard, HorizontalCatalogRail } from './CatalogCards';
import { CatalogSection } from './CatalogStates';
import {
  catalogQueryFlags,
  settledCatalogQueryFlags,
  type CatalogQueryFlags,
} from './catalogQueryState';

export interface ArtistFooterProps {
  albums: readonly AlbumSummary[];
  related: readonly ArtistSummary[];
  /** The about query. It only runs once the artist name is known (`aboutEnabled`). */
  about: CatalogQueryFlags & { data: ArtistAboutData | undefined; refetch: () => unknown };
  aboutEnabled: boolean;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  /** Optional interactive genre tag handler (launches mood radio). */
  onTagPress?: (tag: string) => void;
  busyTag?: string | null;
  /** Optional 10-foot card size for Android TV. */
  cardSize?: number;
}

interface ShelfProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

/**
 * A titled rail whose items came with the artist payload: it has no remote
 * state of its own, so it is simply absent when the payload has no items.
 */
function ArtistShelf({ id, title, children }: ShelfProps) {
  return (
    <View testID={`catalog-section-${id}`} style={styles.shelf}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

/** Everything below the Artist page's track rows: discography, related artists, about. */
export function ArtistFooter({
  albums,
  related,
  about,
  aboutEnabled,
  onOpenAlbum,
  onOpenArtist,
  onTagPress,
  busyTag = null,
  cardSize,
}: ArtistFooterProps) {
  return (
    <View style={styles.footer}>
      {albums.length > 0 ? (
        <ArtistShelf id="artist-albums" title={catalogStrings.artist.albums}>
          <HorizontalCatalogRail
            id="artist-albums"
            data={albums}
            keyExtractor={(album) => album.id}
            renderItem={(album) => (
              <CatalogAlbumCard
                album={album}
                cardSize={cardSize}
                testID={`artist-album-${catalogTestIdSegment(album.id)}`}
                onPress={() => onOpenAlbum({ albumId: album.id, title: album.title })}
              />
            )}
          />
        </ArtistShelf>
      ) : null}

      {related.length > 0 ? (
        <ArtistShelf id="artist-related" title={catalogStrings.artist.relatedArtists}>
          <HorizontalCatalogRail
            id="artist-related"
            data={related}
            keyExtractor={(artist) => artist.id}
            renderItem={(artist) => (
              <CatalogArtistCard
                artist={artist}
                cardSize={cardSize}
                testID={`artist-related-${catalogTestIdSegment(artist.id)}`}
                onPress={() => onOpenArtist({ artistId: artist.id, name: artist.name })}
              />
            )}
          />
        </ArtistShelf>
      ) : null}

      <CatalogSection
        id="artist-about"
        title={catalogStrings.artist.about}
        hasData={!aboutEnabled || about.data !== undefined}
        empty={!aboutEnabled || !artistAboutHasContent(about.data)}
        emptyLabel={catalogStrings.artist.aboutUnavailable}
        emptyIcon="text-box-outline"
        {...(aboutEnabled ? catalogQueryFlags(about) : settledCatalogQueryFlags)}
        onRetry={() => void about.refetch()}
        skeleton="text"
      >
        {about.data !== undefined ? (
          <ArtistAbout about={about.data} onTagPress={onTagPress} busyTag={busyTag} />
        ) : null}
      </CatalogSection>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: layout.sectionGap, paddingTop: layout.sectionGap },
  shelf: { gap: layout.headerGap },
});
