import React, { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LyricsLine, LyricsResponse, Track } from '../../api/types';
import { musicQueries } from '../../data';
import type { RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, metrics } from '../../theme';
import {
  activeLyricIndex,
  lyricLineKey,
  lyricsFollowTarget,
  lyricsSourceKind,
  resolveLyricsVisualState,
  type LyricsFollowIdentity,
} from '../../screens/lyricsModel';

export interface LyricsPanelProps {
  track: Track;
  position: number;
  onSeek: (seconds: number) => void;
}

export interface LyricsPanelViewProps {
  response: LyricsResponse | undefined;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: RemoteFetchStatus;
  activeIndex: number;
  onSeek: (seconds: number) => void;
  onRetry: () => void;
  listRef?: React.RefObject<FlatList<LyricsLine> | null>;
  onScrollToIndexFailed?: (info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => void;
}

function formatTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function sourceLabel(response: LyricsResponse): string | null {
  switch (lyricsSourceKind(response.source)) {
    case 'lrclib':
      return strings.player.lyrics.source(strings.player.lyrics.sources.lrclib);
    case 'loggerythm-ai':
      return strings.player.lyrics.source(strings.player.lyrics.sources.loggerythmAi);
    case 'external':
      return strings.player.lyrics.source(strings.player.lyrics.sources.external);
    case null:
      return null;
  }
}

function retryButton(busy: boolean, onRetry: () => void) {
  return (
    <Pressable
      testID="lyrics-retry"
      accessibilityRole="button"
      accessibilityLabel={strings.player.lyrics.retry}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onRetry}
      style={({ pressed }) => [styles.retry, pressed && styles.pressed, busy && styles.disabled]}
    >
      <Text style={styles.retryText}>{strings.common.retry}</Text>
    </Pressable>
  );
}

