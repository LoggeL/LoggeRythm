import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ArtistRef, Track } from '../../api/types';
import { trackArtistCredits } from '../../api/trackArtists';
import { strings } from '../../localization';
import { trackAlbumRoute, trackArtistRoute } from '../../navigationLinks';
import { metrics, opacity, radii, spacing } from '../../theme';
import { AppText, createFocusRingController, FocusRingOverlay } from '../ui';

export interface NowPlayingMetadataProps {
  track: Track;
  onOpenAlbum: () => void;
  onOpenArtist: (artist: ArtistRef) => void;
  compact?: boolean;
  /** Enlarged 10-foot sizing when rendered inside the Android TV split layout. */
  isTv?: boolean;
}

/**
 * Production's track title and credited artists are links. Keep each action
 * only when its stored Deezer reference is valid; legacy metadata remains
 * readable without exposing a broken accessibility action.
 */
export default function NowPlayingMetadata({
  track,
  onOpenAlbum,
  onOpenArtist,
  compact = false,
  isTv = false,
}: NowPlayingMetadataProps) {
  const albumNavigable = trackAlbumRoute(track) !== null;
  const artists = trackArtistCredits(track);
  const titleVariant = compact ? 'bodyStrong' : isTv ? 'section' : 'title';
  const artistVariant = compact ? 'callout' : isTv ? 'body' : 'body';
  const albumFocus = createFocusRingController();
  const titleLinkStyle = isTv ? styles.tvLink : styles.link;
  const artistLinkStyle = isTv ? styles.tvArtistLink : styles.artistLink;

  return (
    <View testID="now-playing-metadata" style={styles.container}>
      {albumNavigable ? (
        <Pressable
          testID="now-playing-open-album"
          accessibilityRole="link"
          accessibilityLabel={strings.trackActions.openAlbum(track.album || track.title)}
          focusable
          onFocus={() => albumFocus.setFocused(true)}
          onBlur={() => albumFocus.setFocused(false)}
          onPress={onOpenAlbum}
          style={({ pressed }) => [titleLinkStyle, pressed && styles.pressed]}
        >
          <AppText variant={titleVariant} numberOfLines={compact ? 1 : 2}>
            {track.title}
          </AppText>
          <FocusRingOverlay controller={albumFocus} borderRadius={radii.sm} />
        </Pressable>
      ) : (
        <View testID="now-playing-title-text" style={titleLinkStyle}>
          <AppText variant={titleVariant} numberOfLines={compact ? 1 : 2}>
            {track.title}
          </AppText>
        </View>
      )}

      <View testID="now-playing-artist-credits" style={styles.artistRow}>
        {artists.map((artist, index) => {
          const artistNavigable = trackArtistRoute({
            artist_id: artist.id,
            artist: artist.name,
          }) !== null;
          const artistFocus = artistNavigable ? createFocusRingController() : null;
          return (
            <React.Fragment key={`${String(artist.id)}-${index}`}>
              {index > 0 ? (
                <AppText
                  testID={`now-playing-artist-separator-${index}`}
                  accessible={false}
                  variant={artistVariant}
                  color="secondary"
                >
                  {', '}
                </AppText>
              ) : null}
              {artistNavigable && artistFocus !== null ? (
                <Pressable
                  testID={`now-playing-open-artist-${index}`}
                  accessibilityRole="link"
                  accessibilityLabel={strings.trackActions.openArtist(artist.name)}
                  focusable
                  onFocus={() => artistFocus.setFocused(true)}
                  onBlur={() => artistFocus.setFocused(false)}
                  onPress={() => onOpenArtist(artist)}
                  style={({ pressed }) => [artistLinkStyle, pressed && styles.pressed]}
                >
                  <AppText variant={artistVariant} color="secondary" numberOfLines={1}>
                    {artist.name}
                  </AppText>
                  <FocusRingOverlay controller={artistFocus} borderRadius={radii.sm} />
                </Pressable>
              ) : (
                <AppText
                  testID={`now-playing-artist-text-${index}`}
                  variant={artistVariant}
                  color="secondary"
                  numberOfLines={1}
                >
                  {artist.name}
                </AppText>
              )}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

export const MemoNowPlayingMetadata = React.memo(NowPlayingMetadata);

const styles = StyleSheet.create({
  container: { minWidth: 0, flex: 1 },
  link: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    marginHorizontal: -spacing.xxs,
    borderRadius: radii.sm,
  },
  tvLink: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    marginHorizontal: -spacing.xxs,
    borderRadius: radii.sm,
  },
  artistRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  artistLink: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    justifyContent: 'center',
    maxWidth: '100%',
    paddingHorizontal: spacing.xxs,
    marginHorizontal: -spacing.xxs,
    borderRadius: radii.sm,
  },
  tvArtistLink: {
    minHeight: 28,
    justifyContent: 'center',
    maxWidth: '100%',
    paddingHorizontal: spacing.xxs,
    marginHorizontal: -spacing.xxs,
    borderRadius: radii.sm,
  },
  pressed: { opacity: opacity.pressed },
});
