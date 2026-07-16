import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, metrics } from '../../theme';
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
 * Identity-only content for use beside a dedicated playback control. It never
 * creates a play responder, so catalog links can remain sibling Pressables.
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

  return (
    <View testID={testID} style={styles.container}>
      {metadata.albumRoute !== null ? (
        <Pressable
          testID={`${testID}-album-link`}
          accessibilityRole="link"
          accessibilityLabel={copy.openAlbum(albumActionLabel)}
          onPress={() => onOpenAlbum(metadata.albumRoute as AlbumRouteParams)}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={styles.title} numberOfLines={1}>{metadata.title}</Text>
        </Pressable>
      ) : (
        <View testID={`${testID}-title-text`} style={styles.inertLine}>
          <Text style={styles.title} numberOfLines={1}>{metadata.title}</Text>
        </View>
      )}

      <View testID={`${testID}-artists`} style={styles.artistRow}>
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
              <Pressable
                testID={`${testID}-artist-link-${index}`}
                accessibilityRole="link"
                accessibilityLabel={copy.openArtist(artist.name)}
                onPress={() => onOpenArtist(artist.route as ArtistRouteParams)}
                style={({ pressed }) => [styles.artistLink, pressed && styles.pressed]}
              >
                <Text style={styles.secondary}>{artist.name}</Text>
              </Pressable>
            ) : (
              <Text
                testID={`${testID}-artist-text-${index}`}
                style={styles.inertArtist}
              >
                {artist.name}
              </Text>
            )}
          </React.Fragment>
        ))}
      </View>

      {showAlbumLabel && metadata.album.trim().length > 0 ? (
        metadata.albumRoute !== null ? (
          <Pressable
            testID={`${testID}-album-label-link`}
            accessibilityRole="link"
            accessibilityLabel={copy.openAlbum(metadata.album)}
            onPress={() => onOpenAlbum(metadata.albumRoute as AlbumRouteParams)}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text style={styles.album} numberOfLines={1}>{metadata.album}</Text>
          </Pressable>
        ) : (
          <Text testID={`${testID}-album-label-text`} style={styles.album} numberOfLines={1}>
            {metadata.album}
          </Text>
        )
      ) : null}

      {durationText !== null || popularityText !== null ? (
        <View testID={`${testID}-facts`} style={styles.factRow}>
          {durationText !== null ? (
            <Text testID={`${testID}-duration`} style={styles.fact}>{durationText}</Text>
          ) : null}
          {durationText !== null && popularityText !== null ? (
            <Text accessible={false} style={styles.fact}>{' · '}</Text>
          ) : null}
          {popularityText !== null ? (
            <Text testID={`${testID}-popularity`} style={styles.fact}>{popularityText}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 0, flex: 1 },
  link: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  inertLine: { minHeight: metrics.minimumTouchTarget, justifyContent: 'center' },
  artistRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  artistLink: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
  },
  inertArtist: {
    minHeight: metrics.minimumTouchTarget,
    textAlignVertical: 'center',
    color: colors.textSecondary,
  },
  pressed: { opacity: 0.72 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  secondary: { color: colors.textSecondary, fontSize: 13 },
  album: { color: colors.textSecondary, fontSize: 12 },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  fact: { color: colors.textSecondary, fontSize: 11 },
});