/** Pure rendering contract; network state and auto-follow ownership live outside it. */
export function LyricsPanelView({
  response,
  error,
  isPending,
  isFetching,
  isStale,
  fetchStatus,
  activeIndex,
  onSeek,
  onRetry,
  listRef,
  onScrollToIndexFailed,
}: LyricsPanelViewProps) {
  const visual = resolveLyricsVisualState({
    data: response,
    error,
    isPending,
    isFetching,
    isStale,
    fetchStatus,
  });
  const lines = response?.lines ?? [];
  const provider = response === undefined ? null : sourceLabel(response);

  return (
    <View testID="lyrics-panel" style={styles.panel}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          {strings.player.lyrics.title}
        </Text>
        {response !== undefined ? (
          <View testID="lyrics-metadata" style={styles.badges}>
            {response.synced ? (
              <Text testID="lyrics-synced" style={styles.badge}>
                {strings.player.lyrics.synchronized}
              </Text>
            ) : null}
            {response.ai_generated ? (
              <Text testID="lyrics-ai-generated" style={styles.badge}>
                {strings.player.lyrics.aiGenerated}
              </Text>
            ) : null}
            {response.cached ? (
              <Text testID="lyrics-cached" style={styles.badge}>
                {strings.player.lyrics.cached}
              </Text>
            ) : null}
            {provider !== null ? (
              <Text testID="lyrics-source" style={styles.source}>{provider}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {visual.body === 'loading' ? (
        <View
          testID="lyrics-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.player.lyrics.loading}
          accessibilityLiveRegion="polite"
          style={styles.centered}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{strings.player.lyrics.loading}</Text>
        </View>
      ) : null}

      {visual.body === 'hard-error' ? (
        <View
          testID="lyrics-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.errorText}>{strings.player.lyrics.loadFailed}</Text>
          {retryButton(isFetching, onRetry)}
        </View>
      ) : null}

      {visual.body === 'offline' ? (
        <View
          testID="lyrics-offline"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.errorText}>{strings.player.lyrics.offline}</Text>
          {retryButton(isFetching, onRetry)}
        </View>
      ) : null}

      {visual.body === 'empty' ? (
        <View testID="lyrics-empty" accessibilityLiveRegion="polite" style={styles.centered}>
          <Text style={styles.status}>{strings.player.lyrics.empty}</Text>
        </View>
      ) : null}

      {visual.body === 'content' ? (
        <FlatList
          ref={listRef}
          testID="lyrics-list"
          style={styles.list}
          data={lines}
          keyExtractor={lyricLineKey}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={onScrollToIndexFailed}
          renderItem={({ item, index }) => {
            const active = index === activeIndex;
            const text = item.text.trim() || strings.player.lyrics.instrumentalLine;
            return (
              <Pressable
                testID={`lyrics-line-${index}`}
                accessibilityRole="button"
                accessibilityLabel={strings.player.lyrics.lineLabel(
                  text,
                  formatTimestamp(item.t),
                )}
                accessibilityHint={strings.player.lyrics.lineSeekHint}
                accessibilityState={{ selected: active }}
                onPress={() => onSeek(item.t)}
                style={({ pressed }) => [
                  styles.line,
                  active && styles.activeLine,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.lineText, active && styles.activeLineText]}>
                  {text}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : null}

      {visual.notice === 'refreshing' ? (
        <Text
          testID="lyrics-refreshing"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.player.lyrics.refreshing}
          accessibilityLiveRegion="polite"
          style={styles.noticeText}
        >
          {strings.player.lyrics.refreshing}
        </Text>
      ) : null}

      {visual.notice === 'cached-refresh-error' ? (
        <View
          testID="lyrics-cached-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.noticeText}>{strings.player.lyrics.cachedRefreshFailed}</Text>
          {retryButton(isFetching, onRetry)}
        </View>
      ) : null}

      {visual.notice === 'cached-offline' ? (
        <View
          testID="lyrics-cached-offline"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.noticeText}>{strings.player.lyrics.cachedOffline}</Text>
          {retryButton(isFetching, onRetry)}
        </View>
      ) : null}

      {visual.notice === 'stale' ? (
        <Text
          testID="lyrics-stale"
          accessibilityLiveRegion="polite"
          style={styles.noticeText}
        >
          {strings.player.lyrics.stale}
        </Text>
      ) : null}
    </View>
  );
}

/** Own the lazy lyrics query and visual auto-follow for exactly one active track. */
export default function LyricsPanel({ track, position, onSeek }: LyricsPanelProps) {
  const query = useQuery(musicQueries.lyrics(track.artist, track.title, track.id));
  const lines = query.data?.lines ?? [];
  const activeIndex = activeLyricIndex(lines, position);
  const listRef = useRef<FlatList<LyricsLine>>(null);
  const previousFollow = useRef<LyricsFollowIdentity | null>(null);

  useEffect(() => {
    const current = { trackId: track.id, activeIndex };
    const target = lyricsFollowTarget(previousFollow.current, current);
    previousFollow.current = current;
    if (target === null) return;
    listRef.current?.scrollToIndex({
      index: target.index,
      viewPosition: 0.5,
      animated: target.animated,
    });
  }, [activeIndex, track.id]);

  const handleScrollFailure = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // Variable lyric line heights can be unmeasured on first render. Move to
      // the closest measured estimate; the next active line resumes centering.
      listRef.current?.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * Math.max(0, info.index - 2)),
        animated: false,
      });
    },
    [],
  );

  return (
    <LyricsPanelView
      response={query.data}
      error={query.error}
      isPending={query.isPending}
      isFetching={query.isFetching}
      isStale={query.isStale}
      fetchStatus={query.fetchStatus}
      activeIndex={activeIndex}
      onSeek={onSeek}
      onRetry={() => void query.refetch()}
      listRef={listRef}
      onScrollToIndexFailed={handleScrollFailure}
    />
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, paddingTop: 12 },
  header: { alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingBottom: 10 },
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  badges: {
    minHeight: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 5,
  },
  badge: {
    color: colors.accent,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: '800',
  },
  source: { color: colors.textSecondary, fontSize: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  status: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorBox: {
    marginTop: 18,
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retry: {
    alignSelf: 'center',
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    borderRadius: 24,
    paddingHorizontal: 20,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.onAccent, fontSize: 13, fontWeight: '800' },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingTop: 80, paddingBottom: 120 },
  line: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  activeLine: { backgroundColor: colors.surfaceElevated },
  lineText: {
    color: colors.textSecondary,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '700',
    textAlign: 'center',
    opacity: 0.55,
  },
  activeLineText: { color: colors.accent, opacity: 1 },
  notice: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  noticeText: { color: colors.warning, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
