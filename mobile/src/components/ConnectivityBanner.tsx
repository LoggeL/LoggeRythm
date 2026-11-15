import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '../connectivity/store';
import { strings } from '../localization';
import { colors, elevation, layout, spacing } from '../theme';
import AppIcon from './AppIcon';
import { AppText } from './ui';

export interface ConnectivityBannerViewProps {
  kind: 'offline' | 'restored';
  topInset?: number;
}

export function ConnectivityBannerView({
  kind,
  topInset = 0,
}: ConnectivityBannerViewProps) {
  const offline = kind === 'offline';
  return (
    <View
      testID={`connectivity-${kind}`}
      accessibilityRole={offline ? 'alert' : 'text'}
      accessibilityLiveRegion={offline ? 'assertive' : 'polite'}
      accessibilityLabel={offline
        ? `${strings.shell.offlineTitle}. ${strings.shell.offlineBody}`
        : `${strings.shell.backOnlineTitle}. ${strings.shell.backOnlineBody}`}
      style={[
        styles.banner,
        offline ? styles.offline : styles.restored,
        { paddingTop: Math.max(topInset, spacing.xs) },
      ]}
    >
      <AppIcon
        name={offline ? 'wifi-off' : 'wifi-check'}
        color={offline ? colors.warning : colors.success}
        size={20}
      />
      <View style={styles.copy}>
        <AppText variant="label">
          {offline ? strings.shell.offlineTitle : strings.shell.backOnlineTitle}
        </AppText>
        <AppText variant="caption" color="secondary">
          {offline ? strings.shell.offlineBody : strings.shell.backOnlineBody}
        </AppText>
      </View>
    </View>
  );
}

export default function ConnectivityBanner() {
  const { offlineMode, refreshUser } = useAuth();
  const insets = useSafeAreaInsets();
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  );
  const status = connectivity.status;
  const unavailable = offlineMode || status === 'offline';
  const revalidatedOnlineEpoch = useRef(false);

  useEffect(() => {
    if (status !== 'online') {
      revalidatedOnlineEpoch.current = false;
      return;
    }
    if (!offlineMode || revalidatedOnlineEpoch.current) return;
    revalidatedOnlineEpoch.current = true;
    void refreshUser().catch(() => {
      // Keep the durable offline-mode warning visible. A later connectivity
      // epoch or an explicit app retry can revalidate without exposing detail.
    });
  }, [offlineMode, refreshUser, status]);

  if (unavailable) return <ConnectivityBannerView kind="offline" topInset={insets.top} />;
  if (connectivity.showRecovery) {
    return <ConnectivityBannerView kind="restored" topInset={insets.top} />;
  }
  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: layout.pagePadding,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    zIndex: 1,
    ...elevation.floating,
  },
  offline: { backgroundColor: colors.warningSubtle },
  restored: { backgroundColor: colors.successSubtle },
  copy: { flex: 1, minWidth: 0 },
});
