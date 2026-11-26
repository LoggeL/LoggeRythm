import React, { useMemo, useState } from 'react';
import * as RN from 'react-native';
import { StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { triggerHaptic } from '../../hooks/useHaptics';
import { getReducedMotionSnapshot } from '../../hooks/useReducedMotion';
import { colors, radii } from '../../theme';
import { isTvMode } from '../../tv';
import AppIcon from '../AppIcon';

const SWIPE_ACTIVATE_DX = 14;
const SWIPE_COMMIT_DX = 56;
const SWIPE_MAX_DX = 88;
const REVEAL_ICON_SIZE = 24;

export interface SwipeToQueueWrapperProps {
  track: Track;
  testID: string;
  enabled?: boolean;
  onQueue?: (track: Track) => Promise<boolean> | void;
  children: React.ReactNode;
}

export function shouldCaptureHorizontalQueueSwipe(dx: number, dy: number): boolean {
  return dx >= SWIPE_ACTIVATE_DX && Math.abs(dx) > Math.abs(dy) * 1.8;
}

export function shouldCommitHorizontalQueueSwipe(dx: number): boolean {
  return dx >= SWIPE_COMMIT_DX;
}

function createSwipeToQueueResponder(
  translateX: RN.Animated.Value,
  track: Track,
  onQueue?: (track: Track) => Promise<boolean> | void,
) {
  let committedHaptic = false;
  const resetPosition = () => {
    committedHaptic = false;
    if (getReducedMotionSnapshot() || typeof RN.Animated.spring !== 'function') {
      translateX.setValue(0);
      return;
    }
    RN.Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 26,
      bounciness: 4,
    }).start();
  };
  return RN.PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      shouldCaptureHorizontalQueueSwipe(gesture.dx, gesture.dy),
    onPanResponderMove: (_event, gesture) => {
      const clamped = Math.max(0, Math.min(SWIPE_MAX_DX, gesture.dx));
      if (!getReducedMotionSnapshot()) {
        translateX.setValue(clamped);
      }
      if (clamped >= SWIPE_COMMIT_DX && !committedHaptic) {
        committedHaptic = true;
        triggerHaptic('tap');
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      const shouldCommit = shouldCommitHorizontalQueueSwipe(gesture.dx);
      resetPosition();
      if (shouldCommit) {
        triggerHaptic('commit');
        if (onQueue !== undefined) {
          void onQueue(track);
        } else {
          void import('../trackActions')
            .then((mod) => mod.quickAddTrackToQueue(track))
            .catch((error: unknown) => {
              console.error('[LoggeRythm] Swipe-to-queue failed:', error);
            });
        }
      }
    },
    onPanResponderTerminate: resetPosition,
    onPanResponderTerminationRequest: () => false,
  });
}

function SwipeToQueueAnimatedBody({
  track,
  testID,
  onQueue,
  children,
}: {
  track: Track;
  testID: string;
  onQueue?: (track: Track) => Promise<boolean> | void;
  children: React.ReactNode;
}) {
  const [translateX] = useState(() => new RN.Animated.Value(0));

  const responder = useMemo(
    () => createSwipeToQueueResponder(translateX, track, onQueue),
    [onQueue, track, translateX],
  );

  // The row above is transparent, so the action has to be invisible at rest:
  // it fades in with the drag and is fully opaque once a release would commit.
  const revealOpacity = useMemo(
    () =>
      translateX.interpolate({
        inputRange: [0, SWIPE_COMMIT_DX],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [translateX],
  );

  return (
    <View style={styles.wrap}>
      <RN.Animated.View
        testID={`${testID}-swipe-queue-action`}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.reveal, { opacity: revealOpacity }]}
      >
        <View style={styles.revealGlyph}>
          <AppIcon name="playlist-plus" size={REVEAL_ICON_SIZE} color={colors.onAccent} />
        </View>
      </RN.Animated.View>
      <RN.Animated.View
        testID={`${testID}-swipe-surface`}
        style={{ transform: [{ translateX }] }}
        {...responder.panHandlers}
      >
        {children}
      </RN.Animated.View>
    </View>
  );
}

/**
 * Horizontal swipe-right-to-queue wrapper for track rows. Disabled on Android TV
 * and gracefully bypassed when Animated/PanResponder are absent in shallow tests.
 */
export function SwipeToQueueWrapper({
  track,
  testID,
  enabled = true,
  onQueue,
  children,
}: SwipeToQueueWrapperProps) {
  const hasNativeGestures =
    enabled
    && 'PanResponder' in RN
    && typeof RN.PanResponder?.create === 'function'
    && 'Animated' in RN
    && typeof RN.Animated?.Value === 'function'
    && 'Platform' in RN
    && RN.Platform !== undefined;
  if (!hasNativeGestures || isTvMode()) {
    return <>{children}</>;
  }
  return (
    <SwipeToQueueAnimatedBody track={track} testID={testID} onQueue={onQueue}>
      {children}
    </SwipeToQueueAnimatedBody>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radii.md,
  },
  reveal: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SWIPE_MAX_DX,
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.md,
  },
  // Only the strip the row has uncovered is visible. The glyph is centred in
  // the part that is open when a release starts to commit, so it is whole at
  // that moment; a text label ("Warteschlange") never fitted there.
  revealGlyph: {
    width: SWIPE_COMMIT_DX,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
