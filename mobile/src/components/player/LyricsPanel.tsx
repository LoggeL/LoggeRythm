import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LyricsLine, LyricsResponse, Track } from '../../api/types';
import { musicQueries } from '../../data';
import type { RemoteFetchStatus } from '../../data/remoteState';
import { triggerHaptic } from '../../hooks/useHaptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { strings } from '../../localization';
import { useProgress } from '../../player/player';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import {
  ActionButton,
  AppText,
  createFocusRingController,
  EmptyState,
  ErrorState,
  FocusRingOverlay,
  RetryButton,
  Skeleton,
} from '../ui';
import {
  activeLyricIndex,
  lyricLineKey,
  lyricsFollowTarget,
  lyricsSourceKind,
  resolveLyricsVisualState,
  type LyricsFollowIdentity,
} from '../../screens/lyricsModel';

const EMPTY_LINES: readonly LyricsLine[] = Object.freeze([]);

export interface LyricsPanelProps {
  track: Track;
  position: number;
  onSeek: (seconds: number) => void;
}

export interface LiveLyricsPanelProps {
  track: Track;
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
  autoScrollPaused?: boolean;
  onUserScrollStart?: () => void;
  onSyncToCurrent?: () => void;
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

function Badge({
  testID,
  label,
  tone = 'accent',
}: {
  testID: string;
  label: string;
  tone?: 'accent' | 'secondary';
}) {
  return (
    <View testID={testID} style={styles.badge}>
      <AppText variant="micro" color={tone}>{label}</AppText>
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
  autoScrollPaused = false,
  onUserScrollStart,
  onSyncToCurrent,
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
  const lines = response?.lines ?? EMPTY_LINES;
  const isSynced = response?.synced === true;
  const provider = response === undefined ? null : sourceLabel(response);
  const showSyncAction = visual.body === 'content' && isSynced && autoScrollPaused && onSyncToCurrent !== undefined;

  return (
    <View testID="lyrics-panel" style={styles.panel}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" variant="overline" color="secondary">
          {strings.player.lyrics.title}
        </AppText>
        {response !== undefined ? (
          <View testID="lyrics-metadata" style={styles.badges}>
            {isSynced ? (
              <Badge testID="lyrics-synced" label={strings.player.lyrics.synchronized} />
            ) : (
              <Badge
                testID="lyrics-unsynced"
                label={strings.player.lyrics.notSynchronized}
                tone="secondary"
              />
            )}
            {response.ai_generated ? (
              <Badge testID="lyrics-ai-generated" label={strings.player.lyrics.aiGenerated} />
            ) : null}
            {response.cached ? (
              <View
                testID="lyrics-cached"
                accessible
                focusable={false}
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
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            testID="lyrics-list"
            style={styles.list}
            data={lines as LyricsLine[]}
            keyExtractor={lyricLineKey}
            contentContainerStyle={isSynced ? styles.listContent : styles.unsyncedListContent}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            onScrollBeginDrag={onUserScrollStart}
            onScrollToIndexFailed={onScrollToIndexFailed}
            renderItem={({ item, index }) => {
              const active = isSynced && index === activeIndex;
              const text = item.text.trim() || strings.player.lyrics.instrumentalLine;
              if (!isSynced) {
                return (
                  <View testID={`lyrics-line-${index}`} style={styles.line}>
                    <AppText variant="section" color="primary">
                      {text}
                    </AppText>
                  </View>
                );
              }
              const focusController = createFocusRingController();
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
                  focusable
                  onFocus={() => focusController.setFocused(true)}
                  onBlur={() => focusController.setFocused(false)}
                  onPress={() => onSeek(item.t)}
                  style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
                >
                  <AppText variant="section" color={active ? 'primary' : 'muted'}>
                    {text}
                  </AppText>
                  <FocusRingOverlay controller={focusController} borderRadius={radii.sm} />
                </Pressable>
              );
            }}
          />
          {showSyncAction ? (
            <View
              testID="lyrics-auto-scroll-paused"
              accessibilityLiveRegion="polite"
              style={styles.syncOverlay}
            >
              <ActionButton
                testID="lyrics-sync-button"
                variant="secondary"
                icon="crosshairs-gps"
                label={strings.player.lyrics.syncToCurrent}
                accessibilityLabel={strings.player.lyrics.followActiveLine}
                accessibilityHint={strings.player.lyrics.autoScrollPaused}
                focusable
                onPress={onSyncToCurrent}
                style={styles.syncButton}
              />
            </View>
          ) : null}
        </View>
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

const MemoLyricsPanelView = React.memo(LyricsPanelView);

/** Own the lazy lyrics query and visual auto-follow for exactly one active track. */
export default function LyricsPanel({ track, position, onSeek }: LyricsPanelProps) {
  const query = useQuery(musicQueries.lyrics(track.artist, track.title, track.id));
  const reducedMotion = useReducedMotion();
  const isSynced = query.data?.synced === true;
  const lines = useMemo(() => query.data?.lines ?? EMPTY_LINES, [query.data?.lines]);
  const activeIndex = isSynced ? activeLyricIndex(lines, position) : -1;
  const listRef = useRef<FlatList<LyricsLine>>(null);
  const previousFollow = useRef<LyricsFollowIdentity | null>(null);
  const [pausedTrackId, setPausedTrackId] = useState<string | null>(null);
  const autoScrollPaused = isSynced && pausedTrackId === track.id;

  useEffect(() => {
    if (!isSynced) {
      previousFollow.current = { trackId: track.id, activeIndex: -1 };
      return;
    }
    const current = { trackId: track.id, activeIndex };
    const target = lyricsFollowTarget(previousFollow.current, current);
    previousFollow.current = current;
    if (target === null || autoScrollPaused) return;
    listRef.current?.scrollToIndex({
      index: target.index,
      viewPosition: 0.5,
      animated: target.animated && !reducedMotion,
    });
  }, [activeIndex, autoScrollPaused, isSynced, reducedMotion, track.id]);

  const handleUserScrollStart = useCallback(() => {
    if (!isSynced || activeIndex < 0) return;
    setPausedTrackId(track.id);
  }, [activeIndex, isSynced, track.id]);

  const handleSyncToCurrent = useCallback(() => {
    setPausedTrackId(null);
    if (!isSynced || activeIndex < 0) return;
    listRef.current?.scrollToIndex({
      index: activeIndex,
      viewPosition: 0.5,
      animated: !reducedMotion,
    });
  }, [activeIndex, isSynced, reducedMotion]);

  const handleSeek = useCallback(
    (seconds: number) => {
      triggerHaptic('tap');
      setPausedTrackId(null);
      onSeek(seconds);
    },
    [onSeek],
  );

  const handleRetry = useCallback(() => {
    void query.refetch();
  }, [query]);

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
    <MemoLyricsPanelView
      response={query.data}
      error={query.error}
      isPending={query.isPending}
      isFetching={query.isFetching}
      isStale={query.isStale}
      fetchStatus={query.fetchStatus}
      activeIndex={activeIndex}
      onSeek={handleSeek}
      onRetry={handleRetry}
      listRef={listRef}
      autoScrollPaused={autoScrollPaused}
      onUserScrollStart={handleUserScrollStart}
      onSyncToCurrent={handleSyncToCurrent}
      onScrollToIndexFailed={handleScrollFailure}
    />
  );
}

/**
 * Progress-isolated LyricsPanel wrapper. Keeps `useProgress(0.5)` strictly
 * scoped to active-line tracking so parent screens never re-render at 1Hz.
 */
export const LiveLyricsPanel = React.memo(function LiveLyricsPanel({
  track,
  onSeek,
}: LiveLyricsPanelProps) {
  const { position } = useProgress(0.5);
  return <LyricsPanel track={track} position={position} onSeek={onSeek} />;
});

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
  listWrap: { flex: 1, minHeight: 0, position: 'relative' },
  list: { flex: 1, minHeight: 0 },
  // Head and tail room lets the first and last line reach the vertical centre.
  listContent: { paddingTop: spacing.xxxl, paddingBottom: spacing.xxxl * 3 },
  unsyncedListContent: { paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  line: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.sm,
  },
  syncOverlay: {
    position: 'absolute',
    right: 0,
    bottom: spacing.sm,
    left: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  syncButton: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
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
