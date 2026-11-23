import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import {
  ServerCompatibilityCheckError,
  UnsupportedServerError,
} from '../api/compatibility';
import { useAuth } from '../auth/AuthContext';
import { presentError, type UserFacingError } from '../auth/presentationError';
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '../connectivity/store';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { strings } from '../localization';
import { colors, elevation, layout, metrics, opacity, radii, spacing } from '../theme';
import AppIcon from './AppIcon';
import { AppText } from './ui';

export type ConnectivityBannerKind = 'offline' | 'restored' | 'error';

export interface ConnectivityBannerViewProps {
  kind: ConnectivityBannerKind;
  topInset?: number;
  message?: string;
  onRetry?: () => void;
  retryBusy?: boolean;
}

const SLIDE_DISTANCE = 96;
const ENTER_MS = 220;
const EXIT_MS = 180;

/**
 * Classifies errors that genuinely indicate the server is still unreachable
 * during offline-mode revalidation. Every other failure (unsupported server,
 * 4xx rejection, identity drift, storage failure, unexpected runtime error)
 * must be reported loudly rather than silently kept as "offline".
 */
export function isTransientOfflineError(error: unknown): boolean {
  if (error instanceof UnsupportedServerError) return false;
  if (error instanceof ServerCompatibilityCheckError) return true;
  return (
    error instanceof ApiError
    && (
      error.status === 0
      || error.status === 408
      || error.status === 425
      || error.status === 429
      || error.status >= 500
    )
  );
}

