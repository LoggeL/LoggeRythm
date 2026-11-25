import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import type {
  TrackOccurrenceIdentity,
  TrackPresentationState,
} from '../../player/trackPresentation';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import TrackLikeButton from '../TrackLikeButton';
import TrackStateIndicator, { MemoEqualizerBars } from '../TrackStateIndicator';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import {
  AppText,
  createFocusRingController,
  FocusRingOverlay,
  IconButton,
  type TvFocusProps,
} from '../ui';
import { TrackArtworkOverlay } from './TrackArtworkOverlay';
import { SwipeToQueueWrapper } from './SwipeToQueueWrapper';
import TrackIdentityLinks from './TrackIdentityLinks';
import {
  buildTrackMetadata,
  type TrackPopularityPolicy,
} from './trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from './trackPresentationCopy';

export type TrackOccurrenceTarget = Omit<TrackOccurrenceIdentity, 'trackId'>;

export interface StandardTrackRowProps extends TvFocusProps {
  track: Track;
  testID: string;
  occurrence?: TrackOccurrenceTarget;
  position?: number;
  popularity?: TrackPopularityPolicy;
  plays?: TrackPlayCount;
  showAlbumLabel?: boolean;
  showDuration?: boolean;
  rollingDeviceCacheSeconds?: unknown;
  onPlay: () => void;
  onActions?: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
  trailingControls?: ReactNode;
  highlighted?: boolean;
  /**
   * One bounded collection fact under the identity (e.g. Radar release
   * recency). Rendered as `${testID}-metadata`; omitted when undefined.
   */
  caption?: string;
  /** Spoken form of `caption` where the compact line abbreviates. Defaults to `caption`. */
  captionAccessibilityLabel?: string;
  /** Disable horizontal swipe-to-queue gesture (e.g. during drag-to-reorder mode). */
  swipeToQueue?: boolean;
}

export interface StandardTrackRowViewProps
  extends Omit<StandardTrackRowProps, 'occurrence' | 'rollingDeviceCacheSeconds'> {
  presentation: TrackPresentationState;
}

function samePresentation(
  left: TrackPresentationState,
  right: TrackPresentationState,
): boolean {
  return (
    left.active === right.active
    && left.playback === right.playback
    && left.serverCache === right.serverCache
    && left.explicitDownload.kind === right.explicitDownload.kind
    && left.rollingDeviceCache?.seconds === right.rollingDeviceCache?.seconds
  );
}

export function areStandardTrackRowViewPropsEqual(
  previous: StandardTrackRowViewProps,
  next: StandardTrackRowViewProps,
): boolean {
  return (
    previous.track === next.track
    && previous.testID === next.testID
    && previous.position === next.position
    && previous.popularity === next.popularity
    && previous.plays === next.plays
    && previous.showAlbumLabel === next.showAlbumLabel
    && previous.showDuration === next.showDuration
    && previous.onPlay === next.onPlay
    && previous.onActions === next.onActions
    && previous.onOpenAlbum === next.onOpenAlbum
    && previous.onOpenArtist === next.onOpenArtist
    && previous.trailingControls === next.trailingControls
    && previous.highlighted === next.highlighted
    && previous.caption === next.caption
    && previous.captionAccessibilityLabel === next.captionAccessibilityLabel
    && previous.swipeToQueue === next.swipeToQueue
    && previous.focusable === next.focusable
    && previous.hasTVPreferredFocus === next.hasTVPreferredFocus
    && previous.onFocus === next.onFocus
    && previous.onBlur === next.onBlur
    && previous.focused === next.focused
    && previous.focusedStyle === next.focusedStyle
    && samePresentation(previous.presentation, next.presentation)
  );
}

/**
 * Pure memoized inner view of `StandardTrackRow`. Tapping anywhere across the
 * artwork + identity body plays/toggles the track (matching `web/`'s phone UX),
 * eliminating accidental Album/Artist screen hijacks; explicit Album/Artist
 * navigation lives in the TrackActions sheet (`...` or long-press).
 */
