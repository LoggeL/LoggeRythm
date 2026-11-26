import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Switch, View } from 'react-native';
import { strings } from '../../localization';
import {
  hydrateWifiOnlyDownloads,
  setWifiOnlyDownloads,
  useWifiOnlyDownloads,
} from '../../offline/downloadSettings';
import { useOfflineDownloads } from '../../offline/hooks';
import {
  cancelNativeOfflineDownload,
  clearNativeRollingCache,
  getNativeOfflineStorageMetrics,
  hasNativeOfflineExtension,
  type NativeOfflineStorageMetrics,
} from '../../offline/native';
import Player from '../../player/player';
import { colors, radii, spacing } from '../../theme';
import { ActionButton, AppText } from '../ui';
import { ProfileGroup } from './ProfileGroup';

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MB`;
  return `${(mib / 1024).toFixed(2)} GB`;
}

/**
 * Storage & Cache Dashboard in Profile: displays offline download footprint +
 * free device space, provides rolling stream cache clearing, and persists the
 * Wi-Fi-only download guard.
 */
export default function StorageCachePanel() {
  const offline = useOfflineDownloads();
  const wifiOnly = useWifiOnlyDownloads();
  const [metrics, setMetrics] = useState<NativeOfflineStorageMetrics | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cancellingDownload, setCancellingDownload] = useState(false);
  const [savingWifi, setSavingWifi] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrateWifiOnlyDownloads().catch((cause: unknown) => {
      console.error('[LoggeRythm] Failed to read the Wi-Fi-only download setting:', cause);
      setError(strings.profile.wifiOnlySaveFailed);
    });
  }, []);

  useEffect(() => {
    if (offline.scope === null || !hasNativeOfflineExtension('getStorageMetrics')) return undefined;
    let active = true;
    void getNativeOfflineStorageMetrics(offline.scope)
      .then((next) => {
        if (active) setMetrics(next);
      })
      .catch((cause: unknown) => {
        console.error('[LoggeRythm] Failed to read offline storage metrics:', cause);
      });
    return () => {
      active = false;
    };
  }, [offline.scope, offline.storageBytes, offline.downloadedTrackIds.size]);

  const downloadedCount = metrics?.scopeTrackCount ?? offline.downloadedTrackIds.size;
  const downloadsSize = formatStorageBytes(metrics?.scopeBytes ?? offline.storageBytes);
  const availableBytes = metrics?.availableDiskBytes ?? offline.availableDiskBytes;
  const freeDisk = availableBytes !== null ? formatStorageBytes(availableBytes) : null;
  const rollingCacheSummary = metrics !== null
    ? `${formatStorageBytes(metrics.rollingCacheBytes)} / ${formatStorageBytes(metrics.rollingCacheMaxBytes)} (${metrics.rollingCacheEntryCount})`
    : null;

  const handleToggleWifiOnly = async (next: boolean) => {
    if (savingWifi) return;
    setSavingWifi(true);
    setError(null);
    setStatusMessage(null);
    try {
      await setWifiOnlyDownloads(next);
    } catch (cause) {
      console.error('[LoggeRythm] Failed to save the Wi-Fi-only download setting:', cause);
      setError(strings.profile.wifiOnlySaveFailed);
    } finally {
      setSavingWifi(false);
    }
  };

  const handleCancelActiveDownload = async () => {
    if (cancellingDownload) return;
    setCancellingDownload(true);
    setError(null);
    try {
      await cancelNativeOfflineDownload();
    } catch (cause) {
      // The cause itself, never a button label standing in for an error text.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCancellingDownload(false);
    }
  };

  const handleClearStreamCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    setError(null);
    setStatusMessage(null);
    try {
      if (hasNativeOfflineExtension('clearRollingCache')) {
        await clearNativeRollingCache();
      } else {
        await Player.clearCache();
      }
      if (offline.scope !== null && hasNativeOfflineExtension('getStorageMetrics')) {
        setMetrics(await getNativeOfflineStorageMetrics(offline.scope));
      }
      setStatusMessage(strings.profile.streamCacheCleared);
      AccessibilityInfo.announceForAccessibility(strings.profile.streamCacheCleared);
    } catch (cause) {
      console.error('[LoggeRythm] Failed to clear the stream cache:', cause);
      setError(strings.profile.streamCacheClearFailed);
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <ProfileGroup
      testID="profile-storage"
      icon="harddisk"
      title={strings.profile.storageTitle}
    >
      <View testID="profile-storage-downloads" style={styles.metricCard}>
        <AppText variant="label">{strings.profile.storageDownloadsLabel}</AppText>
        <AppText testID="profile-storage-downloads-summary" variant="bodyStrong" color="accent">
          {strings.profile.storageDownloadsSummary(downloadedCount, downloadsSize)}
        </AppText>
        {freeDisk !== null ? (
          <AppText testID="profile-storage-free-space" variant="caption" color="secondary">
            {strings.profile.storageFreeSpace(freeDisk)}
          </AppText>
        ) : null}
        {offline.progress !== null && hasNativeOfflineExtension('cancelDownload') ? (
          <ActionButton
            testID="profile-storage-cancel-download"
            variant="danger"
            icon="close-circle-outline"
            label={strings.common.cancel}
            busy={cancellingDownload}
            disabled={cancellingDownload}
            onPress={() => void handleCancelActiveDownload()}
          />
        ) : null}
      </View>

      <View style={styles.toggleRow}>
        <AppText variant="bodyStrong" style={styles.toggleLabel}>{strings.profile.wifiOnlyLabel}</AppText>
        <Switch
          testID="profile-storage-wifi-only"
          accessibilityLabel={strings.profile.wifiOnlyLabel}
          disabled={savingWifi}
          value={wifiOnly}
          onValueChange={(next) => void handleToggleWifiOnly(next)}
          trackColor={{ false: colors.border, true: colors.accentSolid }}
          thumbColor={wifiOnly ? colors.onAccent : colors.textSecondary}
        />
      </View>

      <View style={styles.cacheSection}>
        <AppText variant="bodyStrong">{strings.profile.storageStreamCacheLabel}</AppText>
        <AppText variant="caption" color="secondary">
          {rollingCacheSummary ?? strings.profile.storageStreamCacheHint}
        </AppText>
        <ActionButton
          testID="profile-storage-clear-cache"
          variant="secondary"
          icon="broom"
          label={
            clearingCache
              ? strings.profile.clearingStreamCache
              : strings.profile.clearStreamCache
          }
          busy={clearingCache}
          disabled={clearingCache}
          fullWidth
          onPress={() => void handleClearStreamCache()}
        />
      </View>

      {statusMessage !== null ? (
        <AppText
          testID="profile-storage-status"
          accessibilityLiveRegion="polite"
          variant="callout"
          color="success"
        >
          {statusMessage}
        </AppText>
      ) : null}

      {error !== null ? (
        <AppText
          testID="profile-storage-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          variant="callout"
          color="danger"
        >
          {error}
        </AppText>
      ) : null}
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  metricCard: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.backgroundElevated,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleLabel: {
    flex: 1,
    minWidth: 0,
  },
  cacheSection: {
    gap: spacing.xs,
  },
});