export function ConnectivityBannerView({
  kind,
  topInset = 0,
  message,
  onRetry,
  retryBusy = false,
}: ConnectivityBannerViewProps) {
  const offline = kind === 'offline';
  const isError = kind === 'error';
  const title = isError
    ? strings.shell.revalidationFailedTitle
    : offline
      ? strings.shell.offlineTitle
      : strings.shell.backOnlineTitle;
  const body = isError
    ? (message ?? strings.shell.revalidationFailedBody)
    : offline
      ? strings.shell.offlineBody
      : strings.shell.backOnlineBody;
  const iconName = isError ? 'alert-circle-outline' : offline ? 'wifi-off' : 'wifi-check';
  const iconColor = isError ? colors.danger : offline ? colors.warning : colors.success;
  const testID = isError ? 'connectivity-revalidation-error' : `connectivity-${kind}`;

  return (
    <View
      testID={testID}
      accessibilityRole={offline || isError ? 'alert' : 'text'}
      accessibilityLiveRegion={offline || isError ? 'assertive' : 'polite'}
      accessibilityLabel={`${title}. ${body}`}
      style={[
        styles.banner,
        isError ? styles.error : offline ? styles.offline : styles.restored,
        { paddingTop: Math.max(topInset, spacing.xs) },
      ]}
    >
      <AppIcon name={iconName} color={iconColor} size={20} />
      <View style={styles.copy}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" color="secondary">{body}</AppText>
      </View>
      {isError && onRetry !== undefined ? (
        <Pressable
          testID="connectivity-revalidation-retry"
          accessibilityRole="button"
          accessibilityLabel={strings.shell.revalidationRetry}
          accessibilityState={{ disabled: retryBusy, busy: retryBusy }}
          disabled={retryBusy}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && !retryBusy ? styles.retryPressed : null,
            retryBusy ? styles.retryDisabled : null,
          ]}
        >
          <AppText variant="label" color="primary">
            {retryBusy ? strings.common.retrying : strings.shell.revalidationRetry}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

interface DisplayedBanner {
  kind: ConnectivityBannerKind;
  message?: string;
}

export default function ConnectivityBanner() {
  const { offlineMode, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  );
  const status = connectivity.status;
  const unavailable = offlineMode || status === 'offline';
  const revalidatedOnlineEpoch = useRef(false);
  const [revalidationError, setRevalidationError] = useState<UserFacingError | null>(null);
  const [revalidating, setRevalidating] = useState(false);

  const runRevalidation = useCallback(async (): Promise<void> => {
    setRevalidating(true);
    try {
      await refreshUser();
      setRevalidationError(null);
    } catch (error: unknown) {
      if (isTransientOfflineError(error)) {
        const detail = error instanceof ApiError
          ? `status=${error.status}`
          : error instanceof Error
            ? error.name
            : 'unknown';
        console.warn(`[LoggeRythm] offline-mode revalidation deferred (${detail})`);
        setRevalidationError(null);
      } else {
        console.error('[LoggeRythm] offline-mode session revalidation failed:', error);
        setRevalidationError(presentError(error, strings.shell.revalidationFailedBody));
      }
    } finally {
      setRevalidating(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (status !== 'online') {
      revalidatedOnlineEpoch.current = false;
      return;
    }
    if (!offlineMode || revalidatedOnlineEpoch.current) return;
    revalidatedOnlineEpoch.current = true;
    void Promise.resolve().then(() => runRevalidation());
  }, [offlineMode, runRevalidation, status]);

  const showRevalidationError =
    revalidationError !== null && offlineMode && status === 'online';

  const activeBanner = useMemo<DisplayedBanner | null>(() => {
    if (showRevalidationError && revalidationError !== null) {
      return { kind: 'error', message: revalidationError.message };
    }
    if (unavailable) return { kind: 'offline' };
    if (connectivity.showRecovery) return { kind: 'restored' };
    return null;
  }, [connectivity.showRecovery, revalidationError, showRevalidationError, unavailable]);

  const [lastBanner, setLastBanner] = useState<DisplayedBanner | null>(activeBanner);
  const [exiting, setExiting] = useState(false);
  const [visibility] = useState(() => new Animated.Value(activeBanner !== null ? 1 : 0));
  const runningAnimation = useRef<Animated.CompositeAnimation | null>(null);

  if (
    activeBanner !== null
    && (
      lastBanner?.kind !== activeBanner.kind
      || lastBanner?.message !== activeBanner.message
      || exiting
    )
  ) {
    setLastBanner(activeBanner);
    setExiting(false);
  } else if (activeBanner === null && lastBanner !== null && !exiting) {
    if (reducedMotion) {
      setLastBanner(null);
    } else {
      setExiting(true);
    }
  }

  const renderedBanner = activeBanner ?? (exiting ? lastBanner : null);

  useEffect(() => {
    runningAnimation.current?.stop();
    runningAnimation.current = null;

    if (activeBanner !== null) {
      if (reducedMotion) {
        visibility.setValue(1);
        return;
      }
      const animation = Animated.timing(visibility, {
        toValue: 1,
        duration: ENTER_MS,
        useNativeDriver: true,
      });
      runningAnimation.current = animation;
      animation.start();
      return;
    }

    if (!exiting) {
      visibility.setValue(0);
      return;
    }
    const animation = Animated.timing(visibility, {
      toValue: 0,
      duration: EXIT_MS,
      useNativeDriver: true,
    });
    runningAnimation.current = animation;
    animation.start(({ finished }) => {
      if (finished) {
        setExiting(false);
        setLastBanner(null);
      }
    });
  }, [activeBanner, exiting, reducedMotion, visibility]);

  const animatedStyle = useMemo(
    () => ({
      opacity: visibility,
      transform: [
        {
          translateY: visibility.interpolate({
            inputRange: [0, 1],
            outputRange: [-SLIDE_DISTANCE, 0],
          }),
        },
      ],
    }),
    [visibility],
  );

  if (renderedBanner === null) return null;

  return (
    <Animated.View
      pointerEvents={activeBanner !== null ? 'box-none' : 'none'}
      style={[styles.overlay, animatedStyle]}
    >
      <ConnectivityBannerView
        kind={renderedBanner.kind}
        topInset={insets.top}
        message={renderedBanner.message}
        onRetry={renderedBanner.kind === 'error' ? () => void runRevalidation() : undefined}
        retryBusy={revalidating}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 50,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: layout.pagePadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    ...elevation.floating,
  },
  offline: { backgroundColor: colors.warningSubtle },
  restored: { backgroundColor: colors.successSubtle },
  error: { backgroundColor: colors.dangerSubtle },
  copy: { flex: 1, minWidth: 0 },
  retryButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  retryPressed: { opacity: opacity.pressed },
  retryDisabled: { opacity: opacity.disabled },
});
