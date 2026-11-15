import React from 'react';
import { StyleSheet, View } from 'react-native';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { SearchTopResult } from '../../screens/searchModel';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork, PressableScale } from '../ui';

const TOP_RESULT_ARTWORK = layout.artwork.md + spacing.md;

interface SearchTopResultCardProps {
  result: SearchTopResult;
  onPress: () => void;
  onLongPress?: () => void;
}

interface TopResultCopy {
  title: string;
  subtitle: string;
  imageUri: string | null;
  accessibilityLabel: string;
  round: boolean;
  plays: boolean;
}

function topResultCopy(result: SearchTopResult): TopResultCopy {
  switch (result.kind) {
    case 'artist':
      return {
        title: result.artist.name,
        subtitle: strings.search.tabs.artist,
        imageUri: result.artist.picture,
        accessibilityLabel: strings.search.openArtist(result.artist.name),
        round: true,
        plays: false,
      };
    case 'track': {
      const artist = trackArtistLabel(result.track);
      return {
        title: result.track.title,
        subtitle: `${strings.search.tabs.track} · ${artist}`,
        imageUri: result.track.cover,
        accessibilityLabel: strings.common.trackBy(result.track.title, artist),
        round: false,
        plays: true,
      };
    }
    case 'album':
      return {
        title: result.album.title,
        subtitle: `${strings.search.tabs.album} · ${result.album.artistName}`,
        imageUri: result.album.artworkUrl,
        accessibilityLabel: strings.search.openAlbum(result.album.title, result.album.artistName),
        round: false,
        plays: false,
      };
  }
}

/**
 * The hero of a result page: the best hit as one large card. The whole card
 * is a single button; the trailing disc only signals what the tap does.
 */
export function SearchTopResultCard({ result, onPress, onLongPress }: SearchTopResultCardProps) {
  const copy = topResultCopy(result);
  return (
    <View testID="search-section-top-result" style={styles.section}>
      <PressableScale
        testID="search-top-result"
        accessibilityRole="button"
        accessibilityLabel={`${strings.search.topResult}: ${copy.accessibilityLabel}`}
        onPress={onPress}
        onLongPress={onLongPress}
        scaleTo={0.98}
        style={styles.card}
      >
        <Artwork
          uri={copy.imageUri}
          size={TOP_RESULT_ARTWORK}
          shape={copy.round ? 'round' : 'square'}
          icon={copy.round ? 'account-music' : 'music-note'}
        />
        <View style={styles.copy}>
          <AppText variant="overline" color="accent">{strings.search.topResult}</AppText>
          <AppText variant="section" numberOfLines={2}>{copy.title}</AppText>
          <AppText variant="callout" color="secondary" numberOfLines={1}>{copy.subtitle}</AppText>
        </View>
        <View style={[styles.disc, copy.plays ? styles.discPlay : styles.discOpen]}>
          <AppIcon
            name={copy.plays ? 'play' : 'chevron-right'}
            color={copy.plays ? colors.onAccent : colors.textPrimary}
            size={24}
          />
        </View>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: layout.pagePadding, paddingTop: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  disc: {
    width: layout.artwork.sm,
    height: layout.artwork.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discPlay: { backgroundColor: colors.accent },
  discOpen: { backgroundColor: colors.fill },
});
