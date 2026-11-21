import React, { useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  SectionList,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAutoRadioEnabled, usePlayerIsSetup, useProgress, useRepeatMode, RepeatMode } from '../player/player';
import { changeAutoplay } from '../components/profile/AutoplayPanel';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AppIcon, { type AppIconName } from '../components/AppIcon';
import {
  ActionButton,
  AppText,
  EmptyState,
  ErrorState,
  TrackRowSkeleton,
} from '../components/ui';
import PlayerNoticeBanner from '../components/PlayerNoticeBanner';
import { PlayerErrorBanner } from '../components/player/PlayerErrorBanner';
import {
  QueueMetadataNoticeView,
  QueueSnapshotNoticeView,
} from '../components/player/QueueNotices';
import { QueueRow } from '../components/player/QueueRow';
import { PartyNotice } from '../components/party/PartyParts';
import { partyErrorDetail } from '../party/partyErrors';
import { startPartyFromQueue, usePartySession } from '../party/partyRuntime';
import { useTrackPresentationResolver } from '../components/player/TrackPresentationProvider';
import { musicQueries } from '../data';
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
import { strings } from '../localization';
import { colors, elevation, layout, metrics, opacity, radii, spacing } from '../theme';
import {
  authoritativeQueueTrackPresentation,
  resolveQueueMetadataVisualState,
} from './queueMetadata';
import {
  buildQueuePresentation,
  contextLabelForSection,
  queueTailContinuation,
  type QueuePresentationSection,
  type QueueSectionKind,
  type QueueTailContinuation,
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
        <ActionButton
          testID="queue-close"
          variant="secondary"
          label={strings.queue.done}
          accessibilityLabel={strings.queue.close}
          onPress={onClose}
        />
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
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={checked === undefined ? { busy, disabled } : { checked, busy, disabled }}
      disabled={disabled}
      onPress={onPress}
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
    </Pressable>
  );
}

/**
 * The end of the queue says what follows it, so the switch into track radio
 * never comes as a surprise. Autoplay can be flipped right here as well.
 */
export function QueueTailFooter({
  continuation,
  autoplayReady,
  autoplayBusy,
  autoplayError,
  onAutoplayChange,
}: {
  continuation: QueueTailContinuation;
  autoplayReady: boolean;
  autoplayBusy: boolean;
  autoplayError: string | null;
  onAutoplayChange: (enabled: boolean) => void;
}) {
  const active = continuation !== 'stop';
  const title = continuation === 'radio'
    ? strings.queue.radioContinuesTitle
    : continuation === 'autoplay'
      ? strings.queue.autoplayNextTitle
      : strings.queue.autoplayOffTitle;
  const detail = continuation === 'radio'
    ? strings.queue.radioContinuesDetail
    : continuation === 'autoplay'
      ? strings.queue.autoplayNextDetail
      : strings.queue.autoplayOffDetail;
  const switchDisabled = !autoplayReady || autoplayBusy;
  return (
    <View testID="queue-tail" style={styles.tailWrap}>
      <View
        testID={`queue-tail-${continuation}`}
        style={[styles.tail, active ? styles.tailActive : null]}
      >
        <View accessible={false} style={[styles.tailGlyph, active ? styles.tailGlyphActive : null]}>
          <AppIcon
            name={active ? 'radio-tower' : 'stop-circle-outline'}
            color={active ? colors.accentSoft : colors.textSecondary}
            size={20}
          />
        </View>
        <View accessible accessibilityRole="text" style={styles.tailCopy}>
          <AppText variant="bodyStrong" color={active ? 'accent' : 'primary'} numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="callout" color="secondary">{detail}</AppText>
        </View>
        {continuation === 'radio' ? null : (
          <Switch
            testID="queue-autoplay-switch"
            accessibilityLabel={strings.profile.autoplayToggle}
            accessibilityState={{
              disabled: switchDisabled,
              busy: autoplayBusy,
              checked: continuation === 'autoplay',
            }}
            disabled={switchDisabled}
            value={continuation === 'autoplay'}
            onValueChange={onAutoplayChange}
            trackColor={{ false: colors.border, true: colors.accentSolid }}
            thumbColor={continuation === 'autoplay' ? colors.accentSoft : colors.textSecondary}
          />
        )}
      </View>
      {autoplayError !== null ? (
        <AppText
          testID="queue-autoplay-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.tailError}
        >
          {autoplayError}
        </AppText>
      ) : null}
    </View>
  );
}