export function StandardTrackRowView({
  track,
  testID,
  position,
  popularity = 'none',
  plays,
  showAlbumLabel = true,
  showDuration = true,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
  trailingControls,
  highlighted = false,
  caption,
  captionAccessibilityLabel = caption,
  swipeToQueue = true,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
  presentation,
}: StandardTrackRowViewProps) {
  const metadata = buildTrackMetadata(track, {
    popularity,
    ...(plays === undefined ? {} : { plays }),
  });
  const buffering = presentation.playback === 'buffering';
  const showEqualizer =
    presentation.active
    && (presentation.playback === 'playing' || presentation.playback === 'paused');
  const focusController = createFocusRingController();
  const playActionLabel =
    presentation.playback === 'playing'
      ? strings.trackPresentation.pauseTrack(track.title)
      : strings.trackPresentation.playTrack(track.title);
  const artistLabel = trackArtistLabel(track);
  const accessibilityLabel = artistLabel.length > 0
    ? `${playActionLabel}, ${artistLabel}`
    : playActionLabel;

  return (
    <View
      testID={`${testID}-container`}
      collapsable={false}
      style={[
        styles.container,
        ...(highlighted ? [styles.highlightedContainer] : []),
        ...(presentation.active ? [styles.activeContainer] : []),
      ]}
    >
      {presentation.active ? (
        <View
          testID={`${testID}-active-accent`}
          accessible={false}
          focusable={false}
          importantForAccessibility="no"
          pointerEvents="none"
          style={styles.activeAccentBar}
        />
      ) : null}
      <SwipeToQueueWrapper track={track} testID={testID} enabled={swipeToQueue}>
      <View style={styles.row}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={
            onActions === undefined ? undefined : strings.trackActions.moreActionsHint
          }
          accessibilityActions={
            onActions === undefined
              ? undefined
              : [{ name: 'longpress', label: strings.trackActions.moreActionsLabel }]
          }
          accessibilityState={{ selected: presentation.active, busy: buffering }}
          focusable={focusable}
          hasTVPreferredFocus={hasTVPreferredFocus}
          android_ripple={{ color: colors.fillStrong, borderless: false }}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'longpress') onActions?.();
          }}
          onFocus={(event) => {
            focusController.setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            focusController.setFocused(false);
            onBlur?.(event);
          }}
          onPress={onPlay}
          onLongPress={onActions}
          style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
        >
          <View style={styles.playTarget}>
            <TrackArtworkOverlay
              cover={track.cover}
              size={layout.artwork.sm}
              presentation={presentation}
              badge={position}
              badgeTestID={`${testID}-position`}
            />
          </View>
          <View style={styles.copy}>
            <View style={styles.identityLine}>
              <TrackIdentityLinks
                metadata={metadata}
                testID={`${testID}-identity`}
                copy={trackIdentityCopy}
                onOpenAlbum={onOpenAlbum}
                onOpenArtist={onOpenArtist}
                showAlbumLabel={showAlbumLabel}
                showDuration={showDuration}
                showPopularity={popularity !== 'none'}
                active={presentation.active}
                interactive={false}
              />
              {showEqualizer ? (
                <MemoEqualizerBars
                  testID={`${testID}-equalizer`}
                  isPlaying={presentation.playback === 'playing'}
                />
              ) : null}
              <TrackStateIndicator
                presentation={presentation}
                copy={trackStateIndicatorCopy}
                testID={`${testID}-state`}
              />
            </View>
            {caption === undefined ? null : (
              <AppText
                testID={`${testID}-metadata`}
                accessibilityLabel={captionAccessibilityLabel}
                variant="caption"
                color={highlighted ? 'accent' : 'muted'}
                numberOfLines={2}
              >
                {caption}
              </AppText>
            )}
          </View>
          <FocusRingOverlay
            controller={focusController}
            borderRadius={radii.md}
            controlledFocused={focused}
            focusedStyle={focusedStyle}
          />
        </Pressable>
        <TrackLikeButton track={track} testID={`${testID}-like`} />
        {onActions !== undefined ? (
          <IconButton
            testID={`${testID}-actions`}
            icon="dots-vertical"
            accessibilityLabel={`${strings.trackActions.moreActionsLabel}: ${track.title}`}
            onPress={onActions}
          />
        ) : null}
      </View>
      </SwipeToQueueWrapper>
      {trailingControls === undefined ? null : (
        <View testID={`${testID}-trailing-controls`} style={styles.trailingControls}>
          {trailingControls}
        </View>
      )}
    </View>
  );
}

const MemoStandardTrackRowView = React.memo(
  StandardTrackRowView,
  areStandardTrackRowViewPropsEqual,
);

/**
 * The canonical vertical track row: full row body (artwork + identity + state)
 * is the play/toggle target, while Like and overflow remain sibling 48dp
 * buttons so no responder can swallow another action.
 */
export default function StandardTrackRow({
  track,
  occurrence,
  rollingDeviceCacheSeconds,
  ...rest
}: StandardTrackRowProps) {
  const presentation = useTrackPresentation(
    { trackId: track.id, ...occurrence },
    { rollingDeviceCacheSeconds },
  );
  return (
    <MemoStandardTrackRowView
      {...rest}
      track={track}
      presentation={presentation}
    />
  );
}

const styles = StyleSheet.create({
  // The 8dp outer margin plus the 12dp inner inset put the cover on the 20dp
  // page gutter while the active tint still bleeds past it.
  container: {
    position: 'relative',
    minHeight: layout.rowHeight,
    borderRadius: radii.md,
    marginHorizontal: spacing.xs,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  // Never toggle borderLeftWidth/borderWidth on an overflow:'hidden' + borderRadius
  // view on RN 0.86 Android Fabric (BackgroundStyleApplicator blanks the view when
  // borderLeftWidth transitions 3 -> undefined). Paint the 3dp strip as an absolute child.
  activeContainer: {
    backgroundColor: colors.accentSubtle,
  },
  activeAccentBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 3,
    backgroundColor: colors.accent,
  },
  highlightedContainer: { backgroundColor: colors.surface },
  row: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xxs,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xxs,
    borderRadius: radii.md,
  },
  playTarget: {
    width: layout.artwork.sm,
    height: layout.artwork.sm,
    borderRadius: radii.sm,
    marginRight: spacing.sm,
  },
  copy: { minWidth: 0, flex: 1, justifyContent: 'center', paddingRight: spacing.xxs },
  identityLine: { minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  trailingControls: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  pressed: { opacity: opacity.pressed, backgroundColor: colors.fill },
});
