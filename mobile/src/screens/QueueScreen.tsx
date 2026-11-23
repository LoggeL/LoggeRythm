import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  SectionList,
  StyleSheet,
  View,
  type SectionListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AppIcon, { type AppIconName } from '../components/AppIcon';
import {
  ActionButton,
  AppText,
  createFocusRingController,
  EmptyState,
  ErrorState,
  FocusRingOverlay,
  TrackRowSkeleton,
} from '../components/ui';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import { PlayerErrorBanner } from '../components/player/PlayerErrorBanner';
import {
  QueueMetadataNoticeView,
  QueueSnapshotNoticeView,
} from '../components/player/QueueNotices';
import { MemoQueueRow } from '../components/player/QueueRow';
import { PartyNotice } from '../components/party/PartyParts';
import { partyErrorDetail } from '../party/partyErrors';
import { startPartyFromQueue, usePartySession } from '../party/partyRuntime';
import { useTrackPresentationResolver } from '../components/player/TrackPresentationProvider';
import { musicQueries } from '../data';
import { useBackHandler } from '../hooks/useBackHandler';
import { triggerHaptic } from '../hooks/useHaptics';
import {
  clearUpcomingQueue,
  isContextShuffleEnabled,
  moveQueueItem,
  removeQueueItem,
  skipToQueueItem,
  toggleShuffle,
} from '../player/controller';
import { clearPlayerError, reportPlayerError, usePlayerError } from '../player/errors';
import type { RootStackParams } from '../navigation';
import type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';
import { getActiveLocale, strings } from '../localization';
import { colors, elevation, layout, metrics, opacity, radii, spacing } from '../theme';
import { TvFocusable, TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  openNowPlayingCatalogAlbum,
  openNowPlayingCatalogArtist,
} from './nowPlayingNavigation';
import {
  authoritativeQueueTrackPresentation,
  resolveQueueMetadataVisualState,
} from './queueMetadata';
import {
  buildQueuePresentation,
  contextLabelForSection,
  type IndexedQueueRow,
  type QueuePresentationSection,
  type QueueSectionKind,
} from './queuePresentation';
import { moveRow, queueDragRange } from './queueDragModel';
import { resolveQueueSnapshotVisualState } from './queueSnapshotState';
import { useQueueDrag } from './useQueueDrag';
import { useQueueSnapshot, type QueueSnapshotRow } from './useQueueSnapshot';

type ScreenProps = NativeStackScreenProps<RootStackParams, 'Queue'>;

export interface QueueSurfaceProps {
  /** Render inside an owner that already supplies safe-area and global player feedback. */
  embedded?: boolean;
  /** Standalone owners provide their dismissal action; embedded owners normally omit it. */
  onClose?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  onOpenParty: (code: string) => void;
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
    : { paddingTop: topInset + spacing.xs, paddingBottom: Math.max(bottomInset, spacing.sm) };
}

type QueueUiSection = QueuePresentationSection<QueueSnapshotRow> & { title: string };

function testIdPart(stableId: string): string {
  const sanitized = stableId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'item';
}

function sectionTitle(kind: QueueSectionKind, rows: QueueUiSection['data']): string {
  switch (kind) {
    case 'history':
      return strings.queue.historySection;
    case 'current':
      return strings.queue.nowPlayingSection;
    case 'manual':
      return strings.queue.upNextSection;
    case 'context':
      return strings.queue.contextSection(
        contextLabelForSection(
          rows,
          strings.queue.legacyContextLabel,
          strings.queue.unknownContext,
        ),
      );
  }
}

const QUEUE_TV_CLOSE_FOCUS_KEY = 'queue-close';

