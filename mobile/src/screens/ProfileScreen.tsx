import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeUpdateRequest } from '../api/endpoints';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import AndroidUpdateCard from '../components/profile/AndroidUpdateCard';
import LanguageSelector from '../components/profile/LanguageSelector';
import { ProfileGroup } from '../components/profile/ProfileGroup';
import { useAndroidUpdatePlacement } from '../components/profile/useAndroidUpdatePlacement';
import {
  ListeningStatsPanel,
  ProfileEditForm,
  ProfileIdentityCard,
  SleepTimerPanel,
} from '../components/profile/ProfileSections';
import { ActionButton, AppText, BottomSheet, ScreenHeader } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, musicRepository, queryKeys } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { colors, layout, spacing } from '../theme';
import { profileDeleteFailureMessage } from './profileFeedback';
import { persistProfileUpdate } from './profileUpdate';

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

export default function ProfileScreen() {
  const { user, refreshUser, deleteAccount } = useAuth();
  if (user === null) throw new Error('ProfileScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const stats = useQuery(musicQueries.stats(scope));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Latched for this visit: exactly one update card, and it never moves.
  const updatePlacement = useAndroidUpdatePlacement();
  const bottom = useBottomInset({ hasTabBar: false });
  const refreshing = stats.isFetching && !stats.isPending;

  const saveProfile = async (patch: MeUpdateRequest) => {
    await persistProfileUpdate(patch, user.id, {
      updateMe: musicRepository.updateMe,
      refreshUser,
      invalidatePublicProfile: (userId) =>
        queryClient.invalidateQueries({ queryKey: queryKeys.profile.public(userId) }),
    });
  };

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (error) {
      setDeleteError(profileDeleteFailureMessage(error, strings.profile));
      setDeleting(false);
    }
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteError(null);
    setConfirmingDelete(false);
  };

  return (
    <View testID="profile-screen" style={styles.container}>
      <ScrollView
        testID="profile-scroll"
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
        <ScreenHeader
          testID="profile-hero"
          title={strings.profile.title}
          subtitle={strings.profile.subtitle}
        />
        {updatePlacement === 'top' ? <AndroidUpdateCard /> : null}

        <ProfileIdentityCard
          user={user}
          avatarUri={safeAvatarUri(user.avatar_url, apiBase)}
          serverOrigin={apiBase}
        />
        <ListeningStatsPanel
          data={stats.data}
          pending={stats.isPending}
          fetching={stats.isFetching}
          fetchStatus={stats.fetchStatus}
          stale={stats.isStale}
          error={errorOf(stats.error)}
          onRefresh={() => void stats.refetch()}
        />
        <SleepTimerPanel />
        <LanguageSelector />
        <ProfileEditForm
          key={`${user.display_name ?? ''}:${user.email}`}
          user={user}
          onSave={saveProfile}
        />
        {updatePlacement === 'bottom' ? <AndroidUpdateCard /> : null}

        <ProfileGroup
          testID="profile-danger"
          tone="danger"
          icon="delete-outline"
          title={strings.profile.dangerTitle}
          description={strings.profile.dangerBody}
        >
          <ActionButton
            testID="profile-delete"
            variant="danger"
            label={strings.profile.deleteAccount}
            fullWidth
            onPress={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
          />
        </ProfileGroup>
      </ScrollView>

      <BottomSheet
        testID="profile-delete-confirmation"
        visible={confirmingDelete}
        onClose={closeDelete}
        closeLabel={strings.profile.deleteCancel}
        title={strings.profile.deleteTitle}
        contentStyle={styles.sheet}
      >
        <AppText color="secondary">{strings.profile.deleteWarning}</AppText>
        {deleteError ? (
          <AppText
            testID="profile-delete-error"
            variant="callout"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {deleteError}
          </AppText>
        ) : null}
        <ActionButton
          testID="profile-delete-confirm"
          variant="danger"
          icon="delete-forever-outline"
          label={deleting ? strings.profile.deleting : strings.profile.deleteConfirm}
          disabled={deleting}
          busy={deleting}
          fullWidth
          onPress={() => void confirmDelete()}
        />
        <ActionButton
          testID="profile-delete-cancel"
          variant="secondary"
          label={strings.profile.deleteCancel}
          disabled={deleting}
          fullWidth
          onPress={closeDelete}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    gap: layout.stackGap,
    paddingTop: spacing.md,
    paddingHorizontal: layout.pagePadding,
  },
  sheet: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xxs },
});
