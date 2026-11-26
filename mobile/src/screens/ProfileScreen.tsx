import React, { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { showDevicePicker } from '../components/connect/devicePicker';
import { AudioEffectsSheet } from '../components/player/AudioEffectsSheet';
import AndroidUpdateCard from '../components/profile/AndroidUpdateCard';
import { ProfileBottomSafeSpacer } from '../components/profile/ProfileChrome';
import {
  ProfileQuickActions,
  ProfileSettingsMenu,
} from '../components/profile/ProfileOverviewNavigation';
import {
  ListeningStatsPanel,
  ProfileIdentityCard,
  SleepTimerPanel,
} from '../components/profile/ProfileSections';
import { useAndroidUpdatePlacement } from '../components/profile/useAndroidUpdatePlacement';
import { BottomSheet } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { wave2Strings } from '../localization/wave2Strings';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, tvFocusRegistry, useTvEnvironment, useTvFocusReturn } from '../tv';
import { androidUpdateStore } from '../update/androidUpdateStore';

export { ProfileBottomSafeSpacer };

export interface ProfileScreenProps {
  onOpenPlaybackSettings: () => void;
  onOpenDevicesStorageSettings: () => void;
  onOpenAccountAppSettings: () => void;
  onOpenInsights: () => void;
}

function errorOf(value: unknown): Error | null {
  if (value === null || value === undefined) return null;
  return value instanceof Error ? value : new Error(String(value));
}

function safeAvatarUri(value: string | null, apiBase: string): string | null {
  if (!value) return null;
  try {
    return resolveServerUrl(value, apiBase);
  } catch (error) {
    throw new Error('Profile avatar URL is invalid for the selected server', { cause: error });
  }
}

/**
 * Restores TV scope focus on focus changes and pops the `'tv-profile'` focus
 * checkpoint pushed by `navigation.tsx` when leaving Profile on Android TV.
 * Isolated in a child component so `ProfileScreen` keeps its hook order simple.
 */
export function ProfileTvFocusEffect() {
  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'profile', active: isFocused, enabled: tv.isTv });
  useEffect(() => {
    if (!tv.isTv) return undefined;
    return () => {
      tvFocusRegistry.popAndRestore();
    };
  }, [tv.isTv]);
  return null;
}

/**
 * Mounts the urgent Android update card at the top of Profile when an update
 * or unacknowledged install failure waits for the user, while suppressing
 * duplicate TalkBack announcements whenever a settings sub-screen covers Profile.
 */
export function ProfileUrgentUpdateCard() {
  const isFocused = useIsFocused();
  const focusedRef = useRef(isFocused);
  useEffect(() => {
    focusedRef.current = isFocused;
  }, [isFocused]);

  return <AndroidUpdateCard shouldAnnounce={() => focusedRef.current} />;
}

/**
 * Keeps the profile-visit background update check running when the full card
 * lives inside Account & App (placement === 'bottom'), without shifting layout.
 */
export function ProfileBackgroundUpdateCheck() {
  useEffect(() => {
    if (androidUpdateStore.getSnapshot().supported) {
      void androidUpdateStore.check('profile');
    }
  }, []);
  return null;
}

/**
 * Concise Profile overview: account identity, conditional urgent update card,
 * one-tap quick actions, grouped navigation into three thematic settings pages
 * (Playback, Devices & Storage, Account & App), and personal listening stats.
 */