export function QueueSurfaceHeader({
  embedded,
  upcomingCount,
  onClose,
  isTv = false,
  tvPreferredCloseFocus = false,
}: {
  embedded: boolean;
  upcomingCount: number;
  onClose?: () => void;
  isTv?: boolean;
  tvPreferredCloseFocus?: boolean;
}) {
  return (
    <View testID="queue-header" style={styles.header}>
      <View style={styles.headerCopy}>
        <AppText
          accessibilityRole="header"
          variant={embedded ? 'section' : 'hero'}
          numberOfLines={1}
        >
          {strings.queue.title}
        </AppText>
        <AppText accessibilityLiveRegion="polite" variant="callout" color="secondary">
          {strings.queue.upcomingCount(upcomingCount)}
        </AppText>
      </View>
      {!embedded && onClose !== undefined ? (
        isTv ? (
          <TvFocusable
            testID="queue-close"
            focusKey={QUEUE_TV_CLOSE_FOCUS_KEY}
            preferredFocus={tvPreferredCloseFocus}
            ringRadius="pill"
            accessibilityRole="button"
            accessibilityLabel={strings.queue.close}
            onPress={() => {
              triggerHaptic('tap');
              onClose();
            }}
            style={styles.tvCloseButton}
          >
            <AppText variant="label" color="primary" numberOfLines={1}>
              {strings.queue.done}
            </AppText>
          </TvFocusable>
        ) : (
          <ActionButton
            testID="queue-close"
            variant="secondary"
            label={strings.queue.done}
            accessibilityLabel={strings.queue.close}
            focusable
            onPress={onClose}
          />
        )
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
        <PlayerErrorBanner
          testID="queue-error"
          message={playerError}
          onDismiss={clearPlayerError}
          style={styles.errorBanner}
        />
      ) : null}
      <PlayerNoticeBanner />
    </>
  );
}

interface QueueToolProps {
  testID: string;
  icon: AppIconName;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Present for mode toggles only; reported as `checked`. */
  checked?: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}

