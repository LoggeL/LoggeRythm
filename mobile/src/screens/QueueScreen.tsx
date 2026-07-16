import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Player, { Event, useProgress } from '../player/player';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Track } from '../api/types';
import AppIcon from '../components/AppIcon';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import TrackStateIndicator from '../components/TrackStateIndicator';
import { useTrackPresentationResolver } from '../components/player/TrackPresentationProvider';
import TrackIdentityLinks from '../components/track/TrackIdentityLinks';
import { buildTrackMetadata } from '../components/track/trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from '../components/track/trackPresentationCopy';
import { musicQueries } from '../data';
import {
  clearUpcomingQueue,
  getQueueSnapshot,
  isContextShuffleEnabled,
  moveQueueItem,
  removeQueueItem,
  skipToQueueItem,
  toggleShuffle,
} from '../player/controller';
import { clearPlayerError, reportPlayerError, usePlayerError } from '../player/errors';
import { mediaItemToTrack } from '../player/mediaItem';
import {
  queueContextOf,
  queueOriginalContextOrderOf,
  queueOriginOf,
  queueStableIdOf,
  type QueueContextMetadata,
  type QueueOrigin,
} from '../player/queueContract';
import type { RootStackParams } from '../navigation';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
import { strings } from '../localization';
import { colors, metrics } from '../theme';
import {
  authoritativeQueueTrackPresentation,
  resolveQueueMetadataVisualState,
} from './queueMetadata';
import {
  buildQueuePresentation,
  contextLabelForSection,
  type QueuePresentationSection,
} from './queuePresentation';
import { resolveQueueSnapshotVisualState } from './queueSnapshotState';

type ScreenProps = NativeStackScreenProps<RootStackParams, 'Queue'>;

export interface QueueSurfaceProps {
  /** Render inside an owner that already supplies safe-area and global player feedback. */
  embedded?: boolean;
  /** Standalone owners provide their dismissal action; embedded owners normally omit it. */
  onClose?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

export interface QueueSurfacePadding {
  paddingTop: number;
  paddingBottom: number;
}

/** One explicit layout contract prevents nested Now Playing safe-area padding. */
export function queueSurfacePadding(
  embedded: boolean,
  topInset: number,
  bottomInset: number,
): QueueSurfacePadding {
  return embedded
    ? { paddingTop: 0, paddingBottom: 0 }
    : { paddingTop: topInset + 8, paddingBottom: Math.max(bottomInset, 12) };
}

interface QueueRow {
  stableId: string;
  origin: QueueOrigin;
  context: QueueContextMetadata | null;
  originalContextOrder: number | null;
  track: Track;
}

interface QueueState {
  rows: QueueRow[];
  activeIndex: number | null;
}

interface QueueSnapshotStatus {
  hasSnapshot: boolean;
  refreshing: boolean;
  error: unknown;
}

type QueueUiSection = QueuePresentationSection<QueueRow> & { title: string };

function testIdPart(stableId: string): string {
  const sanitized = stableId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'item';
}

function retryButton(testID: string, label: string, busy: boolean, onPress: () => void) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.retryButton, pressed && styles.pressed, busy && styles.disabled]}
    >
      <Text style={styles.retryText}>{strings.common.retry}</Text>
    </Pressable>
  );
}