/** Shared queue implementation used by both the root modal and Now Playing tab. */
export function QueueSurface({
  embedded = false,
  onClose,
  onOpenAlbum,
  onOpenArtist,
  onOpenParty,
}: QueueSurfaceProps) {
  const insets = useSafeAreaInsets();
  const partyState = usePartySession();
  // While a party steers the player its queue is the party's: edit it there.
  const followedParty =
    partyState.detached || partyState.listenMode === 'host' ? null : partyState.party;
  // Listening at the host leaves this device's queue to the device, but the
  // party stays one tap away (and a second party cannot be started meanwhile).
  const hostParty =
    !partyState.detached && partyState.listenMode === 'host' ? partyState.party : null;
  const bannerParty = followedParty ?? hostParty;
  const [startingParty, setStartingParty] = useState(false);
  const [partyStartError, setPartyStartError] = useState<string | null>(null);
  const playerError = usePlayerError();
  const activeProgress = useProgress(1);
  const { presentationFor } = useTrackPresentationResolver();
  const { queue, status: snapshotStatus, shuffle, setShuffle, refresh: refreshQueue } =
    useQueueSnapshot();
  const [mutationPending, setMutationPending] = useState(false);
  const mutationLock = useRef(false);
  const autoRadioEnabled = useAutoRadioEnabled();
  const playerSetUp = usePlayerIsSetup();
  const repeatMode = useRepeatMode();
  const [autoplayBusy, setAutoplayBusy] = useState(false);
  const [autoplayError, setAutoplayError] = useState<string | null>(null);
  const autoplayLock = useRef(false);
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
  // Titles are resolved per render so they follow a locale switch.
  const sections: QueueUiSection[] = presentation.sections.map((section) => ({
    ...section,
    title: sectionTitle(section.kind, section.data),
  }));
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

  // The two view refs are taken out of the controller: passing a member of an
  // object to `ref` would mark the whole object as a ref for the hooks linter.
  const editLocked = mutationPending || followedParty !== null;
  const { attachFrame, attachList, ...drag } = useQueueDrag({
    rows,
    activeIndex: queue.activeIndex,
    disabled: editLocked,
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

  /** One queue row; `floating` is the copy that follows the finger during a drag. */
  const renderRow = (row: QueueSnapshotRow, nativeIndex: number, floating: boolean) => {
    const active = nativeIndex === queue.activeIndex;
    const range = queueDragRange(origins, queue.activeIndex, nativeIndex);
    const title = row.track.title;
    const resolvedPresentation = presentationFor(
      {
        trackId: row.track.id,
        queueContext:
          row.context === null ? null : { type: row.context.type, id: row.context.id },
        originalContextOrder: row.originalContextOrder,
      },
      active ? { rollingDeviceCacheSeconds: activeProgress.cached } : undefined,
    );
    return (
      <QueueRow
        track={row.track}
        testID={floating ? 'queue-drag-ghost-row' : `queue-row-${testIdPart(row.stableId)}`}
        active={active}
        // Queue-native index is authoritative even for duplicate manual or legacy ids.
        presentation={authoritativeQueueTrackPresentation(resolvedPresentation, active)}
        disabled={editLocked}
        canMoveUp={range !== null && nativeIndex > range.min}
        canMoveDown={range !== null && nativeIndex < range.max}
        rowRef={floating ? undefined : drag.attachRow(row.stableId)}
        dragHandlers={
          floating ? {} : drag.canDrag(nativeIndex) ? drag.handlersFor(row.stableId) : undefined
        }
        dragging={!floating && drag.draggingId === row.stableId}
        moveControlsOpen={!floating && moveControlsFor === row.stableId}
        onToggleMoveControls={() =>
          setMoveControlsFor((current) => (current === row.stableId ? null : row.stableId))
        }
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
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
  };
  const draggedIndex =
    drag.draggingId === null
      ? -1
      : rows.findIndex((candidate) => candidate.stableId === drag.draggingId);

  const upcomingCount = presentation.upcomingCount;
  const upcomingContextCount = presentation.sections
    .filter((section) => section.kind === 'context')
    .reduce((total, section) => total + section.data.length, 0);
  const lastRow = rows.length === 0 ? null : rows[rows.length - 1];
  const tailContinuation = queueTailContinuation({
    lastRowIsRadio: lastRow === null || queue.activeIndex === null ? null : lastRow.radio,
    autoRadioEnabled,
    repeatOff: repeatMode === RepeatMode.Off,
    partyQueue: followedParty !== null || lastRow?.context?.type === 'party',
  });
  const changeTailAutoplay = (enabled: boolean) => {
    if (autoplayLock.current) return;
    autoplayLock.current = true;
    setAutoplayBusy(true);
    setAutoplayError(null);
    changeAutoplay(enabled).then(
      () => AccessibilityInfo.announceForAccessibility(
        enabled ? strings.profile.autoplayEnabled : strings.profile.autoplayDisabled,
      ),
      (cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : String(cause);
        setAutoplayError(`${strings.profile.autoplayFailed} (${detail})`);
      },
    ).finally(() => {
      autoplayLock.current = false;
      setAutoplayBusy(false);
    });
  };
  const canToggleShuffle = queue.activeIndex !== null && (shuffle || upcomingContextCount > 1);
  const canClearUpcoming = upcomingCount > 0;
  const transparent = embedded ? styles.transparent : null;

  return (
    <View
      testID={embedded ? 'queue-panel' : 'queue-screen'}
      style={[
        styles.container,
        transparent,
        queueSurfacePadding(embedded, insets.top, insets.bottom),
      ]}
    >
      <QueueSurfaceHeader
        embedded={embedded}
        upcomingCount={upcomingCount}
        onClose={onClose}
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

      {bannerParty !== null ? (
        <PartyNotice
          testID="queue-party-active"
          tone="info"
          title={strings.party.activeTitle(
            bannerParty.name.trim() === '' ? null : bannerParty.name,
          )}
          message={
            followedParty !== null
              ? strings.party.queueLocked
              : strings.party.queueAtHost(bannerParty.host_name)
          }
          actionLabel={strings.party.openParty}
          onAction={() => onOpenParty(bannerParty.code)}
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
              keyExtractor={(entry) => entry.row.stableId}
              stickySectionHeadersEnabled={false}
              onScroll={drag.onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={drag.onContentSizeChange}
              contentContainerStyle={rows.length === 0 ? styles.emptyList : styles.list}
              ListEmptyComponent={
                <EmptyState
                  layout="page"
                  testID="queue-empty"
                  icon="playlist-music-outline"
                  title={strings.queue.emptyTitle}
                  message={strings.queue.emptyDetail}
                  style={transparent}
                />
              }
              ListFooterComponent={
                tailContinuation === null || rows.length === 0 ? null : (
                  <QueueTailFooter
                    continuation={tailContinuation}
                    autoplayReady={playerSetUp}
                    autoplayBusy={autoplayBusy}
                    autoplayError={autoplayError}
                    onAutoplayChange={changeTailAutoplay}
                  />
                )
              }
              renderSectionHeader={({ section }) => (
                <View testID={`queue-section-${section.key}`} style={styles.sectionHeader}>
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
              )}
              renderItem={({ item: { row, nativeIndex } }) => renderRow(row, nativeIndex, false)}
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
  tailWrap: { paddingTop: spacing.lg, gap: spacing.xs },
  tail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.fill,
  },
  tailActive: { backgroundColor: colors.accentSubtle, borderColor: colors.accentSolid },
  tailGlyph: {
    width: layout.artwork.xs,
    height: layout.artwork.xs,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fillStrong,
  },
  tailGlyphActive: { backgroundColor: colors.backgroundElevated },
  tailCopy: { flex: 1, minWidth: 0 },
  tailError: { paddingHorizontal: spacing.xs },
});
