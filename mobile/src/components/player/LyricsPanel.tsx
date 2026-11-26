import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LyricsVariant } from '../../api/endpoints';
import type { LyricsLine, LyricsResponse, LyricsWord, Track } from '../../api/types';
import { musicQueries } from '../../data';
import type { RemoteFetchStatus } from '../../data/remoteState';
import { triggerHaptic } from '../../hooks/useHaptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { strings } from '../../localization';
import { wave2Strings } from '../../localization/wave2Strings';
import { useEffectiveProgress } from '../../connect/effectivePlaybackState';
import { shareLyricQuote } from '../../share/outboundShare';
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
  position?: number;
  onSeek: (seconds: number) => void;
  onRetry: () => void;
  listRef?: React.RefObject<FlatList<LyricsLine> | null>;
  autoScrollPaused?: boolean;
  onUserScrollStart?: () => void;
  onSyncToCurrent?: () => void;
  variant?: LyricsVariant;
  onToggleVariant?: () => void;
  onShareLine?: (index: number) => void;
  shareError?: string | null;
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

function KaraokeWordsLine({
  words,
  position,
}: {
  words: readonly LyricsWord[];
  position: number;
}) {
  const leadPosition = position + 0.12;
  return (
    <AppText testID="lyrics-karaoke-line" variant="section" color="muted">
      {words.map((word, idx) => {
        const isCurrent = leadPosition >= word.t && position <= word.end + 0.08;
        const isSung = position > word.end + 0.08;
        const color = isCurrent
          ? colors.accent
          : isSung
            ? colors.textPrimary
            : colors.textMuted;
        return (
          <Text
            key={`${word.t}-${idx}`}
            style={{ color, fontWeight: isCurrent ? '700' : '600' }}
          >
            {idx > 0 ? ' ' : ''}
            {word.text}
          </Text>
        );
      })}
    </AppText>
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
  position = 0,
  onSeek,
  onRetry,
  listRef,
  autoScrollPaused = false,
  onUserScrollStart,
  onSyncToCurrent,
  variant = 'default',
  onToggleVariant,
  onShareLine,
  shareError = null,
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
  const isInstrumental = response?.instrumental === true;
  const hasWordTimings = isSynced && lines.some((line) => (line.words?.length ?? 0) > 0);
  const provider = response === undefined ? null : sourceLabel(response);
  const showSyncAction =
    !isInstrumental
    && visual.body === 'content'
    && isSynced
    && autoScrollPaused
    && onSyncToCurrent !== undefined;

  return (
    <View testID="lyrics-panel" style={styles.panel}>
      <View style={styles.header}>
        <AppText accessibilityRole="header" variant="overline" color="secondary">
          {strings.player.lyrics.title}
        </AppText>
        {onToggleVariant !== undefined ? (
          <Pressable
            testID="lyrics-variant-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: variant === 'ai' }}
            accessibilityLabel={
              variant === 'ai'
                ? strings.player.lyrics.switchToStandard
                : strings.player.lyrics.switchToAi
            }
            focusable
            onPress={onToggleVariant}
            style={({ pressed }) => [
              styles.variantPill,
              variant === 'ai' ? styles.variantPillActive : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <AppIcon
              name="auto-fix"
              size={14}
              color={variant === 'ai' ? colors.accentSoft : colors.textSecondary}
            />
            <AppText
              variant="micro"
              color={variant === 'ai' ? 'accent' : 'secondary'}
            >
              {variant === 'ai'
                ? strings.player.lyrics.aiVariant
                : strings.player.lyrics.standardVariant}
            </AppText>
          </Pressable>
        ) : null}
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
            {hasWordTimings ? (
              <Badge testID="lyrics-karaoke" label={wave2Strings.lyrics.karaokeBadge} />
            ) : null}
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

      {isInstrumental && (visual.body === 'empty' || visual.body === 'content') ? (
        <EmptyState
          testID="lyrics-instrumental"
          icon="music-note"
          title={wave2Strings.lyrics.instrumentalTitle}
          message={wave2Strings.lyrics.instrumentalBody}
          style={styles.empty}
        />
      ) : null}

      {!isInstrumental && visual.body === 'empty' ? (
        <EmptyState
          testID="lyrics-empty"
          icon="text-box-remove-outline"
          title={strings.player.lyrics.empty}
          style={styles.empty}
        />
      ) : null}

      {!isInstrumental && visual.body === 'content' ? (
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
              const rawText = item.text.trim();
              const text = rawText || strings.player.lyrics.instrumentalLine;
              const canShareLine = onShareLine !== undefined && rawText.length > 0;
              if (!isSynced) {
                if (!canShareLine) {
                  return (
                    <View testID={`lyrics-line-${index}`} style={styles.line}>
                      <AppText variant="section" color="primary">
                        {text}
                      </AppText>
                    </View>
                  );
                }
                return (
                  <Pressable
                    testID={`lyrics-line-${index}`}
                    accessibilityHint={strings.player.lyrics.shareQuoteHint}
                    accessibilityActions={[
                      { name: 'longpress', label: strings.player.lyrics.shareQuote },
                    ]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'longpress') onShareLine(index);
                    }}
                    onLongPress={() => onShareLine(index)}
                    style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
                  >
                    <AppText variant="section" color="primary">
                      {text}
                    </AppText>
                  </Pressable>
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
                  accessibilityHint={
                    canShareLine
                      ? `${strings.player.lyrics.lineSeekHint}. ${strings.player.lyrics.shareQuoteHint}`
                      : strings.player.lyrics.lineSeekHint
                  }
                  accessibilityActions={
                    canShareLine
                      ? [{ name: 'longpress', label: strings.player.lyrics.shareQuote }]
                      : undefined
                  }
                  accessibilityState={{ selected: active }}
                  focusable
                  onAccessibilityAction={
                    canShareLine
                      ? (event) => {
                          if (event.nativeEvent.actionName === 'longpress') onShareLine(index);
                        }
                      : undefined
                  }
                  onFocus={() => focusController.setFocused(true)}
                  onBlur={() => focusController.setFocused(false)}
                  onPress={() => onSeek(item.t)}
                  onLongPress={canShareLine ? () => onShareLine(index) : undefined}
                  style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
                >
                  {active && item.words !== undefined && item.words.length > 0 ? (
                    <KaraokeWordsLine words={item.words} position={position} />
                  ) : (
                    <AppText variant="section" color={active ? 'primary' : 'muted'}>
                      {text}
                    </AppText>
                  )}
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

      {shareError !== null ? (
        <AppText
          testID="lyrics-share-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          variant="caption"
          color="danger"
          align="center"
          style={styles.status}
        >
          {shareError}
        </AppText>
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
  const [variantState, setVariantState] = useState<{
    trackId: string;
    variant: LyricsVariant;
  }>({ trackId: track.id, variant: 'default' });
  const [shareError, setShareError] = useState<string | null>(null);
  const variant: LyricsVariant =
    variantState.trackId === track.id ? variantState.variant : 'default';
  const query = useQuery(
    musicQueries.lyrics(track.artist, track.title, track.id, variant, {
      album: track.album,
      durationSec: track.duration_sec,
    }),
  );
  const reducedMotion = useReducedMotion();
  const isSynced = query.data?.synced === true;
  const lines = useMemo(() => query.data?.lines ?? EMPTY_LINES, [query.data?.lines]);
  const activeIndex = isSynced ? activeLyricIndex(lines, position) : -1;
  const listRef = useRef<FlatList<LyricsLine>>(null);
  const previousFollow = useRef<LyricsFollowIdentity | null>(null);
  const [pausedTrackId, setPausedTrackId] = useState<string | null>(null);
  const autoScrollPaused = isSynced && pausedTrackId === track.id;

  const handleToggleVariant = useCallback(() => {
    triggerHaptic('tap');
    setShareError(null);
    setPausedTrackId(null);
    setVariantState((current) => {
      const currentVariant = current.trackId === track.id ? current.variant : 'default';
      return {
        trackId: track.id,
        variant: currentVariant === 'ai' ? 'default' : 'ai',
      };
    });
  }, [track.id]);

  const handleShareLine = useCallback(
    (index: number) => {
      triggerHaptic('tap');
      setShareError(null);
      void shareLyricQuote(track, lines, index).catch((cause: unknown) => {
        console.error('[LoggeRythm] Failed to share a lyric line:', cause);
        setShareError(strings.player.lyrics.shareQuoteFailed);
      });
    },
    [lines, track],
  );

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
      position={position}
      onSeek={handleSeek}
      onRetry={handleRetry}
      listRef={listRef}
      autoScrollPaused={autoScrollPaused}
      onUserScrollStart={handleUserScrollStart}
      onSyncToCurrent={handleSyncToCurrent}
      variant={variant}
      onToggleVariant={handleToggleVariant}
      onShareLine={handleShareLine}
      shareError={shareError}
      onScrollToIndexFailed={handleScrollFailure}
    />
  );
}

/**
 * Progress-isolated LyricsPanel wrapper. Keeps `useEffectiveProgress(0.5)`
 * strictly scoped to active-line tracking so parent screens never re-render at
 * 1Hz while staying in sync during both local and Connect remote playback.
 */
export const LiveLyricsPanel = React.memo(function LiveLyricsPanel({
  track,
  onSeek,
}: LiveLyricsPanelProps) {
  const { position } = useEffectiveProgress(0.5);
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
  variantPill: {
    minHeight: BADGE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.fill,
  },
  variantPillActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
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
