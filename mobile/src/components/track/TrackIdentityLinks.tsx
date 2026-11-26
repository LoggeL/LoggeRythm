import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, opacity, spacing, typography } from '../../theme';
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
  /** Tints the title while this exact occurrence is the active track. */
  active?: boolean;
  /**
   * When `false`, renders plain non-pressable text so a parent row-wide
   * tap-to-play Pressable receives every tap without nested Pressables or
   * accidental Album/Artist screen hijacks. Defaults to `true`.
   */
  interactive?: boolean;
}

// Both lines are far thinner than a touch target, so each link line claims
// the free space of its host row on its outer side: the title upwards, the
// secondary line downwards. Together they split the row height without
// overlapping each other or a neighbouring control.
const TITLE_HIT_SLOP = { top: spacing.xs } as const;
const DETAILS_HIT_SLOP = { bottom: spacing.xs } as const;

/**
 * The shared, bounded identity presentation for every track surface: the
 * title stays one line and all secondary metadata shares exactly one
 * ellipsized line. When `interactive` is true, the title and artist lines
 * expose explicit album/artist links; when `interactive` is false (e.g. inside
 * row-wide tap-to-play `StandardTrackRow`), it renders plain text with zero
 * nested responders.
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
  active = false,
  interactive = true,
}: TrackIdentityLinksProps) {
  const albumActionLabel = metadata.album.trim() || metadata.title;
  const popularityText = !showPopularity || metadata.popularity === null
    ? null
    : metadata.popularity.kind === 'plays'
      ? copy.playCount(metadata.popularity.plays, metadata.popularity.listeners)
      : copy.popularity(metadata.popularity.percent);
  // The bare runtime is what is shown; the worded form is its spoken label.
  const durationLabel = showDuration && metadata.duration !== null
    ? copy.duration(metadata.duration)
    : null;
  const hasAlbum = showAlbumLabel && metadata.album.trim().length > 0;
  const titleStyle = active ? [styles.title, styles.titleActive] : styles.title;
  const primaryArtist = interactive
    ? metadata.artists.find((artist) => artist.route !== null)
    : undefined;

  // Names share one ellipsized run; the runtime sits beside it and never
  // shrinks, so a long artist or album cannot cut "3:25" down to "3…".
  const details = (
    <View style={styles.detailsRow}>
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
            {interactive && artist.route !== null ? (
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
            {interactive && metadata.albumRoute !== null ? (
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

        {popularityText !== null ? (
          <>
            <Text accessible={false} style={styles.fact}>{' · '}</Text>
            <Text testID={`${testID}-popularity`} style={styles.fact}>{popularityText}</Text>
          </>
        ) : null}
      </Text>
      {durationLabel !== null ? (
        <>
          <Text accessible={false} style={styles.durationSeparator}>{' · '}</Text>
          <Text
            testID={`${testID}-duration`}
            accessibilityLabel={durationLabel}
            style={styles.duration}
          >
            {metadata.duration}
          </Text>
        </>
      ) : null}
    </View>
  );

  return (
    <View testID={testID} style={styles.container}>
      {interactive && metadata.albumRoute !== null ? (
        <Pressable
          testID={`${testID}-album-link`}
          accessibilityRole="link"
          accessibilityLabel={copy.openAlbum(albumActionLabel)}
          onPress={() => onOpenAlbum(metadata.albumRoute as AlbumRouteParams)}
          hitSlop={TITLE_HIT_SLOP}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <Text
            testID={`${testID}-title-text`}
            style={titleStyle}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {metadata.title}
          </Text>
        </Pressable>
      ) : (
        <Text
          testID={`${testID}-title-text`}
          style={titleStyle}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {metadata.title}
        </Text>
      )}

      {primaryArtist === undefined ? details : (
        // Not one accessibility element: the inline links stay individually
        // focusable, this only enlarges the touch area of the artist line.
        <Pressable
          testID={`${testID}-artist-target`}
          accessible={false}
          onPress={() => onOpenArtist(primaryArtist.route as ArtistRouteParams)}
          hitSlop={DETAILS_HIT_SLOP}
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          {details}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 0, flex: 1, justifyContent: 'center' },
  title: { ...typography.bodyStrong, color: colors.textPrimary },
  titleActive: { color: colors.accentSoft },
  detailsRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  details: { ...typography.callout, flexShrink: 1, color: colors.textSecondary },
  durationSeparator: { ...typography.callout, flexShrink: 0, color: colors.textMuted },
  duration: { ...typography.callout, flexShrink: 0, color: colors.textMuted },
  secondary: { color: colors.textSecondary },
  fact: { color: colors.textMuted },
  pressed: { opacity: opacity.pressed },
});