export function QueueSurfaceHeader({
  embedded,
  upcomingCount,
  onClose,
}: {
  embedded: boolean;
  upcomingCount: number;
  onClose?: () => void;
}) {
  return (
    <View testID="queue-header" style={styles.header}>
      <View>
        <Text accessibilityRole="header" style={styles.heading}>{strings.queue.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {strings.queue.upcomingCount(upcomingCount)}
        </Text>
      </View>
      {!embedded && onClose !== undefined ? (
        <Pressable
          testID="queue-close"
          accessibilityRole="button"
          accessibilityLabel={strings.queue.close}
          onPress={onClose}
          hitSlop={12}
          style={styles.closeButton}
        >
          <Text style={styles.closeText}>{strings.queue.done}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function QueueSurfaceGlobalFeedback({
  embedded,
  playerError,
}: {
  embedded: boolean;
  playerError: string | null;
}) {
  if (embedded) return null;
  return (
    <>
      {playerError !== null ? (
        <View testID="queue-error" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorBanner}>
          <Text style={styles.errorText}>{playerError}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={strings.player.playerErrorDismiss} onPress={clearPlayerError} style={styles.errorDismiss}>
            <AppIcon name="close" color={colors.textSecondary} size={20} />
          </Pressable>
        </View>
      ) : null}
      <PlayerNoticeBanner />
    </>
  );
}

/** Shared queue implementation used by both the root modal and Now Playing tab. */
export function QueueSurface({
  embedded = false,
  onClose,
  onOpenAlbum,
  onOpenArtist,
}: QueueSurfaceProps) {
  const insets = useSafeAreaInsets();
  const playerError = usePlayerError();
  const activeProgress = useProgress(1);
  const { presentationFor } = useTrackPresentationResolver();
  const [queue, setQueue] = useState<QueueState>({ rows: [], activeIndex: null });
  const [snapshotStatus, setSnapshotStatus] = useState<QueueSnapshotStatus>({
    hasSnapshot: false,
    refreshing: false,
    error: null,
  });
  const [mutationPending, setMutationPending] = useState(false);
  const [shuffle, setShuffle] = useState(isContextShuffleEnabled);
  const mutationLock = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedTracksQuery = useQuery({
    ...musicQueries.cachedTrackIds(),
    enabled: snapshotStatus.hasSnapshot && queue.rows.length > 0,
  });
  const expectedStableIds = useMemo(
    () => queue.rows.map((candidate) => candidate.stableId),
    [queue.rows],
  );
  const presentation = useMemo(
    () => buildQueuePresentation(queue.rows, queue.activeIndex),
    [queue.activeIndex, queue.rows],
  );
  const sections = useMemo<QueueUiSection[]>(
    () =>
      presentation.sections.map((section) => {
        let title: string;
        switch (section.kind) {
          case 'history':
            title = strings.queue.historySection;
            break;
          case 'current':
            title = strings.queue.currentSection;
            break;
          case 'manual':
            title = strings.queue.manualSection;
            break;
          case 'context':
            title = strings.queue.contextSection(
              contextLabelForSection(
                section.data,
                strings.queue.legacyContextLabel,
                strings.queue.unknownContext,
              ),
            );
            break;
        }
        return { ...section, title };
      }),
    [presentation.sections],
  );
  const snapshotVisual = resolveQueueSnapshotVisualState({
    hasSnapshot: snapshotStatus.hasSnapshot,
    empty: queue.rows.length === 0,
    refreshing: snapshotStatus.refreshing,
    error: snapshotStatus.error,
  });
  const metadataEnabled = snapshotStatus.hasSnapshot && queue.rows.length > 0;
  const metadataVisual = metadataEnabled
    ? resolveQueueMetadataVisualState({
        hasData: cachedTracksQuery.data !== undefined,
        empty: (cachedTracksQuery.data?.ids.length ?? 0) === 0,
        pending: cachedTracksQuery.isPending,
        fetching: cachedTracksQuery.isFetching,
        stale: cachedTracksQuery.isStale,
        fetchStatus: cachedTracksQuery.fetchStatus,
        error: cachedTracksQuery.error,
      })
    : null;

  const refreshQueue = useCallback(() => {
    setSnapshotStatus((current) => ({
      ...current,
      refreshing: true,
      error: null,
    }));
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      try {
        const snapshot = getQueueSnapshot();
        const stableIds = new Set<string>();
        const rows = snapshot.items.map((item, index) => {
          if (typeof item.mediaId !== 'string' || item.mediaId.length === 0) {
            throw new Error(`Queue item ${index} has no mediaId`);
          }
          const track = mediaItemToTrack(item);
          if (track === null) throw new Error(`Queue item ${index} has no Track metadata`);
          const stableId = queueStableIdOf(item);
          if (stableIds.has(stableId)) {
            throw new Error(`Queue item ${index} has duplicate stable id ${stableId}`);
          }
          stableIds.add(stableId);
          return {
            stableId,
            origin: queueOriginOf(item),
            context: queueContextOf(item),
            originalContextOrder: queueOriginalContextOrderOf(item),
            track,
          };
        });
        setQueue({ rows, activeIndex: snapshot.activeIndex });
        setShuffle(isContextShuffleEnabled());
        setSnapshotStatus({ hasSnapshot: true, refreshing: false, error: null });
      } catch (cause) {
        setSnapshotStatus((current) => ({
          ...current,
          refreshing: false,
          error: cause,
        }));
      }
    }, 0);
  }, []);

  useEffect(() => {
    refreshQueue();
    const queueSubscription = Player.addEventListener(Event.QueueChanged, refreshQueue);
    const transitionSubscription = Player.addEventListener(
      Event.MediaItemTransition,
      refreshQueue,
    );
    return () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
      queueSubscription.remove();
      transitionSubscription.remove();
    };
  }, [refreshQueue]);

  const runMutation = async (context: string, action: () => Promise<string>) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMutationPending(true);
    clearPlayerError();
    try {
      const announcement = await action();
      refreshQueue();
      AccessibilityInfo.announceForAccessibility(announcement);
    } catch (cause) {
      refreshQueue();
      reportPlayerError(context, cause);
    } finally {
      mutationLock.current = false;
      setMutationPending(false);
    }
  };

  const upcomingCount = presentation.upcomingCount;
  const upcomingContextCount =
    presentation.sections.find((section) => section.kind === 'context')?.data.length ?? 0;
  const canToggleShuffle = queue.activeIndex !== null && (shuffle || upcomingContextCount > 1);
  const canClearUpcoming = upcomingCount > 0;

  return (
    <View
      testID={embedded ? 'queue-panel' : 'queue-screen'}
      style={[
        styles.container,
        embedded && styles.embeddedContainer,
        queueSurfacePadding(embedded, insets.top, insets.bottom),
      ]}
    >
      <QueueSurfaceHeader
        embedded={embedded}
        upcomingCount={upcomingCount}
        onClose={onClose}
      />

      <View testID="queue-tools" style={styles.tools}>
        <Pressable
          testID="queue-shuffle"
          accessibilityRole="button"
          accessibilityLabel={
            shuffle ? strings.player.disableShuffle : strings.player.enableShuffle
          }
          accessibilityState={{
            checked: shuffle,
            busy: mutationPending,
            disabled: mutationPending || !canToggleShuffle,
          }}
          disabled={mutationPending || !canToggleShuffle}
          style={[
            styles.toolButton,
            shuffle && styles.toolButtonActive,
            (mutationPending || !canToggleShuffle) && styles.disabled,
          ]}
          onPress={() =>
            void runMutation(strings.player.shuffleFailed, async () => {
              const enabled = await toggleShuffle(expectedStableIds);
              setShuffle(enabled);
              return enabled ? strings.queue.shuffleEnabled : strings.queue.orderRestored;
            })
          }
        >
          <Text style={[styles.toolText, shuffle && styles.toolTextActive]}>
            {shuffle ? strings.queue.restoreOrder : strings.queue.shuffle}
          </Text>
        </Pressable>
        <Pressable
          testID="queue-clear-upcoming"
          accessibilityRole="button"
          accessibilityLabel={strings.queue.clearUpcoming}
          accessibilityHint={strings.queue.clearUpcomingHint}
          accessibilityState={{
            busy: mutationPending,
            disabled: mutationPending || !canClearUpcoming,
          }}
          disabled={mutationPending || !canClearUpcoming}
          style={[
            styles.toolButton,
            (mutationPending || !canClearUpcoming) && styles.disabled,
          ]}
          onPress={() =>
            void runMutation(strings.queue.clearUpcomingFailed, async () => {
              await clearUpcomingQueue(expectedStableIds);
              setShuffle(isContextShuffleEnabled());
              return strings.queue.clearedUpcoming(upcomingCount);
            })
          }
        >
          <Text style={styles.toolText}>{strings.queue.clearUpcoming}</Text>
        </Pressable>
      </View>

      <QueueSurfaceGlobalFeedback embedded={embedded} playerError={playerError} />

      {snapshotVisual.body === 'loading' ? (
        <View
          testID="queue-loading"
          accessibilityRole="progressbar"
          accessibilityLabel={strings.queue.loading}
          accessibilityLiveRegion="polite"
          style={styles.centered}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.emptyDetail}>{strings.queue.loading}</Text>
        </View>
      ) : snapshotVisual.body === 'hard-error' ? (
        <View
          testID="queue-snapshot-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.blockingState}
        >
          <Text style={styles.errorText}>{strings.queue.loadFailed}</Text>
          {retryButton('queue-snapshot-retry', strings.common.retry, snapshotStatus.refreshing, refreshQueue)}
        </View>
      ) : (
        <>
        {snapshotVisual.notice === 'cached-refresh-error' ? (
          <View
            testID="queue-snapshot-cached-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.stateNotice}
          >
            <Text style={styles.warningText}>{strings.queue.loadFailed}</Text>
            {retryButton('queue-snapshot-retry', strings.common.retry, snapshotStatus.refreshing, refreshQueue)}
          </View>
        ) : null}
        {snapshotVisual.notice === 'refreshing' ? (
          <View
            testID="queue-snapshot-refreshing"
            accessibilityRole="progressbar"
            accessibilityLabel={strings.queue.loading}
            accessibilityLiveRegion="polite"
            style={styles.inlineStatus}
          >
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.emptyDetail}>{strings.queue.loading}</Text>
          </View>
        ) : null}

        {metadataVisual?.body === 'loading' ? (
          <View
            testID="queue-metadata-loading"
            accessibilityRole="progressbar"
            accessibilityLabel={strings.search.remoteLoading(strings.search.metadataTitle)}
            accessibilityLiveRegion="polite"
            style={styles.inlineStatus}
          >
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.emptyDetail}>
              {strings.search.remoteLoading(strings.search.metadataTitle)}
            </Text>
          </View>
        ) : null}
        {metadataVisual?.body === 'offline' || metadataVisual?.body === 'hard-error' ? (
          <View
            testID={`queue-metadata-${metadataVisual.body === 'offline' ? 'offline' : 'error'}`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.stateNotice}
          >
            <Text style={styles.warningText}>
              {metadataVisual.body === 'offline'
                ? strings.search.remoteOffline(strings.search.metadataTitle)
                : strings.search.remoteLoadFailed(strings.search.metadataTitle)}
            </Text>
            {retryButton(
              'queue-metadata-retry',
              strings.search.retrySection(strings.search.metadataTitle),
              cachedTracksQuery.fetchStatus === 'fetching',
              () => void cachedTracksQuery.refetch(),
            )}
          </View>
        ) : null}
        {metadataVisual?.notice === 'cached-offline'
        || metadataVisual?.notice === 'cached-refresh-error' ? (
          <View
            testID={`queue-metadata-${metadataVisual.notice === 'cached-offline' ? 'cached-offline' : 'cached-error'}`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.stateNotice}
          >
            <Text style={styles.warningText}>
              {metadataVisual.notice === 'cached-offline'
                ? strings.search.remoteCachedOffline(strings.search.metadataTitle)
                : strings.search.remoteCachedRefreshFailed(strings.search.metadataTitle)}
            </Text>
            {retryButton(
              'queue-metadata-retry',
              strings.search.retrySection(strings.search.metadataTitle),
              cachedTracksQuery.fetchStatus === 'fetching',
              () => void cachedTracksQuery.refetch(),
            )}
          </View>
        ) : null}
        {metadataVisual?.notice === 'refreshing' ? (
          <Text
            testID="queue-metadata-refreshing"
            accessibilityLiveRegion="polite"
            style={styles.metadataStatus}
          >
            {strings.search.remoteRefreshing(strings.search.metadataTitle)}
          </Text>
        ) : null}
        {metadataVisual?.notice === 'stale' ? (
          <Text testID="queue-metadata-stale" accessibilityLiveRegion="polite" style={styles.metadataStatus}>
            {strings.search.remoteStale(strings.search.metadataTitle)}
          </Text>
        ) : null}

        <SectionList
          testID="queue-list"
          sections={sections}
          keyExtractor={(entry) => entry.row.stableId}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={queue.rows.length === 0 ? styles.emptyList : styles.list}
          ListEmptyComponent={
            <View testID="queue-empty" accessibilityLiveRegion="polite" style={styles.centered}>
              <Text style={styles.emptyTitle}>{strings.queue.emptyTitle}</Text>
              <Text style={styles.emptyDetail}>{strings.queue.emptyDetail}</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View
              testID={`queue-section-${section.kind}`}
              style={[styles.sectionHeader, embedded && styles.embeddedSectionHeader]}
            >
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {section.title}
              </Text>
              <Text style={styles.sectionCount}>
                {strings.common.trackCount(section.data.length)}
              </Text>
            </View>
          )}
          renderItem={({ item: { row, nativeIndex } }) => {
            const active = nativeIndex === queue.activeIndex;
            const upcoming =
              queue.activeIndex === null || nativeIndex > queue.activeIndex;
            const first = nativeIndex === 0;
            const last = nativeIndex === queue.rows.length - 1;
            const previous = queue.rows[nativeIndex - 1];
            const following = queue.rows[nativeIndex + 1];
            const canMoveUp =
              !active &&
              !first &&
              nativeIndex - 1 !== queue.activeIndex &&
              (queue.activeIndex === null ||
                nativeIndex <= queue.activeIndex ||
                previous?.origin === row.origin);
            const canMoveDown =
              !active &&
              !last &&
              nativeIndex + 1 !== queue.activeIndex &&
              (queue.activeIndex === null ||
                nativeIndex <= queue.activeIndex ||
                following?.origin === row.origin);
            const rowTestId = `queue-row-${testIdPart(row.stableId)}`;
            const resolvedPresentation = presentationFor(
              {
                trackId: row.track.id,
                queueContext:
                  row.context === null
                    ? null
                    : { type: row.context.type, id: row.context.id },
                originalContextOrder: row.originalContextOrder,
              },
              active ? { rollingDeviceCacheSeconds: activeProgress.cached } : undefined,
            );
            // Queue-native index is authoritative even for duplicate manual or legacy ids.
            const rowPresentation = authoritativeQueueTrackPresentation(
              resolvedPresentation,
              active,
            );
            return (
              <View testID={rowTestId} style={[styles.row, active && styles.activeRow]}>
                <Pressable
                  testID={`${rowTestId}-track`}
                  accessibilityRole="button"
                  accessibilityLabel={strings.queue.skipLabel(
                    row.track.title,
                    row.track.artist,
                    active,
                  )}
                  accessibilityHint={active ? undefined : strings.queue.skipHint}
                  accessibilityState={{
                    selected: active,
                    busy: rowPresentation.playback === 'buffering',
                    disabled: mutationPending,
                  }}
                  disabled={mutationPending}
                  style={styles.trackButton}
                  onPress={() =>
                    void runMutation(strings.queue.skipFailed(row.track.title), async () => {
                      await skipToQueueItem(nativeIndex, expectedStableIds);
                      return strings.queue.skippedTo(row.track.title);
                    })
                  }
                >
                  {row.track.cover ? (
                    <Image accessible={false} source={{ uri: row.track.cover }} style={styles.artwork} />
                  ) : (
                    <View style={[styles.artwork, styles.artworkPlaceholder]} />
                  )}
                </Pressable>

                <View style={styles.metadata}>
                  <TrackIdentityLinks
                    metadata={buildTrackMetadata(row.track)}
                    testID={`${rowTestId}-identity`}
                    copy={trackIdentityCopy}
                    onOpenAlbum={onOpenAlbum}
                    onOpenArtist={onOpenArtist}
                    showAlbumLabel
                    showDuration
                    showPopularity={false}
                  />
                  <TrackStateIndicator
                    presentation={rowPresentation}
                    copy={trackStateIndicatorCopy}
                    testID={`${rowTestId}-state`}
                  />
                  {upcoming && row.origin === 'manual' && (
                    <Text style={styles.manualPriority}>{strings.queue.manualPriority}</Text>
                  )}
                </View>

                <View style={styles.actions}>
                  <Pressable
                    testID={`${rowTestId}-move-up`}
                    accessibilityRole="button"
                    accessibilityLabel={strings.queue.moveUp(row.track.title)}
                    accessibilityState={{ disabled: mutationPending || !canMoveUp }}
                    disabled={mutationPending || !canMoveUp}
                    style={[
                      styles.actionButton,
                      (mutationPending || !canMoveUp) && styles.disabled,
                    ]}
                    onPress={() =>
                      void runMutation(strings.queue.moveUpFailed(row.track.title), async () => {
                        await moveQueueItem(
                          nativeIndex,
                          nativeIndex - 1,
                          expectedStableIds,
                        );
                        return strings.queue.movedUp(row.track.title);
                      })
                    }
                  >
                    <AppIcon name="arrow-up" color={colors.textSecondary} size={20} />
                  </Pressable>
                  <Pressable
                    testID={`${rowTestId}-move-down`}
                    accessibilityRole="button"
                    accessibilityLabel={strings.queue.moveDown(row.track.title)}
                    accessibilityState={{ disabled: mutationPending || !canMoveDown }}
                    disabled={mutationPending || !canMoveDown}
                    style={[
                      styles.actionButton,
                      (mutationPending || !canMoveDown) && styles.disabled,
                    ]}
                    onPress={() =>
                      void runMutation(strings.queue.moveDownFailed(row.track.title), async () => {
                        await moveQueueItem(
                          nativeIndex,
                          nativeIndex + 1,
                          expectedStableIds,
                        );
                        return strings.queue.movedDown(row.track.title);
                      })
                    }
                  >
                    <AppIcon name="arrow-down" color={colors.textSecondary} size={20} />
                  </Pressable>
                  <Pressable
                    testID={`${rowTestId}-remove`}
                    accessibilityRole="button"
                    accessibilityLabel={
                      active
                        ? strings.queue.cannotRemoveCurrent(row.track.title)
                        : strings.queue.remove(row.track.title)
                    }
                    accessibilityState={{ disabled: mutationPending || active }}
                    disabled={mutationPending || active}
                    style={[styles.actionButton, (mutationPending || active) && styles.disabled]}
                    onPress={() =>
                      void runMutation(strings.queue.removeFailed(row.track.title), async () => {
                        await removeQueueItem(nativeIndex, expectedStableIds);
                        return strings.queue.removed(row.track.title);
                      })
                    }
                  >
                    <AppIcon name="close" color={colors.danger} size={20} />
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
        </>
      )}
    </View>
  );
}