/** Labelled queue command pill. A toggle reports `checked`, which ActionButton cannot. */
function QueueTool({
  testID,
  icon,
  label,
  accessibilityLabel,
  accessibilityHint,
  checked,
  busy,
  disabled,
  onPress,
}: QueueToolProps) {
  const foreground = checked === true ? colors.accentSoft : colors.textPrimary;
  const focusController = useMemo(() => createFocusRingController(), []);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={checked === undefined ? { busy, disabled } : { checked, busy, disabled }}
      disabled={disabled}
      focusable={!disabled}
      onFocus={() => focusController.setFocused(true)}
      onBlur={() => focusController.setFocused(false)}
      onPress={() => {
        triggerHaptic('tap');
        onPress();
      }}
      style={({ pressed }) => [
        styles.tool,
        checked === true ? styles.toolChecked : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <AppIcon name={icon} color={foreground} size={18} />
      <AppText variant="label" numberOfLines={1} style={[styles.toolLabel, { color: foreground }]}>
        {label}
      </AppText>
      <FocusRingOverlay controller={focusController} borderRadius={radii.pill} disabled={disabled} />
    </Pressable>
  );
}

const keyExtractor = (entry: IndexedQueueRow<QueueSnapshotRow>) => entry.row.stableId;

/** Shared queue implementation used by both the root modal and Now Playing tab. */
export function QueueSurface({
  embedded = false,
  onClose,
  onOpenAlbum,
  onOpenArtist,
  onOpenParty,
}: QueueSurfaceProps) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  const tvFocusReturn = useTvFocusReturn({
    scope: 'queue',
    active: !embedded && isFocused,
    fallbackKey: QUEUE_TV_CLOSE_FOCUS_KEY,
    enabled: !embedded && tv.isTv,
  });
  const checkpointConsumedRef = useRef(false);
  const standaloneTvRef = useRef(!embedded && tv.isTv);
  const popFocusReturnRef = useRef(tvFocusReturn.popAndRestore);
  useEffect(() => {
    standaloneTvRef.current = !embedded && tv.isTv;
    popFocusReturnRef.current = tvFocusReturn.popAndRestore;
  }, [embedded, tv.isTv, tvFocusReturn.popAndRestore]);

  useEffect(
    () => () => {
      if (standaloneTvRef.current && !checkpointConsumedRef.current) {
        checkpointConsumedRef.current = true;
        popFocusReturnRef.current();
      }
    },
    [],
  );

  const consumeTvCheckpoint = useCallback(() => {
    if (embedded || !tv.isTv || checkpointConsumedRef.current) return;
    checkpointConsumedRef.current = true;
    tvFocusReturn.popAndRestore();
  }, [embedded, tv.isTv, tvFocusReturn]);
  const partyState = usePartySession();
  // While a party steers the player its queue is the party's: edit it there.
  const followedParty = partyState.detached ? null : partyState.party;
  const [startingParty, setStartingParty] = useState(false);
  const [partyStartError, setPartyStartError] = useState<string | null>(null);
  const playerError = usePlayerError();
  const { presentationFor } = useTrackPresentationResolver();
  const { queue, status: snapshotStatus, shuffle, setShuffle, refresh: refreshQueue } =
    useQueueSnapshot();
  const [mutationPending, setMutationPending] = useState(false);
  const mutationLock = useRef(false);
  // A dropped row is shown at its new place while the native move is being
  // confirmed. The override belongs to one snapshot: the next read replaces it.
  const [droppedOrder, setDroppedOrder] = useState<{
    snapshot: QueueSnapshotRow[];
    rows: QueueSnapshotRow[];
  } | null>(null);
  const rows =
    droppedOrder !== null && droppedOrder.snapshot === queue.rows ? droppedOrder.rows : queue.rows;
  /** The row whose move-up/move-down buttons are revealed. */
  const [moveControlsFor, setMoveControlsFor] = useState<string | null>(null);
  const metadataEnabled = snapshotStatus.hasSnapshot && rows.length > 0;
  const cachedTracksQuery = useQuery({
    ...musicQueries.cachedTrackIds(),
    enabled: metadataEnabled,
  });
  const expectedStableIds = useMemo(() => rows.map((candidate) => candidate.stableId), [rows]);
  const origins = useMemo(() => rows.map((candidate) => candidate.origin), [rows]);
  const presentation = useMemo(
    () => buildQueuePresentation(rows, queue.activeIndex),
    [queue.activeIndex, rows],
  );
  const locale = getActiveLocale();
  const sections: QueueUiSection[] = useMemo(
    () =>
      presentation.sections.map((section) => ({
        ...section,
        title: sectionTitle(section.kind, section.data),
      })),
    // `locale` ensures memoized section titles refresh when active language switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presentation.sections, locale],
  );
  const snapshotVisual = resolveQueueSnapshotVisualState({
    hasSnapshot: snapshotStatus.hasSnapshot,
    empty: rows.length === 0,
    refreshing: snapshotStatus.refreshing,
    error: snapshotStatus.error,
  });
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

  const handleClose = useCallback(() => {
    consumeTvCheckpoint();
    onClose?.();
  }, [consumeTvCheckpoint, onClose]);

  const handleOpenAlbum = useCallback(
    (params: AlbumRouteParams) => {
      consumeTvCheckpoint();
      onOpenAlbum(params);
    },
    [consumeTvCheckpoint, onOpenAlbum],
  );

  const handleOpenArtist = useCallback(
    (params: ArtistRouteParams) => {
      consumeTvCheckpoint();
      onOpenArtist(params);
    },
    [consumeTvCheckpoint, onOpenArtist],
  );

  useBackHandler(
    isFocused && (moveControlsFor !== null || (!embedded && onClose !== undefined)),
    () => {
      if (moveControlsFor !== null) {
        triggerHaptic('tap');
        setMoveControlsFor(null);
        return true;
      }
      if (!embedded && onClose !== undefined) {
        handleClose();
        return true;
      }
      return false;
    },
  );

  const runMutation = useCallback(async (context: string, action: () => Promise<string>) => {
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
  }, [refreshQueue]);

  // The two view refs are taken out of the controller: passing a member of an
  // object to `ref` would mark the whole object as a ref for the hooks linter.
  const editLocked = mutationPending || followedParty !== null;
  const { attachFrame, attachList, ...drag } = useQueueDrag({
    rows,
    activeIndex: queue.activeIndex,
    disabled: editLocked || tv.isTv,
    onTap: (stableId) =>
      setMoveControlsFor((current) => (current === stableId ? null : stableId)),
    onDrop: (fromIndex, toIndex) => {
      const title = rows[fromIndex].track.title;
      const up = toIndex < fromIndex;
      void runMutation(
        up ? strings.queue.moveUpFailed(title) : strings.queue.moveDownFailed(title),
        async () => {
          setDroppedOrder({ snapshot: queue.rows, rows: moveRow(rows, fromIndex, toIndex) });
          try {
            await moveQueueItem(fromIndex, toIndex, expectedStableIds);
          } catch (cause) {
            setDroppedOrder(null);
            throw cause;
          }
          return up ? strings.queue.movedUp(title) : strings.queue.movedDown(title);
        },
      );
    },
  });

  const { attachRow, canDrag, draggingId, handlersFor } = drag;

  /** One queue row; `floating` is the copy that follows the finger during a drag. */
  const renderRow = useCallback((row: QueueSnapshotRow, nativeIndex: number, floating: boolean) => {
    const active = nativeIndex === queue.activeIndex;
    const range = queueDragRange(origins, queue.activeIndex, nativeIndex);
    const title = row.track.title;
    const resolvedPresentation = presentationFor({
      trackId: row.track.id,
      queueContext:
        row.context === null ? null : { type: row.context.type, id: row.context.id },
      originalContextOrder: row.originalContextOrder,
    });
    return (
      <MemoQueueRow
        track={row.track}
        testID={floating ? 'queue-drag-ghost-row' : `queue-row-${testIdPart(row.stableId)}`}
        active={active}
        // Queue-native index is authoritative even for duplicate manual or legacy ids.
        presentation={authoritativeQueueTrackPresentation(resolvedPresentation, active)}
        disabled={editLocked}
        canMoveUp={range !== null && nativeIndex > range.min}
        canMoveDown={range !== null && nativeIndex < range.max}
        rowRef={floating ? undefined : attachRow(row.stableId)}
        dragHandlers={
          floating ? {} : canDrag(nativeIndex) ? handlersFor(row.stableId) : undefined
        }
        dragging={!floating && draggingId === row.stableId}
        moveControlsOpen={!floating && moveControlsFor === row.stableId}
        isTv={tv.isTv}
        onToggleMoveControls={() =>
          setMoveControlsFor((current) => (current === row.stableId ? null : row.stableId))
        }
        onOpenAlbum={handleOpenAlbum}
        onOpenArtist={handleOpenArtist}
        onSkip={() =>
          void runMutation(strings.queue.skipFailed(title), async () => {
            await skipToQueueItem(nativeIndex, expectedStableIds);
            return strings.queue.skippedTo(title);
          })
        }
        onMoveUp={() =>
          void runMutation(strings.queue.moveUpFailed(title), async () => {
            await moveQueueItem(nativeIndex, nativeIndex - 1, expectedStableIds);
            return strings.queue.movedUp(title);
          })
        }
        onMoveDown={() =>
          void runMutation(strings.queue.moveDownFailed(title), async () => {
            await moveQueueItem(nativeIndex, nativeIndex + 1, expectedStableIds);
            return strings.queue.movedDown(title);
          })
        }
        onRemove={() =>
          void runMutation(strings.queue.removeFailed(title), async () => {
            await removeQueueItem(nativeIndex, expectedStableIds);
            return strings.queue.removed(title);
          })
        }
      />
    );
  }, [
    attachRow,
    canDrag,
    draggingId,
    editLocked,
    expectedStableIds,
    handleOpenAlbum,
    handleOpenArtist,
    handlersFor,
    moveControlsFor,
    origins,
    presentationFor,
    queue.activeIndex,
    runMutation,
    tv.isTv,
  ]);

  const renderItem = useCallback(
    ({ item: { row, nativeIndex } }: SectionListRenderItemInfo<IndexedQueueRow<QueueSnapshotRow>, QueueUiSection>) =>
      renderRow(row, nativeIndex, false),
    [renderRow],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: QueueUiSection }) => (
      <View testID={`queue-section-${section.kind}`} style={styles.sectionHeader}>
        <AppText
          accessibilityRole="header"
          variant="overline"
          color={section.kind === 'current' ? 'accent' : 'secondary'}
          numberOfLines={1}
          style={styles.sectionTitle}
        >
          {section.title}
        </AppText>
        <AppText variant="caption" color="muted">
          {strings.common.trackCount(section.data.length)}
        </AppText>
      </View>
    ),
    [],
  );

  const draggedIndex =
    draggingId === null
      ? -1
      : rows.findIndex((candidate) => candidate.stableId === draggingId);

  const upcomingCount = presentation.upcomingCount;
  const upcomingContextCount =
    presentation.sections.find((section) => section.kind === 'context')?.data.length ?? 0;
  const canToggleShuffle = queue.activeIndex !== null && (shuffle || upcomingContextCount > 1);
  const canClearUpcoming = upcomingCount > 0;
  const transparent = embedded ? styles.transparent : null;

  const listEmpty = useMemo(
    () => (
      <EmptyState
        layout="page"
        testID="queue-empty"
        icon="playlist-music-outline"
        title={strings.queue.emptyTitle}
        message={strings.queue.emptyDetail}
        style={transparent}
      />
    ),
    [transparent],
  );

  // TvShellLayout already applies the 5% TV overscan margins around RootStack.
  const surfacePadding = !embedded && tv.isTv
    ? {
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm,
        paddingHorizontal: tv.contentPaddingHorizontal,
      }
    : queueSurfacePadding(embedded, insets.top, insets.bottom);

  const surface = (
    <View
      testID={embedded ? 'queue-panel' : 'queue-screen'}
      style={[
        styles.container,
        transparent,
        surfacePadding,
      ]}
    >
      <QueueSurfaceHeader
        embedded={embedded}
        upcomingCount={upcomingCount}
        onClose={onClose !== undefined ? handleClose : undefined}
        isTv={tv.isTv}
        tvPreferredCloseFocus={!embedded && tv.isTv && isFocused}
      />

      <View testID="queue-tools" style={styles.tools}>
        <QueueTool
          testID="queue-shuffle"
          icon="shuffle-variant"
          label={shuffle ? strings.queue.restoreOrder : strings.queue.shuffle}
          accessibilityLabel={
            shuffle ? strings.player.disableShuffle : strings.player.enableShuffle
          }
          checked={shuffle}
          busy={mutationPending}
          disabled={editLocked || !canToggleShuffle}
          onPress={() =>
            void runMutation(strings.player.shuffleFailed, async () => {
              const enabled = await toggleShuffle(expectedStableIds);
              setShuffle(enabled);
              return enabled ? strings.queue.shuffleEnabled : strings.queue.orderRestored;
            })
          }
        />
        <QueueTool
          testID="queue-clear-upcoming"
          icon="playlist-remove"
          label={strings.queue.clearUpcoming}
          accessibilityLabel={strings.queue.clearUpcoming}
          accessibilityHint={strings.queue.clearUpcomingHint}
          busy={mutationPending}
          disabled={editLocked || !canClearUpcoming}
          onPress={() =>
            void runMutation(strings.queue.clearUpcomingFailed, async () => {
              await clearUpcomingQueue(expectedStableIds);
              setShuffle(isContextShuffleEnabled());
              return strings.queue.clearedUpcoming(upcomingCount);
            })
          }
        />
      </View>

      {followedParty !== null ? (
        <PartyNotice
          testID="queue-party-active"
          tone="info"
          title={strings.party.activeTitle(
            followedParty.name.trim() === '' ? null : followedParty.name,
          )}
          message={strings.party.queueLocked}
          actionLabel={strings.party.openParty}
          onAction={() => onOpenParty(followedParty.code)}
        />
      ) : (
        <View style={styles.tools}>
          <QueueTool
            testID="queue-start-party"
            icon="account-group-outline"
            label={startingParty ? strings.party.startingParty : strings.party.startParty}
            accessibilityLabel={strings.party.startParty}
            busy={startingParty}
            disabled={startingParty || mutationPending}
            onPress={() => {
              setStartingParty(true);
              setPartyStartError(null);
              startPartyFromQueue().then(
                (party) => onOpenParty(party.code),
                (error: unknown) =>
                  setPartyStartError(strings.party.startPartyFailed(partyErrorDetail(error))),
              ).finally(() => setStartingParty(false));
            }}
          />
        </View>
      )}
      {partyStartError !== null ? (
        <PartyNotice testID="queue-party-start-error" tone="danger" message={partyStartError} />
      ) : null}

      <QueueSurfaceGlobalFeedback embedded={embedded} playerError={playerError} />

      {snapshotVisual.body === 'loading' ? (
        <TrackRowSkeleton testID="queue-loading" accessibilityLabel={strings.queue.loading} />
      ) : snapshotVisual.body === 'hard-error' ? (
        <ErrorState
          layout="page"
          testID="queue-snapshot-error"
          retryTestID="queue-snapshot-retry"
          message={strings.queue.loadFailed}
          onRetry={refreshQueue}
          retryBusy={snapshotStatus.refreshing}
          style={transparent}
        />
      ) : (
        <>
          <QueueSnapshotNoticeView
            notice={snapshotVisual.notice}
            retryBusy={snapshotStatus.refreshing}
            onRetry={refreshQueue}
          />
          <QueueMetadataNoticeView
            state={metadataVisual}
            retryBusy={cachedTracksQuery.fetchStatus === 'fetching'}
            onRetry={() => void cachedTracksQuery.refetch()}
          />

          <View
            ref={attachFrame}
            // Measured for drag-and-drop: Android must not flatten this view away.
            collapsable={false}
            onLayout={drag.onFrameLayout}
            style={styles.listFrame}
          >
            <SectionList
              ref={attachList}
              testID="queue-list"
              sections={sections}
              keyExtractor={keyExtractor}
              stickySectionHeadersEnabled={false}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews={false}
              onScroll={drag.onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={drag.onContentSizeChange}
              contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
              ListEmptyComponent={listEmpty}
              renderSectionHeader={renderSectionHeader}
              renderItem={renderItem}
            />
            <View
              testID="queue-drag-layer"
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={styles.dragLayer}
            >
              <Animated.View
                testID="queue-drop-indicator"
                style={[
                  styles.dropIndicator,
                  {
                    opacity: drag.indicatorOpacity,
                    transform: [{ translateY: drag.indicatorTop }],
                  },
                ]}
              />
              {draggedIndex >= 0 ? (
                <Animated.View
                  testID="queue-drag-ghost"
                  style={[styles.ghost, { transform: [{ translateY: drag.ghostTop }] }]}
                >
                  {renderRow(rows[draggedIndex], draggedIndex, true)}
                </Animated.View>
              ) : null}
            </View>
          </View>
        </>
      )}
    </View>
  );

  return embedded ? surface : <TvFocusScope scope="queue">{surface}</TvFocusScope>;
}