export default function ProfileScreen({
  onOpenPlaybackSettings,
  onOpenDevicesStorageSettings,
  onOpenAccountAppSettings,
  onOpenInsights,
}: ProfileScreenProps) {
  const { user } = useAuth();
  if (user === null) throw new Error('ProfileScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const stats = useQuery(musicQueries.stats(scope));
  // Hook order of these 2 useState cells is pinned by ProfileScreen.test.tsx.
  const [sleepSheetOpen, setSleepSheetOpen] = useState(false);
  const [effectsSheetOpen, setEffectsSheetOpen] = useState(false);
  // Latched for this visit: urgent updates stay at top, regular version info lives in Account & App.
  const updatePlacement = useAndroidUpdatePlacement();
  const bottom = useBottomInset({ hasTabBar: false });
  const tv = useTvEnvironment();
  const refreshing = stats.isFetching && !stats.isPending;

  const openSleepTimer = () => {
    if (tv.isTv) tvFocusRegistry.pushCheckpoint('profile-sleep-timer');
    setSleepSheetOpen(true);
  };

  const closeSleepTimer = () => {
    setSleepSheetOpen(false);
    if (tv.isTv) tvFocusRegistry.popAndRestore();
  };

  const openAudioEffects = () => {
    if (tv.isTv) tvFocusRegistry.pushCheckpoint('profile-audio-effects');
    setEffectsSheetOpen(true);
  };

  const closeAudioEffects = () => {
    setEffectsSheetOpen(false);
    if (tv.isTv) tvFocusRegistry.popAndRestore();
  };

  const openDevices = () => {
    showDevicePicker('devices');
  };

  const avatarUri = safeAvatarUri(user.avatar_url, apiBase);

  const urgentUpdateCard = updatePlacement === 'top' ? <ProfileUrgentUpdateCard /> : null;
  const backgroundUpdateCheck = updatePlacement === 'bottom' ? <ProfileBackgroundUpdateCheck /> : null;
  const identityCard = (
    <ProfileIdentityCard
      user={user}
      avatarUri={avatarUri}
      serverOrigin={apiBase}
      compact
    />
  );
  const quickActions = (
    <ProfileQuickActions
      onOpenInsights={onOpenInsights}
      onOpenSleepTimer={openSleepTimer}
      onOpenAudioEffects={openAudioEffects}
      onOpenDevices={openDevices}
    />
  );
  const settingsMenu = (
    <ProfileSettingsMenu
      onOpenPlaybackSettings={onOpenPlaybackSettings}
      onOpenDevicesStorageSettings={onOpenDevicesStorageSettings}
      onOpenAccountAppSettings={onOpenAccountAppSettings}
    />
  );
  const statsPanel = (
    <ListeningStatsPanel
      data={stats.data}
      pending={stats.isPending}
      fetching={stats.isFetching}
      fetchStatus={stats.fetchStatus}
      stale={stats.isStale}
      error={errorOf(stats.error)}
      onRefresh={() => void stats.refetch()}
    />
  );

  const quickSheets = (
    <>
      <BottomSheet
        testID="profile-quick-sleep-sheet"
        visible={sleepSheetOpen}
        onClose={closeSleepTimer}
        closeLabel={strings.player.sleepTimerSheetClose}
      >
        {sleepSheetOpen ? <SleepTimerPanel /> : null}
      </BottomSheet>
      <BottomSheet
        testID="profile-quick-audio-effects-sheet"
        visible={effectsSheetOpen}
        onClose={closeAudioEffects}
        closeLabel={wave2Strings.audioEffects.closeButton}
      >
        {effectsSheetOpen ? <AudioEffectsSheet onClose={closeAudioEffects} /> : null}
      </BottomSheet>
    </>
  );

  if (tv.isTv) {
    return (
      <TvFocusScope scope="profile">
        <View testID="profile-screen" style={styles.container}>
          <ProfileTvFocusEffect />
          {backgroundUpdateCheck}
          <ScrollView
            testID="profile-scroll"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              {
                paddingHorizontal: tv.contentPaddingHorizontal,
                paddingBottom: bottom,
              },
            ]}
          >
            {urgentUpdateCard}
            <View testID="profile-tv-columns" style={[styles.tvColumns, { gap: tv.gridGap }]}>
              <View style={styles.tvColumn}>
                {identityCard}
                {quickActions}
                {settingsMenu}
              </View>
              <View style={styles.tvColumn}>
                {statsPanel}
              </View>
            </View>
          </ScrollView>
          {quickSheets}
        </View>
      </TvFocusScope>
    );
  }

  return (
    <View testID="profile-screen" style={styles.container}>
      {backgroundUpdateCheck}
      <ScrollView
        testID="profile-scroll"
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void stats.refetch()}
            accessibilityLabel={strings.profile.refreshStats}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        {urgentUpdateCard}
        {identityCard}
        {quickActions}
        {settingsMenu}
        {statsPanel}
      </ScrollView>
      <ProfileBottomSafeSpacer />
      {quickSheets}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: {
    gap: layout.stackGap,
    paddingTop: spacing.xs,
    paddingHorizontal: layout.pagePadding,
  },
  tvColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tvColumn: {
    flex: 1,
    minWidth: 0,
    gap: layout.stackGap,
  },
});