/** Preserve the navigation route contract as a thin standalone wrapper. */
export default function QueueScreen({ navigation }: ScreenProps) {
  return (
    <QueueSurface
      onClose={() => navigation.goBack()}
      onOpenAlbum={(params) => navigation.navigate('Tabs', {
        screen: 'DiscoverTab',
        params: { screen: 'Album', params },
      })}
      onOpenArtist={(params) => navigation.navigate('Tabs', {
        screen: 'DiscoverTab',
        params: { screen: 'Artist', params },
      })}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  embeddedContainer: { backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  tools: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  toolButton: {
    flex: 1,
    minHeight: metrics.minimumTouchTarget,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  toolButtonActive: { borderColor: colors.accent },
  toolText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  toolTextActive: { color: colors.accent },
  heading: { color: colors.textPrimary, fontSize: 28, fontWeight: '800' },
  count: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  closeButton: { minHeight: metrics.minimumTouchTarget, justifyContent: 'center', paddingLeft: 16 },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 17 },
  errorDismiss: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  errorDismissText: { color: colors.textPrimary, fontSize: 22 },
  blockingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateNotice: { gap: 8, marginHorizontal: 20, marginBottom: 8 },
  warningText: { color: colors.warning, fontSize: 12, lineHeight: 17 },
  inlineStatus: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  metadataStatus: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, paddingHorizontal: 20, paddingBottom: 6 },
  retryButton: { minHeight: metrics.minimumTouchTarget, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 24, backgroundColor: colors.accent },
  retryText: { color: colors.onAccent, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.72 },
  list: { paddingHorizontal: 12, paddingBottom: 16 },
  emptyList: { flexGrow: 1, paddingHorizontal: 20 },
  sectionHeader: {
    minHeight: 42,
    paddingHorizontal: 8,
    paddingTop: 14,
    paddingBottom: 7,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
  },
  embeddedSectionHeader: { backgroundColor: '#0a0a14b8' },
  sectionTitle: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  sectionCount: { color: colors.textSecondary, fontSize: 12, marginLeft: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyDetail: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  row: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  activeRow: { backgroundColor: colors.surface },
  trackButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  artwork: { width: 52, height: 52, borderRadius: 5, backgroundColor: colors.surfaceElevated },
  artworkPlaceholder: { borderWidth: 1, borderColor: colors.border },
  metadata: { flex: 1, minWidth: 0, marginLeft: 11, paddingVertical: 6 },
  manualPriority: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', marginLeft: 4 },
  actionButton: { width: metrics.minimumTouchTarget, height: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.textSecondary, fontSize: 18, fontWeight: '700' },
  removeText: { color: colors.danger, fontSize: 23 },
  disabled: { opacity: 0.24 },
});
