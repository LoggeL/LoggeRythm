import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ArtistRef, Track } from '../../api/types';
import { trackArtistCredits } from '../../api/trackArtists';
import { strings } from '../../localization';
import { trackAlbumRoute, trackArtistRoute } from '../../navigationLinks';
import { metrics, opacity } from '../../theme';
import { AppText } from '../ui';

export interface NowPlayingMetadataProps {
  track: Track;
  onOpenAlbum: () => void;
  onOpenArtist: (artist: ArtistRef) => void;
  compact?: boolean;
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
}: NowPlayingMetadataProps) {
  const albumNavigable = trackAlbumRoute(track) !== null;
  const artists = trackArtistCredits(track);
  const artistVariant = compact ? 'callout' : 'body';

  return (
    <View testID="now-playing-metadata" style={styles.container}>
      {albumNavigable ? (
        <Pressable
          testID="now-playing-open-album"
          accessibilityRole="link"
          accessibilityLabel={strings.trackActions.openAlbum(track.album || track.title)}
          onPress={onOpenAlbum}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <AppText variant={compact ? 'bodyStrong' : 'title'} numberOfLines={compact ? 1 : 2}>
            {track.title}
          </AppText>
        </Pressable>
      ) : (
        <View testID="now-playing-title-text" style={styles.link}>
          <AppText variant={compact ? 'bodyStrong' : 'title'} numberOfLines={compact ? 1 : 2}>
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
              {artistNavigable ? (
                <Pressable
                  testID={`now-playing-open-artist-${index}`}
                  accessibilityRole="link"
                  accessibilityLabel={strings.trackActions.openArtist(artist.name)}
                  onPress={() => onOpenArtist(artist)}
                  style={({ pressed }) => [styles.artistLink, pressed && styles.pressed]}
                >
                  <AppText variant={artistVariant} color="secondary" numberOfLines={1}>
                    {artist.name}
                  </AppText>
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

const styles = StyleSheet.create({
  container: { minWidth: 0, flex: 1 },
  link: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    justifyContent: 'center',
  },
  artistRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  artistLink: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  pressed: { opacity: opacity.pressed },
});