/** Preserve the navigation route contract as a thin standalone wrapper. */
export default function QueueScreen({ navigation }: ScreenProps) {
  return (
    <QueueSurface
      onClose={() => navigation.goBack()}
      onOpenAlbum={(params) => {
        if (openNowPlayingCatalogAlbum(params) !== 'opened') {
          reportPlayerError(
            strings.trackActions.navigationUnavailable,
            new Error(`Root navigation container is not ready to open album ${params.albumId}`),
          );
        }
      }}
      onOpenArtist={(params) => {
        if (openNowPlayingCatalogArtist(params) !== 'opened') {
          reportPlayerError(
            strings.trackActions.navigationUnavailable,
            new Error(`Root navigation container is not ready to open artist ${params.artistId}`),
          );
        }
      }}
      onOpenParty={(code) => navigation.navigate('Party', { code })}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  transparent: { backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  tvCloseButton: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: metrics.minimumTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tools: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.sm,
  },
  tool: {
    flex: 1,
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  toolChecked: { backgroundColor: colors.accentSubtle },
  toolLabel: { flexShrink: 1 },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  errorBanner: { marginHorizontal: layout.pagePadding, marginBottom: spacing.xs },
  listFrame: { flex: 1 },
  list: { paddingHorizontal: spacing.sm, paddingBottom: layout.scrollEndGap },
  dragLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  ghost: {
    position: 'absolute',
    top: 0,
    right: spacing.sm,
    left: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    ...elevation.floating,
  },
  dropIndicator: {
    position: 'absolute',
    top: -spacing.xxs / 4,
    right: spacing.md,
    left: spacing.md,
    height: spacing.xxs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  emptyList: { flexGrow: 1 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  sectionTitle: { flex: 1 },
});
