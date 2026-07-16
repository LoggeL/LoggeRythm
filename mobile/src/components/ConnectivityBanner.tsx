import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import {
  getConnectivitySnapshot,
  subscribeConnectivity,
} from '../connectivity/store';
import { strings } from '../localization';
import { colors } from '../theme';

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
        { paddingTop: Math.max(topInset, 8) },
      ]}
    >
      <Text style={styles.title}>
        {offline ? strings.shell.offlineTitle : strings.shell.backOnlineTitle}
      </Text>
      <Text style={styles.body}>
        {offline ? strings.shell.offlineBody : strings.shell.backOnlineBody}
      </Text>
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
    borderBottomWidth: 1,
    paddingBottom: 8,
    paddingHorizontal: 16,
    zIndex: 10,
    elevation: 10,
  },
  offline: {
    backgroundColor: '#31270f',
    borderBottomColor: colors.warning,
  },
  restored: {
    backgroundColor: '#103025',
    borderBottomColor: colors.success,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  body: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
});
