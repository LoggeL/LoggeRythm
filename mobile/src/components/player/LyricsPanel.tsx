import React, { useCallback, useEffect, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LyricsLine, LyricsResponse, Track } from '../../api/types';
import { musicQueries } from '../../data';
import type { RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, EmptyState, ErrorState, RetryButton, Skeleton } from '../ui';
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

const SKELETON_LINES = ['72%', '54%', '86%', '61%', '78%', '47%'] as const;

/** Placeholder lines shaped like the lyric rows they stand in for. */
function LyricsSkeleton() {
  return (
    <View
      testID="lyrics-loading"
      accessibilityRole="progressbar"
      accessibilityLabel={strings.player.lyrics.loading}
      accessibilityLiveRegion="polite"
      style={styles.skeleton}
    >
      {SKELETON_LINES.map((width, index) => (
        <Skeleton key={index} width={width} height={22} />
      ))}
    </View>
  );
}

function Badge({ testID, label }: { testID: string; label: string }) {
  return (
    <View testID={testID} style={styles.badge}>
      <AppText variant="micro" color="accent">{label}</AppText>
    </View>
  );
}

interface CachedNoticeProps {
  testID: string;
  message: string;
  retryBusy: boolean;
  onRetry: () => void;
}

/** Warning under still-valid cached lyrics, with the shared retry control. */
function CachedNotice({ testID, message, retryBusy, onRetry }: CachedNoticeProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.notice}
    >
      <AppText variant="caption" color="warning" style={styles.noticeCopy}>{message}</AppText>
      <RetryButton
        testID="lyrics-retry"
        accessibilityLabel={strings.player.lyrics.retry}
        busy={retryBusy}
        onRetry={onRetry}
      />
    </View>
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
        <AppText accessibilityRole="header" variant="overline" color="secondary">
          {strings.player.lyrics.title}
        </AppText>
        {response !== undefined ? (
          <View testID="lyrics-metadata" style={styles.badges}>
            {response.synced ? (
              <Badge testID="lyrics-synced" label={strings.player.lyrics.synchronized} />
            ) : null}
            {response.ai_generated ? (
              <Badge testID="lyrics-ai-generated" label={strings.player.lyrics.aiGenerated} />
            ) : null}
            {response.cached ? (
              <View
                testID="lyrics-cached"
                accessible
                accessibilityRole="image"
                accessibilityLabel={strings.player.lyrics.cached}
                style={styles.badge}
              >
                <AppIcon name="database-check-outline" color={colors.textSecondary} size={14} />
              </View>
            ) : null}
            {provider !== null ? (
              <AppText testID="lyrics-source" variant="micro" color="muted" numberOfLines={1}>
                {provider}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>

      {visual.body === 'loading' ? <LyricsSkeleton /> : null}

      {visual.body === 'hard-error' || visual.body === 'offline' ? (
        <ErrorState
          testID={visual.body === 'offline' ? 'lyrics-offline' : 'lyrics-error'}
          retryTestID="lyrics-retry"
          kind={visual.body === 'offline' ? 'offline' : 'error'}
          message={
            visual.body === 'offline'
              ? strings.player.lyrics.offline
              : strings.player.lyrics.loadFailed
          }
          retryAccessibilityLabel={strings.player.lyrics.retry}
          retryBusy={isFetching}
          onRetry={onRetry}
          style={styles.error}
        />
      ) : null}

      {visual.body === 'empty' ? (
        <EmptyState
          testID="lyrics-empty"
          icon="text-box-remove-outline"
          title={strings.player.lyrics.empty}
          style={styles.empty}
        />
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
                style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
              >
                <AppText variant="section" color={active ? 'primary' : 'muted'}>
                  {text}
                </AppText>
              </Pressable>
            );
          }}
        />
      ) : null}

      {visual.notice === 'refreshing' ? (
        <AppText
          testID="lyrics-refreshing"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.player.lyrics.refreshing}
          accessibilityLiveRegion="polite"
          variant="caption"
          color="secondary"
          align="center"
          style={styles.status}
        >
          {strings.player.lyrics.refreshing}
        </AppText>
      ) : null}

      {visual.notice === 'cached-refresh-error' ? (
        <CachedNotice
          testID="lyrics-cached-error"
          message={strings.player.lyrics.cachedRefreshFailed}
          retryBusy={isFetching}
          onRetry={onRetry}
        />
      ) : null}

      {visual.notice === 'cached-offline' ? (
        <CachedNotice
          testID="lyrics-cached-offline"
          message={strings.player.lyrics.cachedOffline}
          retryBusy={isFetching}
          onRetry={onRetry}
        />
      ) : null}

      {visual.notice === 'stale' ? (
        <AppText
          testID="lyrics-stale"
          accessibilityLiveRegion="polite"
          variant="caption"
          color="secondary"
          align="center"
          style={styles.status}
        >
          {strings.player.lyrics.stale}
        </AppText>
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

const BADGE_HEIGHT = 24;

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, paddingTop: spacing.sm },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: BADGE_HEIGHT,
    paddingBottom: spacing.xs,
  },
  badges: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xxs,
  },
  badge: {
    minHeight: BADGE_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  skeleton: { flex: 1, gap: spacing.lg, paddingTop: spacing.xl },
  error: { marginTop: spacing.md },
  empty: { flex: 1, justifyContent: 'center' },
  list: { flex: 1, minHeight: 0 },
  // Head and tail room lets the first and last line reach the vertical centre.
  listContent: { paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl * 3 },
  line: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  noticeCopy: { flex: 1 },
  status: { paddingVertical: spacing.xxs },
  pressed: { opacity: opacity.pressed },
});
