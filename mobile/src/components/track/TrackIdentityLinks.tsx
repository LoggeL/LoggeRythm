import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors } from '../../theme';
import type { TrackMetadata } from './trackMetadata';

export interface TrackIdentityCopy {
  openAlbum: (album: string) => string;
  openArtist: (artist: string) => string;
  duration: (value: string) => string;
  playCount: (plays: number, listeners: number) => string;
  popularity: (percent: number) => string;
}

export interface TrackIdentityLinksProps {
  metadata: TrackMetadata;
  testID: string;
  copy: TrackIdentityCopy;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  showAlbumLabel?: boolean;
  showDuration?: boolean;
  showPopularity?: boolean;
}

/**
 * The shared, bounded identity presentation for every track surface. Catalog
 * navigation uses inline Text links so every title remains one line and all
 * secondary metadata shares exactly one ellipsized line.
 */
export default function TrackIdentityLinks({
  metadata,
  testID,
  copy,
  onOpenAlbum,
  onOpenArtist,
  showAlbumLabel = true,
  showDuration = true,
  showPopularity = true,
}: TrackIdentityLinksProps) {
  const albumActionLabel = metadata.album.trim() || metadata.title;
  const popularityText = !showPopularity || metadata.popularity === null
    ? null
    : metadata.popularity.kind === 'plays'
      ? copy.playCount(metadata.popularity.plays, metadata.popularity.listeners)
      : copy.popularity(metadata.popularity.percent);
  const durationText = showDuration && metadata.duration !== null
    ? copy.duration(metadata.duration)
    : null;
  const hasAlbum = showAlbumLabel && metadata.album.trim().length > 0;
  const hasFacts = durationText !== null || popularityText !== null;

  return (
    <View testID={testID} style={styles.container}>
      {metadata.albumRoute !== null ? (
        <Text
          testID={`${testID}-album-link`}
          accessibilityRole="link"
          accessibilityLabel={copy.openAlbum(albumActionLabel)}
          onPress={() => onOpenAlbum(metadata.albumRoute as AlbumRouteParams)}
          style={styles.title}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {metadata.title}
        </Text>
      ) : (
        <Text
          testID={`${testID}-title-text`}
          style={styles.title}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {metadata.title}
        </Text>
      )}

      <Text
        testID={`${testID}-details`}
        style={styles.details}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {metadata.artists.map((artist, index) => (
          <React.Fragment key={artist.key}>
            {index > 0 ? (
              <Text
                testID={`${testID}-artist-separator-${index}`}
                accessible={false}
                style={styles.secondary}
              >
                {', '}
              </Text>
            ) : null}
            {artist.route !== null ? (
              <Text
                testID={`${testID}-artist-link-${index}`}
                accessibilityRole="link"
                accessibilityLabel={copy.openArtist(artist.name)}
                onPress={() => onOpenArtist(artist.route as ArtistRouteParams)}
                style={styles.secondary}
              >
                {artist.name}
              </Text>
            ) : (
              <Text
                testID={`${testID}-artist-text-${index}`}
                style={styles.secondary}
              >
                {artist.name}
              </Text>
            )}
          </React.Fragment>
        ))}

        {hasAlbum ? (
          <>
            <Text accessible={false} style={styles.secondary}>{' · '}</Text>
            {metadata.albumRoute !== null ? (
              <Text
                testID={`${testID}-album-label-link`}
                accessibilityRole="link"
                accessibilityLabel={copy.openAlbum(metadata.album)}
                onPress={() => onOpenAlbum(metadata.albumRoute as AlbumRouteParams)}
                style={styles.secondary}
              >
                {metadata.album}
              </Text>
            ) : (
              <Text testID={`${testID}-album-label-text`} style={styles.secondary}>
                {metadata.album}
              </Text>
            )}
          </>
        ) : null}

        {hasFacts ? (
          <>
            <Text accessible={false} style={styles.fact}>{' · '}</Text>
            {durationText !== null ? (
              <Text testID={`${testID}-duration`} style={styles.fact}>{durationText}</Text>
            ) : null}
            {durationText !== null && popularityText !== null ? (
              <Text accessible={false} style={styles.fact}>{' · '}</Text>
            ) : null}
            {popularityText !== null ? (
              <Text testID={`${testID}-popularity`} style={styles.fact}>{popularityText}</Text>
            ) : null}
          </>
        ) : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 0, flex: 1, justifyContent: 'center' },
  title: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
  },
  details: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  secondary: { color: colors.textSecondary, fontSize: 12 },
  fact: { color: colors.textSecondary, fontSize: 11 },
});
