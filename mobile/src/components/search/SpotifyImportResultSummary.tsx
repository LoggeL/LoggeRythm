import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ResolveResult } from '../../api/types';
import { strings } from '../../localization';
import { layout, spacing } from '../../theme';
import { AppText, Artwork, PlayButton, Surface } from '../ui';
import { SearchErrorNotice } from './SearchRemoteStates';

interface SpotifyImportResultSummaryProps {
  result: ResolveResult;
  runtimeError: string | null;
  saveFeedback: string | null;
  /** Index whose playback is starting, or null. */
  playingIndex: number | null;
  onPlayAll: () => void;
}

/** What the link resolved to: cover, name, match counts and the play-all control. */
export function SpotifyImportResultSummary({
  result,
  runtimeError,
  saveFeedback,
  playingIndex,
  onPlayAll,
}: SpotifyImportResultSummaryProps) {
  const unmatched = result.unmatched.length > 0
    ? ` · ${strings.search.importUnmatched(result.unmatched.length)}`
    : '';
  return (
    <Surface testID="spotify-import-result" padded style={styles.panel}>
      <View style={styles.identity}>
        <Artwork uri={result.image} size={layout.artwork.lg} icon="playlist-music" />
        <View style={styles.copy}>
          <AppText variant="overline" color="accent">
            {strings.search.importType[result.type]}
          </AppText>
          <AppText variant="section" accessibilityRole="header" numberOfLines={3}>
            {result.name}
          </AppText>
          <AppText variant="callout" color="secondary">
            {strings.search.importMatched(result.matched, result.total)}{unmatched}
          </AppText>
          {result.source_total > result.total ? (
            <AppText variant="caption" color="muted">
              {strings.search.importTruncated(result.source_total, result.total)}
            </AppText>
          ) : null}
        </View>
        <PlayButton
          testID="spotify-import-play-all"
          accessibilityLabel={strings.search.importPlayAll}
          busy={playingIndex === 0}
          disabled={result.tracks.length === 0 || playingIndex !== null}
          onPress={onPlayAll}
        />
      </View>
      {runtimeError !== null ? (
        <View style={styles.flushNotice}>
          <SearchErrorNotice testID="spotify-import-runtime-error" message={runtimeError} />
        </View>
      ) : null}
      {saveFeedback !== null ? (
        <AppText
          testID="spotify-import-save-success"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          variant="callout"
          color="success"
        >
          {saveFeedback}
        </AppText>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  /** The notice brings its own page gutter; cancel it inside the padded panel. */
  flushNotice: { marginHorizontal: -layout.pagePadding, marginBottom: -spacing.sm },
  panel: { marginHorizontal: layout.pagePadding, marginBottom: spacing.xs, gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
});
